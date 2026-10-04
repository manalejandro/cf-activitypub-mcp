import type { AppEnv } from "../config";
import { DEFAULT_SENTINEL_MODEL, applySettingsPatch } from "./policy";
import { SENTINEL_ACTION_TYPES, type SentinelSettings } from "./types";

/**
 * Seeds the Sentinel settings from environment variables on first boot.
 * Afterwards the configuration lives in the Durable Object and is managed
 * through the MCP tools.
 */
export function defaultSentinelSettings(env: AppEnv): SentinelSettings {
	const base: SentinelSettings = {
		enabled: false,
		mode: "observe",
		intervalSeconds: 900,
		model: DEFAULT_SENTINEL_MODEL,
		maxActionsPerRun: 3,
		minConfidence: 0.8,
		cooldownHours: 24,
		dailyNeuronBudget: 10_000,
		allowedActions: [...SENTINEL_ACTION_TYPES],
		protectedDomains: [],
		notifyWebhook: null,
		updatedAt: new Date().toISOString(),
	};

	const patch: Record<string, unknown> = {};
	if (env.SENTINEL_ENABLED !== undefined) {
		patch.enabled = env.SENTINEL_ENABLED === "true" || env.SENTINEL_ENABLED === "1";
	}
	if (env.SENTINEL_MODE) patch.mode = env.SENTINEL_MODE;
	if (env.SENTINEL_INTERVAL_SECONDS) patch.intervalSeconds = Number(env.SENTINEL_INTERVAL_SECONDS);
	if (env.SENTINEL_MODEL) patch.model = env.SENTINEL_MODEL;
	if (env.SENTINEL_MAX_ACTIONS) patch.maxActionsPerRun = Number(env.SENTINEL_MAX_ACTIONS);
	if (env.SENTINEL_MIN_CONFIDENCE) patch.minConfidence = Number(env.SENTINEL_MIN_CONFIDENCE);
	if (env.SENTINEL_COOLDOWN_HOURS) patch.cooldownHours = Number(env.SENTINEL_COOLDOWN_HOURS);
	if (env.SENTINEL_DAILY_NEURON_BUDGET) patch.dailyNeuronBudget = Number(env.SENTINEL_DAILY_NEURON_BUDGET);
	if (env.SENTINEL_ALLOWED_ACTIONS) {
		patch.allowedActions = env.SENTINEL_ALLOWED_ACTIONS.split(",").map((value) => value.trim()).filter(Boolean);
	}
	if (env.SENTINEL_PROTECTED_DOMAINS) {
		patch.protectedDomains = env.SENTINEL_PROTECTED_DOMAINS.split(",").map((value) => value.trim()).filter(Boolean);
	}
	if (env.SENTINEL_NOTIFY_WEBHOOK) patch.notifyWebhook = env.SENTINEL_NOTIFY_WEBHOOK;

	return applySettingsPatch(base, patch);
}
