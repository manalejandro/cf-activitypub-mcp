import { Agent } from "agents";
import { ActivityPubClient, ConfigError } from "../activitypub/client";
import type { AppEnv } from "../config";
import { AnalysisError, analyzeSnapshot } from "./analyze";
import { defaultSentinelSettings } from "./defaults";
import { applySettingsPatch, evaluateProposals, normalizeAction } from "./policy";
import { collectSnapshot, lookupAccountInfo } from "./snapshot";
import {
	type SentinelActionType,
	type SentinelDecision,
	type SentinelDecisionQuery,
	type SentinelDecisionStatus,
	type SentinelProposal,
	type SentinelRunResult,
	type SentinelSettings,
	type SentinelState,
	type SentinelStatus,
	type SentinelUsageStatus,
} from "./types";
import { budgetStatus, utcDay, type NeuronUsage } from "./usage";

/** The Durable Object receives the worker bindings plus the generated Env. */
export type SentinelAgentEnv = Cloudflare.Env & AppEnv;

const CHECK_CALLBACK = "runCheck";

interface DecisionRow {
	id: string;
	run_id: string;
	created_at: string;
	action: string;
	target_type: string | null;
	target_id: string | null;
	target_label: string | null;
	confidence: number | null;
	status: string;
	reason: string;
	result: string | null;
}

interface UsageRow {
	neurons: number;
	runs: number;
	input_tokens: number;
	output_tokens: number;
}

/**
 * Centinela — an AI watchdog that lives in a SQLite-backed Durable Object.
 *
 * It reviews the instance on a schedule (or on demand), asks Workers AI for an
 * analysis, applies deterministic guardrails and — depending on the configured
 * mode — records, proposes or executes administrative actions. Every run and
 * every decision is persisted locally for auditing.
 */
export class SentinelAgent extends Agent<SentinelAgentEnv, SentinelState> {
	initialState: SentinelState = {
		settings: null,
		lastRunAt: null,
		lastRunId: null,
		lastRunStatus: null,
		lastRunSummary: null,
		consecutiveErrors: 0,
		totalRuns: 0,
		totalActionsExecuted: 0,
	};

	async onStart(): Promise<void> {
		this.ensureTables();
		if (!this.state.settings) {
			this.setState({ ...this.state, settings: defaultSentinelSettings(this.env) });
		}
		await this.syncSchedule();
	}

