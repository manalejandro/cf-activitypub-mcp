import { abortAllDurableObjects, env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeSnapshot } from "../src/sentinel/analyze";
import { SentinelAgent } from "../src/sentinel/agent";
import { applySettingsPatch, evaluateProposals, normalizeAction, normalizeDomain } from "../src/sentinel/policy";
import {
	SENTINEL_ACTION_TYPES,
	type SentinelAccountInfo,
	type SentinelProposal,
	type SentinelSettings,
	type SentinelSnapshot,
} from "../src/sentinel/types";
import { budgetStatus, estimateTokens, neuronsFor, utcDay } from "../src/sentinel/usage";
import { getAgentByName } from "agents";

function baseSettings(overrides: Partial<SentinelSettings> = {}): SentinelSettings {
	return {
		enabled: false,
		mode: "enforce",
		intervalSeconds: 900,
		model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
		maxActionsPerRun: 3,
		minConfidence: 0.8,
		cooldownHours: 24,
		dailyNeuronBudget: 10_000,
		allowedActions: [...SENTINEL_ACTION_TYPES],
		protectedDomains: [],
		notifyWebhook: null,
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function proposal(overrides: Partial<SentinelProposal> = {}): SentinelProposal {
	return {
		action: "silence_account",
		target_id: "acc-1",
		target_label: "@spammer",
		confidence: 0.95,
		reason: "Repeated spam",
		...overrides,
	};
}

const account: SentinelAccountInfo = {
	id: "acc-1",
	acct: "@spammer",
	role: "user",
	suspended: false,
	silenced: false,
	approved: true,
};

describe("sentinel settings", () => {
	it("clamps values and ignores unknown fields", () => {
		const next = applySettingsPatch(baseSettings(), {
			intervalSeconds: 5,
			minConfidence: 4,
			maxActionsPerRun: 99,
			dailyNeuronBudget: 99_000_000,
			mode: "chaos",
			allowedActions: ["suspend_account", "not_a_real_action"],
			protectedDomains: ["https://Mastodon.Social/about", "bad domain"],
			notifyWebhook: "http://insecure.example.com/hook",
			unknownField: true,
		});
		expect(next.intervalSeconds).toBe(60);
		expect(next.minConfidence).toBe(1);
		expect(next.maxActionsPerRun).toBe(10);
		expect(next.dailyNeuronBudget).toBe(10_000_000);
		expect(next.mode).toBe("enforce");
		expect(next.allowedActions).toEqual(["suspend_account"]);
		expect(next.protectedDomains).toEqual(["mastodon.social"]);
		expect(next.notifyWebhook).toBeNull();
	});

	it("accepts a valid patch", () => {
		const next = applySettingsPatch(baseSettings(), {
			enabled: true,
			mode: "observe",
			intervalSeconds: 3600,
			notifyWebhook: "https://hooks.example.com/sentinel",
			protectedDomains: ["mastodon.social"],
		});
		expect(next.enabled).toBe(true);
		expect(next.mode).toBe("observe");
		expect(next.intervalSeconds).toBe(3600);
		expect(next.notifyWebhook).toBe("https://hooks.example.com/sentinel");
	});
});

describe("sentinel policy", () => {
	const input = (overrides: Partial<Parameters<typeof evaluateProposals>[0]> = {}) => ({
		settings: baseSettings(),
		mode: "enforce" as const,
		proposals: [proposal()],
		accountInfo: new Map([["acc-1", account]]),
		domainBlocks: new Set<string>(),
		recentKeys: new Set<string>(),
		...overrides,
	});

	it("executes a well-evidenced action in enforce mode", () => {
		const outcomes = evaluateProposals(input());
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0].status).toBe("proposed");
		expect(outcomes[0].execute).toBe(true);
	});

	it("never executes in observe or suggest mode", () => {
		for (const mode of ["observe", "suggest"] as const) {
			const outcomes = evaluateProposals(input({ mode }));
			expect(outcomes[0].execute).toBe(false);
			expect(outcomes[0].status).toBe(mode === "observe" ? "observed" : "proposed");
		}
	});

	it("blocks actions that are not allow-listed", () => {
		const outcomes = evaluateProposals(
			input({ settings: baseSettings({ allowedActions: ["resolve_report"] }) })
		);
		expect(outcomes[0].status).toBe("blocked");
		expect(outcomes[0].reason).toContain("disabled");
	});

	it("blocks low-confidence proposals", () => {
		const outcomes = evaluateProposals(input({ proposals: [proposal({ confidence: 0.5 })] }));
		expect(outcomes[0].status).toBe("blocked");
		expect(outcomes[0].reason).toContain("confidence");
	});

	it("blocks protected account roles", () => {
		const outcomes = evaluateProposals(
			input({ accountInfo: new Map([["acc-1", { ...account, role: "admin" }]]) })
		);
		expect(outcomes[0].status).toBe("blocked");
		expect(outcomes[0].reason).toContain("protected account role");
	});

	it("blocks accounts under cooldown", () => {
		const outcomes = evaluateProposals(input({ recentKeys: new Set(["silence_account:acc-1"]) }));
		expect(outcomes[0].status).toBe("blocked");
		expect(outcomes[0].reason).toContain("cooldown");
	});

	it("enforces the per-run budget", () => {
		const proposals = Array.from({ length: 5 }, (_, index) =>
			proposal({ target_id: `acc-${index}`, target_label: `@user${index}` })
		);
		const accountInfo = new Map(
			proposals.map((item) => [item.target_id, { ...account, id: item.target_id }])
		);
		const outcomes = evaluateProposals(
			input({ settings: baseSettings({ maxActionsPerRun: 2 }), proposals, accountInfo })
		);
		expect(outcomes.filter((outcome) => outcome.execute)).toHaveLength(2);
		expect(outcomes.filter((outcome) => outcome.status === "blocked")).toHaveLength(3);
	});

	it("protects configured domains and existing blocks", () => {
		const blockProposal = proposal({ action: "block_domain", target_id: "spam.example", confidence: 0.95 });
		const protectedOutcome = evaluateProposals(
			input({
				settings: baseSettings({ protectedDomains: ["spam.example"] }),
				proposals: [blockProposal],
			})
		);
		expect(protectedOutcome[0].status).toBe("blocked");
		expect(protectedOutcome[0].reason).toContain("protected");

		const alreadyBlocked = evaluateProposals(
			input({ proposals: [blockProposal], domainBlocks: new Set(["spam.example"]) })
		);
		expect(alreadyBlocked[0].status).toBe("blocked");
		expect(alreadyBlocked[0].reason).toContain("already blocked");
	});

	it("normalizes model aliases and domains", () => {
		expect(normalizeAction("Suspend Account")).toBe("suspend_account");
		expect(normalizeAction("defederate")).toBe("block_domain");
		expect(normalizeAction("no_action")).toBeNull();
		expect(normalizeDomain("https://Mastodon.Social/about")).toBe("mastodon.social");
		expect(normalizeDomain("not a domain")).toBeNull();
	});
});

