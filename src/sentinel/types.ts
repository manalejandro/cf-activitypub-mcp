/**
 * Shared types for the Sentinel agent (AI watchdog running on a Durable
 * Object). The agent reviews the instance on a schedule and can propose or
 * execute a constrained set of administrative actions.
 */

export type SentinelMode = "observe" | "suggest" | "enforce";

/** Every action the Sentinel is allowed to perform. */
export const SENTINEL_ACTION_TYPES = [
	"resolve_report",
	"dismiss_report",
	"silence_account",
	"suspend_account",
	"block_domain",
	"enforce_media_cache",
] as const;

export type SentinelActionType = (typeof SENTINEL_ACTION_TYPES)[number];

export type SentinelDecisionStatus = "observed" | "proposed" | "blocked" | "executed" | "failed";
export type SentinelRunStatus = "ok" | "error" | "skipped";

export interface SentinelSettings {
	/** Whether the periodic schedule is active. Manual runs ignore it. */
	enabled: boolean;
	/** Autonomy level: observe, suggest or enforce. */
	mode: SentinelMode;
	/** Seconds between scheduled checks (60 – 86400). */
	intervalSeconds: number;
	/** Workers AI model used for the analysis. */
	model: string;
	/** Hard cap of executed actions per run. */
	maxActionsPerRun: number;
	/** Minimum model confidence required to act (0 – 1). */
	minConfidence: number;
	/** Hours during which the same action+target is not repeated. */
	cooldownHours: number;
	/** Daily Workers AI budget in neurons (0 = unlimited). */
	dailyNeuronBudget: number;
	/** Action types the Sentinel may execute. */
	allowedActions: SentinelActionType[];
	/** Domains the Sentinel must never block or moderate. */
	protectedDomains: string[];
	/** Optional HTTPS webhook that receives a summary after each run. */
	notifyWebhook: string | null;
	updatedAt: string;
}

/** Durable agent state (synced through the Agents SDK state API). */
export interface SentinelState {
	settings: SentinelSettings | null;
	lastRunAt: string | null;
	lastRunId: string | null;
	lastRunStatus: SentinelRunStatus | null;
	lastRunSummary: string | null;
	consecutiveErrors: number;
	totalRuns: number;
	totalActionsExecuted: number;
}

export interface SentinelFinding {
	title: string;
	detail: string;
	severity?: string;
}

/** A model-proposed action, before policy evaluation. */
export interface SentinelProposal {
	action: string;
	target_id: string;
	target_label: string;
	confidence: number;
	reason: string;
}

export interface SentinelAnalysis {
	summary: string;
	severity: "normal" | "elevated" | "critical";
	findings: SentinelFinding[];
	proposals: SentinelProposal[];
}

export interface SentinelDecision {
	id: string;
	runId: string;
	createdAt: string;
	action: string;
	targetType: string | null;
	targetId: string | null;
	targetLabel: string | null;
	confidence: number | null;
	status: SentinelDecisionStatus;
	reason: string;
	result: string | null;
}

export interface SentinelRunResult {
	runId: string;
	status: SentinelRunStatus;
	startedAt: string;
	finishedAt: string;
	trigger: "schedule" | "manual";
	mode: SentinelMode;
	summary: string;
	severity: string;
	findings: SentinelFinding[];
	decisions: SentinelDecision[];
	error?: string;
}

export interface SentinelUsageStatus {
	/** UTC day the counters refer to. */
	day: string;
	/** Neurons consumed today by Sentinel AI calls. */
	neuronsUsed: number;
	/** Configured daily budget in neurons (0 = unlimited). */
	dailyNeuronBudget: number;
	/** Neurons left today, or null when unlimited. */
	remaining: number | null;
	/** AI calls made today. */
	runs: number;
	inputTokens: number;
	outputTokens: number;
}

export interface SentinelStatus {
	settings: SentinelSettings;
	lastRunAt: string | null;
	lastRunId: string | null;
	lastRunStatus: SentinelRunStatus | null;
	lastRunSummary: string | null;
	nextRunAt: string | null;
	consecutiveErrors: number;
	totalRuns: number;
	totalActionsExecuted: number;
	decisionsTotal: number;
	usage: SentinelUsageStatus;
}

export interface SentinelDecisionQuery {
	limit?: number;
	offset?: number;
	status?: SentinelDecisionStatus;
	action?: string;
}

/** Compact view of the instance that is sent to the model. */
export interface SentinelSnapshot {
	collectedAt: string;
	instance: {
		url: string;
		reachable: boolean;
		latencyMs: number | null;
		title: string | null;
		version: string | null;
		users: number | null;
	} | null;
	totals: {
		accounts: number | null;
		openReports: number | null;
		moderationEntries: number | null;
		federatedInstances: number | null;
		relays: number | null;
	};
	pendingAccounts: Array<{
		id: string;
		acct: string;
		display_name: string | null;
		status: string;
		created_at: string | null;
		registration_reason: string | null;
	}>;
	recentAccounts: Array<{
		id: string;
		acct: string;
		display_name: string | null;
		role: string;
		created_at: string | null;
	}>;
	openReports: Array<{
		id: string;
		category: string;
		comment: string;
		created_at: string;
		target: { id: string; acct: string; display_name: string | null } | null;
		statuses: number;
	}>;
	problemInstances: Array<{ domain: string; suspended: boolean; unavailable: boolean; last_seen_at: string | null }>;
	domainBlocks: string[];
	mediaCache: Record<string, unknown> | null;
	recentModeration: Array<{
		action: string;
		target_type: string | null;
		target_id: string | null;
		reason: string | null;
		created_at: string | null;
	}>;
	errors: string[];
}

/** Account details fetched right before executing account actions. */
export interface SentinelAccountInfo {
	id: string;
	acct: string;
	role: string;
	suspended: boolean;
	silenced: boolean;
	approved: boolean;
}

export const ACTION_TARGET_TYPE: Record<SentinelActionType, string> = {
	resolve_report: "report",
	dismiss_report: "report",
	silence_account: "account",
	suspend_account: "account",
	block_domain: "domain",
	enforce_media_cache: "instance",
};

/** Minimum confidence per action, combined with the configured threshold. */
export const ACTION_CONFIDENCE_FLOOR: Record<SentinelActionType, number> = {
	resolve_report: 0.6,
	dismiss_report: 0.85,
	silence_account: 0.75,
	suspend_account: 0.9,
	block_domain: 0.9,
	enforce_media_cache: 0.9,
};
