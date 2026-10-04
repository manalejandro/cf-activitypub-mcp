/**
 * Workers AI usage accounting for the Sentinel.
 *
 * Workers AI bills in "Neurons". The AI binding returns token usage for LLM
 * calls, so the Sentinel converts tokens to neurons with the official per-model
 * rates and keeps a per-day ledger in its Durable Object. When a daily budget
 * is configured, checks are skipped once the budget is exhausted until the
 * next UTC day (Cloudflare resets the free allocation at 00:00 UTC).
 *
 * Rates: https://developers.cloudflare.com/workers-ai/platform/pricing/
 * (neurons per million tokens).
 */

export interface ModelRates {
	/** Neurons per million input tokens. */
	input: number;
	/** Neurons per million output tokens. */
	output: number;
}

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export interface NeuronUsage extends TokenUsage {
	/** Estimated neuron cost of the request. */
	neurons: number;
	/** True when tokens were estimated from text instead of provider usage. */
	estimated: boolean;
}

/**
 * Curated rates for the models commonly used as the Sentinel brain. Unknown
 * models fall back to the default model's rates, which err on the expensive
 * side so a budget is never silently overshot.
 */
export const MODEL_RATES: Record<string, ModelRates> = {
	"@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
	"@cf/meta/llama-3.1-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
	"@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 4_119, output: 34_868 },
	"@cf/meta/llama-3.1-8b-instruct": { input: 25_608, output: 75_147 },
	"@cf/meta/llama-3-8b-instruct": { input: 25_608, output: 75_147 },
	"@cf/meta/llama-3.2-1b-instruct": { input: 2_457, output: 18_252 },
	"@cf/meta/llama-3.2-3b-instruct": { input: 4_625, output: 30_475 },
	"@cf/meta/llama-3.1-8b-instruct-fp8": { input: 13_778, output: 26_128 },
	"@cf/meta/llama-3.1-8b-instruct-awq": { input: 11_161, output: 24_215 },
	"@cf/meta/llama-3-8b-instruct-awq": { input: 11_161, output: 24_215 },
	"@cf/meta/llama-4-scout-17b-16e-instruct": { input: 24_545, output: 77_273 },
	"@cf/meta/llama-guard-3-8b": { input: 44_003, output: 2_730 },
	"@cf/qwen/qwen3-30b-a3b-fp8": { input: 4_625, output: 30_475 },
	"@cf/qwen/qwq-32b": { input: 60_000, output: 90_909 },
	"@cf/qwen/qwen2.5-coder-32b-instruct": { input: 60_000, output: 90_909 },
	"@cf/openai/gpt-oss-120b": { input: 31_818, output: 68_182 },
	"@cf/openai/gpt-oss-20b": { input: 18_182, output: 27_273 },
	"@cf/zai-org/glm-4.7-flash": { input: 5_500, output: 36_400 },
	"@cf/google/gemma-3-12b-it": { input: 31_371, output: 50_560 },
	"@cf/mistralai/mistral-small-3.1-24b-instruct": { input: 31_876, output: 50_488 },
	"@cf/ibm-granite/granite-4.0-h-micro": { input: 1_542, output: 10_158 },
	"@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": { input: 45_170, output: 443_756 },
};

export const FALLBACK_RATES: ModelRates = { input: 26_668, output: 204_805 };

export function modelRates(model: string): ModelRates {
	return MODEL_RATES[model] ?? FALLBACK_RATES;
}

/** Converts token usage to neurons for the given model (rounded up). */
export function neuronsFor(model: string, promptTokens: number, completionTokens: number): number {
	const rates = modelRates(model);
	const neurons =
		(promptTokens / 1_000_000) * rates.input + (completionTokens / 1_000_000) * rates.output;
	return Math.ceil(neurons);
}

/** Rough token estimate for responses without provider usage (~4 chars/token). */
export function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

/** UTC day key, matching Cloudflare's 00:00 UTC neuron reset. */
export function utcDay(date: Date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

export interface BudgetStatus {
	/** True when a budget is configured and already exhausted. */
	exhausted: boolean;
	/** Neurons left today, or null when the budget is unlimited. */
	remaining: number | null;
}

/** Pure budget check shared by the agent and the tests. */
export function budgetStatus(dailyBudget: number, usedToday: number): BudgetStatus {
	if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
		return { exhausted: false, remaining: null };
	}
	return {
		exhausted: usedToday >= dailyBudget,
		remaining: Math.max(0, dailyBudget - usedToday),
	};
}