	/** Current configuration, last run, schedule and today's AI usage. */
	async getStatus(): Promise<SentinelStatus> {
		this.ensureTables();
		const settings = this.getSettings();
		const schedules = (await this.listSchedules({ type: "interval" })).filter(
			(schedule) => schedule.callback === CHECK_CALLBACK
		);
		const total = this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM sentinel_decisions`;
		return {
			settings,
			lastRunAt: this.state.lastRunAt,
			lastRunId: this.state.lastRunId,
			lastRunStatus: this.state.lastRunStatus,
			lastRunSummary: this.state.lastRunSummary,
			nextRunAt: schedules[0] ? new Date(schedules[0].time * 1000).toISOString() : null,
			consecutiveErrors: this.state.consecutiveErrors,
			totalRuns: this.state.totalRuns,
			totalActionsExecuted: this.state.totalActionsExecuted,
			decisionsTotal: Number(total[0]?.n ?? 0),
			usage: this.usageStatus(settings),
		};
	}

	/** Applies a validated configuration patch and syncs the schedule. */
	async configure(patch: Record<string, unknown>): Promise<SentinelStatus> {
		const current = this.getSettings();
		const next = applySettingsPatch(current, patch);
		this.setState({ ...this.state, settings: next });
		await this.syncSchedule();
		return this.getStatus();
	}

	/** Enables or disables the periodic checks without changing anything else. */
	async setEnabled(enabled: boolean): Promise<SentinelStatus> {
		return this.configure({ enabled });
	}

	/**
	 * Runs one check. Scheduled invocations skip when the Sentinel is disabled;
	 * manual invocations always run (useful to dry-run a configuration).
	 */
	async runCheck(payload: { trigger?: "schedule" | "manual" } = {}): Promise<SentinelRunResult> {
		this.ensureTables();
		const trigger = payload.trigger === "manual" ? "manual" : "schedule";
		const settings = this.getSettings();
		const startedAt = new Date().toISOString();
		const runId = crypto.randomUUID();

		if (!settings.enabled && trigger === "schedule") {
			return {
				runId,
				status: "skipped",
				startedAt,
				finishedAt: startedAt,
				trigger,
				mode: settings.mode,
				summary: "Sentinel disabled; scheduled check skipped.",
				severity: "normal",
				findings: [],
				decisions: [],
			};
		}

		const usageToday = this.usageStatus(settings);
		if (usageToday.remaining !== null && usageToday.remaining <= 0) {
			const finishedAt = new Date().toISOString();
			const summary = `Daily neuron budget exhausted (${usageToday.neuronsUsed}/${settings.dailyNeuronBudget} neurons used today).`;
			this.insertRun({
				id: runId,
				startedAt,
				finishedAt,
				trigger,
				mode: settings.mode,
				status: "skipped",
				severity: null,
				summary,
				findings: null,
				actionsProposed: 0,
				actionsExecuted: 0,
				error: null,
			});
			this.setState({
				...this.state,
				lastRunAt: startedAt,
				lastRunId: runId,
				lastRunStatus: "skipped",
				lastRunSummary: summary,
			});
			return {
				runId,
				status: "skipped",
				startedAt,
				finishedAt,
				trigger,
				mode: settings.mode,
				summary,
				severity: "normal",
				findings: [],
				decisions: [],
			};
		}

		try {
			const client = this.createClient();
			const snapshot = await collectSnapshot(client, this.env.ACTIVITYPUB_URL ?? "");
			if (!snapshot.instance) {
				const reason = snapshot.errors[0] ?? "no response from the public instance endpoint";
				throw new Error(`The ActivityPub instance is unreachable: ${reason}`);
			}
			const { analysis, usage } = await analyzeSnapshot(this.env.AI, settings, snapshot);
			this.recordUsage(usage);

			const accountIds = analysis.proposals
				.filter((proposal) => {
					const action = normalizeAction(proposal.action);
					return action === "silence_account" || action === "suspend_account";
				})
				.map((proposal) => proposal.target_id)
				.filter(Boolean);
			const accountInfo = await lookupAccountInfo(client, accountIds);
			const domainBlocks = new Set(snapshot.domainBlocks.map((domain) => domain.toLowerCase()));
			const recentKeys = this.recentDecisionKeys(settings.cooldownHours);

			const outcomes = evaluateProposals({
				settings,
				mode: settings.mode,
				proposals: analysis.proposals,
				accountInfo,
				domainBlocks,
				recentKeys,
			});

			const decisions: SentinelDecision[] = [];
			let executed = 0;
			for (const outcome of outcomes) {
				let status: SentinelDecisionStatus = outcome.status;
				let result: string | null = null;

				if (outcome.execute) {
					try {
						const apiResult = await this.executeAction(
							client,
							outcome.action,
							outcome.proposal,
							outcome.reason
						);
						status = "executed";
						executed += 1;
						result = safeJson(apiResult ?? { ok: true });
					} catch (error) {
						status = "failed";
						result = safeJson({ error: error instanceof Error ? error.message : String(error) });
					}
				}

				const decision: SentinelDecision = {
					id: crypto.randomUUID(),
					runId,
					createdAt: new Date().toISOString(),
					action: outcome.action,
					targetType: outcome.targetType,
					targetId: outcome.proposal.target_id || null,
					targetLabel: outcome.proposal.target_label || null,
					confidence: outcome.proposal.confidence,
					status,
					reason: outcome.reason,
					result,
				};
				this.insertDecision(decision);
				decisions.push(decision);
			}

			const finishedAt = new Date().toISOString();
			this.insertRun({
				id: runId,
				startedAt,
				finishedAt,
				trigger,
				mode: settings.mode,
				status: "ok",
				severity: analysis.severity,
				summary: analysis.summary,
				findings: safeJson(analysis.findings),
				actionsProposed: outcomes.filter((outcome) => outcome.execute).length,
				actionsExecuted: executed,
				error: null,
			});

			this.setState({
				...this.state,
				lastRunAt: startedAt,
				lastRunId: runId,
				lastRunStatus: "ok",
				lastRunSummary: analysis.summary,
				consecutiveErrors: 0,
				totalRuns: this.state.totalRuns + 1,
				totalActionsExecuted: this.state.totalActionsExecuted + executed,
			});

			const result: SentinelRunResult = {
				runId,
				status: "ok",
				startedAt,
				finishedAt,
				trigger,
				mode: settings.mode,
				summary: analysis.summary,
				severity: analysis.severity,
				findings: analysis.findings,
				decisions,
			};
			await this.notify(settings, result);
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// A malformed model answer still consumed neurons: bill it.
			if (error instanceof AnalysisError) this.recordUsage(error.usage);
			const finishedAt = new Date().toISOString();
			this.insertRun({
				id: runId,
				startedAt,
				finishedAt,
				trigger,
				mode: settings.mode,
				status: "error",
				severity: null,
				summary: null,
				findings: null,
				actionsProposed: 0,
				actionsExecuted: 0,
				error: message,
			});
			this.setState({
				...this.state,
				lastRunAt: startedAt,
				lastRunId: runId,
				lastRunStatus: "error",
				lastRunSummary: message,
				consecutiveErrors: this.state.consecutiveErrors + 1,
				totalRuns: this.state.totalRuns + 1,
			});
			return {
				runId,
				status: "error",
				startedAt,
				finishedAt,
				trigger,
				mode: settings.mode,
				summary: message,
				severity: "critical",
				findings: [],
				decisions: [],
				error: message,
			};
		}
	}

	/** Paginated decision history, newest first. */
	async listDecisions(
		query: SentinelDecisionQuery = {}
	): Promise<{ decisions: SentinelDecision[]; total: number }> {
		this.ensureTables();
		const limit = clamp(query.limit ?? 20, 1, 100);
		const offset = Math.max(query.offset ?? 0, 0);
		const status = query.status ?? null;
		const action = query.action ?? null;

		const rows = this.sql<DecisionRow>`
			SELECT id, run_id, created_at, action, target_type, target_id, target_label, confidence, status, reason, result
			FROM sentinel_decisions
			WHERE (${status} IS NULL OR status = ${status})
			  AND (${action} IS NULL OR action = ${action})
			ORDER BY created_at DESC, rowid DESC
			LIMIT ${limit} OFFSET ${offset}
		`;
		const total = this.sql<{ n: number }>`
			SELECT COUNT(*) AS n FROM sentinel_decisions
			WHERE (${status} IS NULL OR status = ${status})
			  AND (${action} IS NULL OR action = ${action})
		`;
		return {
			decisions: rows.map(rowToDecision),
			total: Number(total[0]?.n ?? 0),
		};
	}

	/** Deletes the decision and run history. */
	async clearDecisions(): Promise<{ removed: number }> {
		this.ensureTables();
		const before = this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM sentinel_decisions`;
		this.sql`DELETE FROM sentinel_decisions`;
		this.sql`DELETE FROM sentinel_runs`;
		return { removed: Number(before[0]?.n ?? 0) };
	}

