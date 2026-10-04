import type { CallToolResult } from "@modelcontextprotocol/server";

/** Successful tool result with a pretty-printed JSON payload. */
export function ok(data: unknown): CallToolResult {
	const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
	return { content: [{ type: "text", text }] };
}

/** Failed tool result (`isError` lets the model retry or explain the failure). */
export function fail(error: unknown): CallToolResult {
	const message = error instanceof Error ? error.message : String(error);
	return { content: [{ type: "text", text: message }], isError: true };
}

/** Runs a tool body, converting thrown errors into MCP error results. */
export async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
	try {
		return ok(await fn());
	} catch (error) {
		return fail(error);
	}
}
