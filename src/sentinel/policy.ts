import {
	ACTION_CONFIDENCE_FLOOR,
	ACTION_TARGET_TYPE,
	SENTINEL_ACTION_TYPES,
	type SentinelAccountInfo,
	type SentinelActionType,
	type SentinelMode,
	type SentinelProposal,
	type SentinelSettings,
} from "./types";

export const DEFAULT_SENTINEL_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 86_400;
export const MAX_ACTIONS_PER_RUN = 10;

/**
 * Applies a validated patch on top of the current settings. Unknown fields and
 * out-of-range values are ignored or clamped — configuration can never enable
 * an action outside the supported catalogue.
 */
export function applySettingsPatch(
	current: SentinelSettings,
	patch: Record<string, unknown>
): SentinelSettings {
	const next: SentinelSettings = { ...current, updatedAt: new Date().toISOString() };

	if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
	if (patch.mode === "observe" || patch.mode === "suggest" || patch.mode === "enforce") {
		next.mode = patch.mode;
	}
	if (typeof patch.intervalSeconds === "number" && Number.isFinite(patch.intervalSeconds)) {
		next.intervalSeconds = clamp(Math.round(patch.intervalSeconds), MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS);
	}
	if (typeof patch.model === "string" && patch.model.trim()) {
		next.model = patch.model.trim().slice(0, 200);
	}
	if (typeof patch.maxActionsPerRun === "number" && Number.isFinite(patch.maxActionsPerRun)) {
		next.maxActionsPerRun = clamp(Math.round(patch.maxActionsPerRun), 0, MAX_ACTIONS_PER_RUN);
	}
	if (typeof patch.minConfidence === "number" && Number.isFinite(patch.minConfidence)) {
		next.minConfidence = clamp(patch.minConfidence, 0, 1);
	}
	if (typeof patch.cooldownHours === "number" && Number.isFinite(patch.cooldownHours)) {
		next.cooldownHours = clamp(Math.round(patch.cooldownHours), 0, 168);
	}
	if (typeof patch.dailyNeuronBudget === "number" && Number.isFinite(patch.dailyNeuronBudget)) {
		next.dailyNeuronBudget = clamp(Math.round(patch.dailyNeuronBudget), 0, 10_000_000);
	}
	if (Array.isArray(patch.allowedActions)) {
		const allowed = new Set<string>(SENTINEL_ACTION_TYPES);
		next.allowedActions = [
			...new Set(patch.allowedActions.filter((value): value is SentinelActionType => typeof value === "string" && allowed.has(value))),
		];
	}
	if (Array.isArray(patch.protectedDomains)) {
		next.protectedDomains = [
			...new Set(
				patch.protectedDomains
					.filter((value): value is string => typeof value === "string")
					.map((value) => normalizeDomain(value))
					.filter((value): value is string => value !== null)
			),
		];
	}
	if (patch.notifyWebhook === null || patch.notifyWebhook === "") {
		next.notifyWebhook = null;
	} else if (typeof patch.notifyWebhook === "string") {
		next.notifyWebhook = normalizeHttpsUrl(patch.notifyWebhook);
	}

	return next;
}

export interface PolicyInput {
	settings: SentinelSettings;
	mode: SentinelMode;
	proposals: SentinelProposal[];
	accountInfo: Map<string, SentinelAccountInfo>;
	domainBlocks: Set<string>;
	/** `${action}:${target}` keys acted on within the cooldown window. */
	recentKeys: Set<string>;
}

export interface PolicyOutcome {
	proposal: SentinelProposal;
	action: SentinelActionType;
	targetType: string;
	status: "observed" | "proposed" | "blocked";
	reason: string;
	/** True when the agent should call the instance API for this proposal. */
	execute: boolean;
}

/**
 * Deterministic guardrails applied to every model proposal. Even a jailbroken
 * model cannot bypass these checks: they run in code, not in the prompt.
 */