describe("sentinel analysis", () => {
	const snapshot: SentinelSnapshot = {
		collectedAt: new Date().toISOString(),
		instance: { url: "https://social.example.com", reachable: true, latencyMs: 20, title: "Test", version: "1.0.0", users: 3 },
		totals: { accounts: 10, openReports: 2, moderationEntries: 5, federatedInstances: 4, relays: 1 },
		pendingAccounts: [],
		recentAccounts: [],
		openReports: [],
		problemInstances: [],
		domainBlocks: [],
		mediaCache: null,
		recentModeration: [],
		errors: [],
	};

	it("parses a structured model response and drops no_action", async () => {
		const ai = {
			run: async () => ({
				response: {
					summary: "All good",
					severity: "normal",
					findings: [{ title: "Spike", detail: "Reports increased", severity: "warning" }],
					proposed_actions: [
						{ action: "no_action", confidence: 1, reason: "nothing" },
						{ action: "resolve_report", target_id: "r-1", confidence: 0.7, reason: "handled" },
					],
				},
			}),
		} as unknown as Ai;

		const { analysis, usage } = await analyzeSnapshot(ai, baseSettings(), snapshot);
		expect(analysis.summary).toBe("All good");
		expect(analysis.severity).toBe("normal");
		expect(analysis.findings).toHaveLength(1);
		expect(analysis.proposals).toEqual([
			{ action: "resolve_report", target_id: "r-1", target_label: "", confidence: 0.7, reason: "handled" },
		]);
		expect(usage.estimated).toBe(true);
		expect(usage.neurons).toBeGreaterThan(0);
		expect(usage.totalTokens).toBe(usage.promptTokens + usage.completionTokens);
	});

	it("uses provider token counts when present", async () => {
		const ai = {
			run: async () => ({
				response: { summary: "ok", severity: "normal", proposed_actions: [] },
				usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 },
			}),
		} as unknown as Ai;

		const { usage } = await analyzeSnapshot(ai, baseSettings(), snapshot);
		expect(usage.estimated).toBe(false);
		expect(usage.promptTokens).toBe(1_000);
		expect(usage.completionTokens).toBe(200);
		// 1000 * 26668/1e6 + 200 * 204805/1e6 = 26.668 + 40.961 => 68 neurons
		expect(usage.neurons).toBe(68);
	});

	it("rejects invalid JSON", async () => {
		const ai = { run: async () => ({ response: "not-json" }) } as unknown as Ai;
		await expect(analyzeSnapshot(ai, baseSettings(), snapshot)).rejects.toThrow(/valid JSON/);
	});
});