	// ── internals ──────────────────────────────────────────────────────────

	private getSettings(): SentinelSettings {
		return this.state.settings ?? defaultSentinelSettings(this.env);
	}

	private createClient(): ActivityPubClient {
		const url = this.env.ACTIVITYPUB_URL;
		const token = this.env.ADMIN_TOKEN;
		if (!url) throw new ConfigError("ACTIVITYPUB_URL is not configured");
		if (!token) throw new ConfigError("ADMIN_TOKEN is not configured");
		return new ActivityPubClient(url, token);
	}

	/** Keeps exactly one interval schedule matching the current settings. */
	private async syncSchedule(): Promise<void> {
		const settings = this.getSettings();
		const schedules = (await this.listSchedules({ type: "interval" })).filter(
			(schedule) => schedule.callback === CHECK_CALLBACK
		);
		const desired = settings.enabled ? settings.intervalSeconds : null;
		let keepId: string | null = null;

		for (const schedule of schedules) {
			const interval = "intervalSeconds" in schedule ? schedule.intervalSeconds : null;
			if (desired !== null && keepId === null && interval === desired) {
				keepId = schedule.id;
				continue;
			}
			await this.cancelSchedule(schedule.id);
		}

		if (desired !== null && keepId === null) {
			await this.scheduleEvery(desired, CHECK_CALLBACK, { trigger: "schedule" });
		}
	}