export function evaluateProposals(input: PolicyInput): PolicyOutcome[] {
	const outcomes: PolicyOutcome[] = [];
	const seenTargets = new Set<string>();
	let executable = 0;

	for (const proposal of input.proposals) {
		const action = normalizeAction(proposal.action);
		if (!action) continue; // `no_action` and unknown values are ignored.

		const targetId = typeof proposal.target_id === "string" ? proposal.target_id.trim() : "";
		const targetType = ACTION_TARGET_TYPE[action];
		const key = `${action}:${targetId.toLowerCase()}`;

		const blocked = (reason: string): void => {
			outcomes.push({ proposal, action, targetType, status: "blocked", reason, execute: false });
		};

		if (!targetId) {
			blocked("missing target id");
			continue;
		}
		if (!input.settings.allowedActions.includes(action)) {
			blocked("action disabled by configuration");
			continue;
		}
		const threshold = Math.max(input.settings.minConfidence, ACTION_CONFIDENCE_FLOOR[action]);
		if (!(proposal.confidence >= threshold)) {
			blocked(`confidence ${formatConfidence(proposal.confidence)} below the required ${threshold.toFixed(2)}`);
			continue;
		}
		if (seenTargets.has(key)) {
			blocked("duplicate target in the same run");
			continue;
		}
		if (input.recentKeys.has(key)) {
			blocked(`cooldown active for this target (${input.settings.cooldownHours}h)`);
			continue;
		}

		if (action === "silence_account" || action === "suspend_account") {
			const info = input.accountInfo.get(targetId);
			if (!info) {
				blocked("account could not be resolved");
				continue;
			}
			if (info.role !== "user") {
				blocked(`protected account role: ${info.role}`);
				continue;
			}
			if (action === "suspend_account" && info.suspended) {
				blocked("account already suspended");
				continue;
			}
			if (action === "silence_account" && info.silenced) {
				blocked("account already silenced");
				continue;
			}
		}

		if (action === "block_domain") {
			const domain = normalizeDomain(targetId);
			if (!domain) {
				blocked("invalid domain");
				continue;
			}
			if (input.settings.protectedDomains.includes(domain)) {
				blocked("domain is protected by configuration");
				continue;
			}
			if (input.domainBlocks.has(domain)) {
				blocked("domain already blocked");
				continue;
			}
		}

		seenTargets.add(key);

		if (input.mode === "observe") {
			outcomes.push({ proposal, action, targetType, status: "observed", reason: proposal.reason, execute: false });
			continue;
		}
		if (input.mode === "suggest") {
			outcomes.push({ proposal, action, targetType, status: "proposed", reason: proposal.reason, execute: false });
			continue;
		}
		if (executable >= input.settings.maxActionsPerRun) {
			blocked("per-run action budget exhausted");
			continue;
		}
		executable += 1;
		outcomes.push({ proposal, action, targetType, status: "proposed", reason: proposal.reason, execute: true });
	}

	return outcomes;
}

/** Maps model output aliases to the supported action catalogue. */
export function normalizeAction(value: unknown): SentinelActionType | null {
	if (typeof value !== "string") return null;
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	const aliases: Record<string, SentinelActionType> = {
		resolve: "resolve_report",
		resolve_report: "resolve_report",
		dismiss: "dismiss_report",
		dismiss_report: "dismiss_report",
		silence: "silence_account",
		silence_account: "silence_account",
		suspend: "suspend_account",
		suspend_account: "suspend_account",
		block: "block_domain",
		block_domain: "block_domain",
		defederate: "block_domain",
		enforce_media_cache: "enforce_media_cache",
		media_cache: "enforce_media_cache",
		enforce_budget: "enforce_media_cache",
	};
	return aliases[normalized] ?? null;
}

export function normalizeDomain(value: string): string | null {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return null;
	let host = trimmed;
	try {
		host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
	} catch {
		return null;
	}
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
	return host;
}

function normalizeHttpsUrl(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		return url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function formatConfidence(value: number): string {
	return Number.isFinite(value) ? value.toFixed(2) : "n/a";
}