describe("sentinel neuron accounting", () => {
	it("converts tokens to neurons with the model rates", () => {
		expect(neuronsFor("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 1_000_000, 0)).toBe(26_668);
		expect(neuronsFor("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 0, 1_000_000)).toBe(204_805);
		// Unknown models fall back to conservative default rates.
		expect(neuronsFor("unknown/model", 1_000_000, 0)).toBe(26_668);
	});

	it("estimates tokens from text and derives the UTC day", () => {
		expect(estimateTokens("")).toBe(1);
		expect(estimateTokens("a".repeat(400))).toBe(100);
		expect(utcDay(new Date("2026-10-04T23:59:59Z"))).toBe("2026-10-04");
	});

	it("computes budget status", () => {
		expect(budgetStatus(0, 5_000)).toEqual({ exhausted: false, remaining: null });
		expect(budgetStatus(10_000, 2_500)).toEqual({ exhausted: false, remaining: 7_500 });
		expect(budgetStatus(10_000, 10_000)).toEqual({ exhausted: true, remaining: 0 });
		expect(budgetStatus(10_000, 12_000)).toEqual({ exhausted: true, remaining: 0 });
	});
});

describe("sentinel durable object", () => {
	afterEach(async () => {
		await abortAllDurableObjects();
	});

	it("seeds defaults, persists configuration and records decisions", async () => {
		const agent = await getAgentByName(env.SENTINEL as DurableObjectNamespace<SentinelAgent>, "test-default");

		const initial = await agent.getStatus();
		expect(initial.settings.mode).toBe("observe");
		expect(initial.settings.enabled).toBe(false);
		expect(initial.settings.intervalSeconds).toBe(900);
		expect(initial.settings.dailyNeuronBudget).toBe(10_000);
		expect(initial.decisionsTotal).toBe(0);
		expect(initial.usage.neuronsUsed).toBe(0);
		expect(initial.usage.remaining).toBe(10_000);
		expect(initial.usage.day).toBe(new Date().toISOString().slice(0, 10));

		const configured = await agent.configure({ mode: "suggest", intervalSeconds: 1800, minConfidence: 0.9 });
		expect(configured.settings.mode).toBe("suggest");
		expect(configured.settings.intervalSeconds).toBe(1800);
		expect(configured.settings.minConfidence).toBe(0.9);

		const decisions = await agent.listDecisions({ limit: 5 });
		expect(decisions.total).toBe(0);
		expect(decisions.decisions).toEqual([]);
	});

	it("returns an error run when the instance is unreachable", async () => {
		const agent = await getAgentByName(env.SENTINEL as DurableObjectNamespace<SentinelAgent>, "test-error");
		await agent.configure({ mode: "observe", enabled: false });
		const result = await agent.runCheck({ trigger: "manual" });
		expect(result.status).toBe("error");
		expect(result.error).toBeTruthy();

		const status = await agent.getStatus();
		expect(status.lastRunStatus).toBe("error");
		expect(status.consecutiveErrors).toBe(1);
	});

	it("skips scheduled runs while disabled", async () => {
		const agent = await getAgentByName(env.SENTINEL as DurableObjectNamespace<SentinelAgent>, "test-disabled");
		await agent.configure({ enabled: false });
		const result = await agent.runCheck({ trigger: "schedule" });
		expect(result.status).toBe("skipped");
	});

	it("skips checks once the daily neuron budget is exhausted", async () => {
		const namespace = env.SENTINEL as DurableObjectNamespace<SentinelAgent>;
		const agent = await getAgentByName(namespace, "test-budget");
		await agent.configure({ mode: "observe", enabled: true, dailyNeuronBudget: 500 });

		// Seed today's ledger above the budget through the DO instance itself.
		await runInDurableObject(namespace.get(namespace.idFromName("test-budget")), (instance) => {
			instance.sql`
				INSERT INTO sentinel_usage (day, neurons, runs, input_tokens, output_tokens, updated_at)
				VALUES (${utcDay()}, 600, 1, 120, 80, ${new Date().toISOString()})
			`;
		});

		const status = await agent.getStatus();
		expect(status.usage.neuronsUsed).toBe(600);
		expect(status.usage.remaining).toBe(0);

		const result = await agent.runCheck({ trigger: "schedule" });
		expect(result.status).toBe("skipped");
		expect(result.summary).toContain("neuron budget");
	});
});
