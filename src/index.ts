import { createMcpHandler } from "agents/mcp/server";
import { isAuthorized } from "./auth";
import { readConfig, type AppEnv } from "./config";
import { ToolContext } from "./mcp/context";
import { createMcpServer } from "./mcp/server";
import { collectHealth } from "./web/health";
import { renderIndexPage } from "./web/index-page";

// Durable Object class for the AI Sentinel (Centinela). It must be exported
// from the worker entry point so Wrangler can register it.
export { SentinelAgent } from "./sentinel/agent";

/**
 * CF ActivityPub MCP — a remote Model Context Protocol server that exposes the
 * administration API of a CF ActivityPub instance to AI assistants.
 *
 * Routes:
 *   /       — public landing page with live health metrics.
 *   /health — public JSON health report.
 *   /mcp    — Streamable HTTP MCP endpoint (JSON responses, SSE upgrade).
 *   /sse    — SSE-shaped MCP endpoint for clients that require it.
 *
 * `/mcp` and `/sse` require `Authorization: Bearer <MCP_AUTH_TOKEN>`.
 */
export default {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		switch (url.pathname) {
			case "/":
				if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
				return handleIndex(env);
			case "/health":
				if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
				return handleHealth(env);
			case "/mcp":
			case "/sse":
				return handleMcp(request, env, ctx, url.pathname);
			default:
				return jsonResponse({ error: "Not found", endpoints: ["/", "/health", "/mcp", "/sse"] }, 404);
		}
	},
} satisfies ExportedHandler<AppEnv>;

async function handleIndex(env: AppEnv): Promise<Response> {
	const health = await collectHealth(env);
	return new Response(renderIndexPage(health), {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=15",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
		},
	});
}

async function handleHealth(env: AppEnv): Promise<Response> {
	const health = await collectHealth(env);
	return jsonResponse(health, 200, {
		"Cache-Control": "public, max-age=15",
		"Access-Control-Allow-Origin": "*",
	});
}

async function handleMcp(
	request: Request,
	env: AppEnv,
	ctx: ExecutionContext,
	pathname: "/mcp" | "/sse"
): Promise<Response> {
	const config = readConfig(env);
	const cors = corsHeaders();

	if (!config.authToken) {
		return jsonResponse(
			{ error: "This MCP server is not configured: MCP_AUTH_TOKEN is missing." },
			503,
			cors
		);
	}

	// CORS preflight is answered by the MCP handler; all other requests must
	// present the bearer token before any protocol work happens.
	if (request.method !== "OPTIONS" && !(await isAuthorized(request, config.authToken))) {
		return jsonResponse({ error: "Unauthorized" }, 401, {
			...cors,
			"WWW-Authenticate": 'Bearer realm="cf-activitypub-mcp"',
		});
	}

	const toolContext = new ToolContext(config, env);
	const handler = createMcpHandler(() => createMcpServer(toolContext), {
		route: pathname,
		// `/mcp` answers with JSON and upgrades to SSE only when needed;
		// `/sse` always streams so SSE-first clients can consume it directly.
		responseMode: pathname === "/sse" ? "sse" : "auto",
		allowedHostnames: config.allowedHostnames.length > 0 ? config.allowedHostnames : undefined,
		allowedOriginHostnames: config.allowedOriginHostnames,
		onerror: (error) => console.error(`[mcp] ${pathname}:`, error),
	});

	return handler(request, env, ctx);
}

function jsonResponse(payload: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
	});
}

function methodNotAllowed(allow: string[]): Response {
	return jsonResponse({ error: "Method not allowed" }, 405, { Allow: allow.join(", ") });
}

/** CORS headers matching the MCP handler defaults. */
function corsHeaders(): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers":
			"Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
		"Access-Control-Expose-Headers": "mcp-session-id",
	};
}