	private async executeAction(
		client: ActivityPubClient,
		action: SentinelActionType,
		proposal: SentinelProposal,
		reason: string
	): Promise<unknown> {
		const id = encodeURIComponent(proposal.target_id);
		switch (action) {
			case "resolve_report":
				return client.post(`/api/v1/admin/reports/${id}/resolve`);
			case "dismiss_report":
				return client.post(`/api/v1/admin/reports/${id}/dismiss`);
			case "silence_account":
				return client.post(`/api/v1/admin/accounts/${id}/silence`);
			case "suspend_account":
				return client.post(`/api/v1/admin/accounts/${id}/suspend`);
			case "block_domain":
				return client.post("/api/v1/admin/domain_blocks", {
					domain: proposal.target_id,
					severity: "suspend",
					reject_media: true,
					reject_reports: true,
					private_comment: `Centinela: ${reason}`.slice(0, 200),
				});
			case "enforce_media_cache":
				return client.post("/api/v1/admin/media_cache");
		}
	}

	private recentDecisionKeys(cooldownHours: number): Set<string> {
		if (cooldownHours <= 0) return new Set();
		const cutoff = new Date(Date.now() - cooldownHours * 3_600_000).toISOString();
		const rows = this.sql<{ action: string; target_id: string | null }>`
			SELECT action, target_id FROM sentinel_decisions
			WHERE created_at >= ${cutoff}
			  AND status IN ('executed', 'proposed')
			  AND target_id IS NOT NULL
		`;
		return new Set(rows.map((row) => `${row.action}:${String(row.target_id).toLowerCase()}`));
	}

	/** Today's neuron ledger plus the configured budget. */
	private usageStatus(settings: SentinelSettings): SentinelUsageStatus {
		const day = utcDay();
		const rows = this.sql<UsageRow>`
			SELECT neurons, runs, input_tokens, output_tokens FROM sentinel_usage WHERE day = ${day}
		`;
		const row = rows[0];
		const neuronsUsed = row ? Number(row.neurons) : 0;
		const budget = budgetStatus(settings.dailyNeuronBudget, neuronsUsed);
		return {
			day,
			neuronsUsed,
			dailyNeuronBudget: settings.dailyNeuronBudget,
			remaining: budget.remaining,
			runs: row ? Number(row.runs) : 0,
			inputTokens: row ? Number(row.input_tokens) : 0,
			outputTokens: row ? Number(row.output_tokens) : 0,
		};
	}

	/** Adds one AI call to today's neuron ledger (upsert). */
	private recordUsage(usage: NeuronUsage): void {
		const day = utcDay();
		const now = new Date().toISOString();
		this.sql`
			INSERT INTO sentinel_usage (day, neurons, runs, input_tokens, output_tokens, updated_at)
			VALUES (${day}, ${usage.neurons}, 1, ${usage.promptTokens}, ${usage.completionTokens}, ${now})
			ON CONFLICT(day) DO UPDATE SET
				neurons = neurons + ${usage.neurons},
				runs = runs + 1,
				input_tokens = input_tokens + ${usage.promptTokens},
				output_tokens = output_tokens + ${usage.completionTokens},
				updated_at = ${now}
		`;
	}

