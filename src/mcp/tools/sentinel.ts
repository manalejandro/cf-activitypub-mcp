import type { McpServer } from "@modelcontextprotocol/server";
import { getAgentByName } from "agents";
import { z } from "zod";
import { ConfigError } from "../../activitypub/client";
import { SENTINEL_ACTION_TYPES } from "../../sentinel/types";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * Sentinel (Centinela) control tools. The agent itself runs on a Durable
 * Object; these tools talk to it over RPC from the same worker.
 */
export function registerSentinelTools(server: McpServer, ctx: ToolContext): string[] {
	const agent = async () => {
		if (!ctx.env.SENTINEL) {
			throw new ConfigError("The SENTINEL Durable Object binding is not configured.");
		}
		return getAgentByName(ctx.env.SENTINEL, "default");
	};

	server.registerTool(
		"get_sentinel_status",
		{
			title: "Get sentinel status",
			description:
				"Returns the AI Sentinel configuration (mode, interval, model, thresholds, allowed actions, protected domains, daily neuron budget), today's AI usage ledger, the last run summary and the next scheduled check.",
			inputSchema: z.object({}),
		},
		async () => run(() => agent().then((instance) => instance.getStatus()))
	);

	server.registerTool(
		"configure_sentinel",
		{
			title: "Configure sentinel",
			description:
				"Updates the AI Sentinel configuration. Only the fields provided change. Modes: `observe` records findings only, `suggest` records proposed actions, `enforce` executes actions that pass the guardrails (allow-list, per-run budget, cooldowns, protected accounts and domains). Enabling it starts the periodic schedule.",
			inputSchema: z.object({
				enabled: z.boolean().optional().describe("Start or stop the periodic checks."),
				mode: z
					.enum(["observe", "suggest", "enforce"])
					.optional()
					.describe("Autonomy level of the agent."),
				interval_seconds: z
					.number()
					.int()
					.min(60)
					.max(86_400)
					.optional()
					.describe("Seconds between scheduled checks."),
				model: z.string().optional().describe("Workers AI model id used for the analysis."),
				max_actions_per_run: z
					.number()
					.int()
					.min(0)
					.max(10)
					.optional()
					.describe("Hard cap of executed actions per run."),
				min_confidence: z
					.number()
					.min(0)
					.max(1)
					.optional()
					.describe("Minimum model confidence required to act."),
				cooldown_hours: z
					.number()
					.min(0)
					.max(168)
					.optional()
					.describe("Hours during which the same action and target are not repeated."),
				daily_neuron_budget: z
					.number()
					.int()
					.min(0)
					.max(10_000_000)
					.optional()
					.describe(
						"Workers AI budget in neurons per UTC day (0 = unlimited). Checks are skipped once the budget is exhausted; usage is estimated from provider token counts."
					),
				allowed_actions: z
					.array(z.enum(SENTINEL_ACTION_TYPES))
					.optional()
					.describe("Action types the Sentinel may execute."),
				protected_domains: z
					.array(z.string())
					.optional()
					.describe("Domains the Sentinel must never act against."),
				notify_webhook: z
					.string()
					.optional()
					.describe("HTTPS webhook that receives a JSON summary after each run (empty string clears it)."),
			}),
		},
		async (args) =>
			run(async () => {
				const patch: Record<string, unknown> = {};
				if (args.enabled !== undefined) patch.enabled = args.enabled;
				if (args.mode !== undefined) patch.mode = args.mode;
				if (args.interval_seconds !== undefined) patch.intervalSeconds = args.interval_seconds;
				if (args.model !== undefined) patch.model = args.model;
				if (args.max_actions_per_run !== undefined) patch.maxActionsPerRun = args.max_actions_per_run;
				if (args.min_confidence !== undefined) patch.minConfidence = args.min_confidence;
				if (args.cooldown_hours !== undefined) patch.cooldownHours = args.cooldown_hours;
				if (args.daily_neuron_budget !== undefined) patch.dailyNeuronBudget = args.daily_neuron_budget;
				if (args.allowed_actions !== undefined) patch.allowedActions = args.allowed_actions;
				if (args.protected_domains !== undefined) patch.protectedDomains = args.protected_domains;
				if (args.notify_webhook !== undefined) patch.notifyWebhook = args.notify_webhook;
				if (Object.keys(patch).length === 0) {
					return { ok: false, message: "No configuration fields were provided." };
				}
				const instance = await agent();
				return instance.configure(patch);
			})
	);

	server.registerTool(
		"run_sentinel_check",
		{
			title: "Run sentinel check",
			description:
				"Runs an AI Sentinel check immediately: it collects the instance snapshot, asks Workers AI for an analysis and applies the configured policy. Manual runs work even when the periodic schedule is disabled and respect the current mode (observe/suggest/enforce).",
			inputSchema: z.object({}),
		},
		async () => run(() => agent().then((instance) => instance.runCheck({ trigger: "manual" })))
	);

	server.registerTool(
		"get_sentinel_decisions",
		{
			title: "Get sentinel decisions",
			description:
				"Lists the Sentinel decision history (newest first) with status, action, target, confidence and result. Statuses: `observed`, `proposed`, `blocked`, `executed`, `failed`.",
			inputSchema: z.object({
				limit: z.number().int().min(1).max(100).default(20).describe("Decisions per page."),
				offset: z.number().int().min(0).default(0).describe("Decisions to skip."),
				status: z
					.enum(["observed", "proposed", "blocked", "executed", "failed"])
					.optional()
					.describe("Filter by decision status."),
				action: z.string().optional().describe("Filter by action type."),
			}),
		},
		async ({ limit, offset, status, action }) =>
			run(() => agent().then((instance) => instance.listDecisions({ limit, offset, status, action })))
	);

	server.registerTool(
		"clear_sentinel_decisions",
		{
			title: "Clear sentinel decisions",
			description:
				"Deletes the Sentinel decision and run history stored in its Durable Object. Requires `confirm: true`.",
			inputSchema: z.object({
				confirm: z.boolean().default(false).describe("Must be `true` to delete the history."),
			}),
		},
		async ({ confirm }) => {
			if (confirm !== true) {
				return fail("Clearing the Sentinel history is destructive. Call again with confirm: true.");
			}
			return run(() => agent().then((instance) => instance.clearDecisions()));
		}
	);

	return [
		"get_sentinel_status",
		"configure_sentinel",
		"run_sentinel_check",
		"get_sentinel_decisions",
		"clear_sentinel_decisions",
	];
}