	private async notify(settings: SentinelSettings, result: SentinelRunResult): Promise<void> {
		if (!settings.notifyWebhook) return;
		try {
			await fetch(settings.notifyWebhook, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					source: "cf-activitypub-mcp/sentinel",
					...result,
				}),
				signal: AbortSignal.timeout(10_000),
			});
		} catch (error) {
			console.error("[sentinel] webhook notification failed:", error);
		}
	}

	private ensureTables(): void {
		this.sql`
			CREATE TABLE IF NOT EXISTS sentinel_decisions (
				id TEXT PRIMARY KEY,
				run_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				action TEXT NOT NULL,
				target_type TEXT,
				target_id TEXT,
				target_label TEXT,
				confidence REAL,
				status TEXT NOT NULL,
				reason TEXT NOT NULL,
				result TEXT
			)
		`;
		this.sql`CREATE INDEX IF NOT EXISTS idx_sentinel_decisions_created ON sentinel_decisions(created_at)`;
		this.sql`CREATE INDEX IF NOT EXISTS idx_sentinel_decisions_target ON sentinel_decisions(action, target_id)`;
		this.sql`
			CREATE TABLE IF NOT EXISTS sentinel_runs (
				id TEXT PRIMARY KEY,
				started_at TEXT NOT NULL,
				finished_at TEXT,
				trigger TEXT NOT NULL,
				mode TEXT NOT NULL,
				status TEXT NOT NULL,
				severity TEXT,
				summary TEXT,
				findings TEXT,
				actions_proposed INTEGER NOT NULL DEFAULT 0,
				actions_executed INTEGER NOT NULL DEFAULT 0,
				error TEXT
			)
		`;
		this.sql`CREATE INDEX IF NOT EXISTS idx_sentinel_runs_started ON sentinel_runs(started_at)`;
		this.sql`
			CREATE TABLE IF NOT EXISTS sentinel_usage (
				day TEXT PRIMARY KEY,
				neurons INTEGER NOT NULL DEFAULT 0,
				runs INTEGER NOT NULL DEFAULT 0,
				input_tokens INTEGER NOT NULL DEFAULT 0,
				output_tokens INTEGER NOT NULL DEFAULT 0,
				updated_at TEXT NOT NULL
			)
		`;
	}

	private insertDecision(decision: SentinelDecision): void {
		this.sql`
			INSERT INTO sentinel_decisions
				(id, run_id, created_at, action, target_type, target_id, target_label, confidence, status, reason, result)
			VALUES
				(${decision.id}, ${decision.runId}, ${decision.createdAt}, ${decision.action},
				 ${decision.targetType}, ${decision.targetId}, ${decision.targetLabel},
				 ${decision.confidence}, ${decision.status}, ${decision.reason}, ${decision.result})
		`;
	}

	private insertRun(run: {
		id: string;
		startedAt: string;
		finishedAt: string;
		trigger: string;
		mode: string;
		status: string;
		severity: string | null;
		summary: string | null;
		findings: string | null;
		actionsProposed: number;
		actionsExecuted: number;
		error: string | null;
	}): void {
		this.sql`
			INSERT INTO sentinel_runs
				(id, started_at, finished_at, trigger, mode, status, severity, summary, findings, actions_proposed, actions_executed, error)
			VALUES
				(${run.id}, ${run.startedAt}, ${run.finishedAt}, ${run.trigger}, ${run.mode}, ${run.status},
				 ${run.severity}, ${run.summary}, ${run.findings}, ${run.actionsProposed}, ${run.actionsExecuted}, ${run.error})
		`;
	}
}

function rowToDecision(row: DecisionRow): SentinelDecision {
	return {
		id: row.id,
		runId: row.run_id,
		createdAt: row.created_at,
		action: row.action,
		targetType: row.target_type,
		targetId: row.target_id,
		targetLabel: row.target_label,
		confidence: row.confidence === null ? null : Number(row.confidence),
		status: row.status as SentinelDecisionStatus,
		reason: row.reason,
		result: row.result,
	};
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
