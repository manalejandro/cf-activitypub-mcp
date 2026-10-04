import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { AppEnv } from "../src/config";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const TEST_ENV: AppEnv = {
	// Port 9 (discard) on loopback fails fast without DNS noise in workerd.
	ACTIVITYPUB_URL: "http://127.0.0.1:9",
	ADMIN_TOKEN: "admin-secret",
	MCP_AUTH_TOKEN: "mcp-secret",
	MCP_SERVER_NAME: "cf-activitypub-mcp",
	MCP_SERVER_VERSION: "1.0.0",
};

async function fetchWorker(request: Request, env: AppEnv = TEST_ENV): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

function mcpRequest(body: unknown, path = "/mcp", token = "mcp-secret"): Request {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json",
		"MCP-Protocol-Version": "2026-07-28",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	// The modern revision requires the method (and tool name for tools/call)
	// in dedicated headers.
	const message = body as { method?: string; params?: { name?: string } };
	if (message.method) headers["Mcp-Method"] = message.method;
	if (message.method === "tools/call" && message.params?.name) headers["Mcp-Name"] = message.params.name;
	return new IncomingRequest(`https://mcp.example.com${path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

function modernCall(method: string, params: Record<string, unknown>, id = 1): unknown {
	return {
		jsonrpc: "2.0",
		id,
		method,
		params: {
			...params,
			_meta: {
				"io.modelcontextprotocol/protocolVersion": "2026-07-28",
				"io.modelcontextprotocol/clientCapabilities": {},
			},
		},
	};
}

describe("worker routes", () => {
	it("serves the landing page with repository links", async () => {
		const response = await fetchWorker(new IncomingRequest("https://mcp.example.com/"));
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/html");
		const html = await response.text();
		expect(html).toContain("CF ActivityPub");
		expect(html).toContain("github.com/manalejandro/cf-activitypub-mcp");
		expect(html).toContain("github.com/manalejandro/cf-activitypub-next");
	});

	it("serves the health report", async () => {
		const response = await fetchWorker(new IncomingRequest("https://mcp.example.com/health"));
		expect(response.status).toBe(200);
		const health = (await response.json()) as {
			service: { tools: number; configured: Record<string, boolean> };
			instance: { url: string };
			sentinel: unknown;
		};
		expect(health.service.tools).toBeGreaterThanOrEqual(35);
		expect(health.service.configured.instance_url).toBe(true);
		expect(health.instance.url).toBe("http://127.0.0.1:9");
		// The test environment does not configure the SENTINEL binding.
		expect(health.sentinel).toBeNull();
	});

	it("reports missing configuration without leaking secrets", async () => {
		const response = await fetchWorker(new IncomingRequest("https://mcp.example.com/health"), {});
		const health = (await response.json()) as {
			service: { configured: Record<string, boolean> };
			instance: { reachable: boolean };
		};
		expect(health.service.configured.instance_url).toBe(false);
		expect(health.service.configured.admin_token).toBe(false);
		expect(health.instance.reachable).toBe(false);
	});

	it("returns 404 for unknown routes", async () => {
		const response = await fetchWorker(new IncomingRequest("https://mcp.example.com/nope"));
		expect(response.status).toBe(404);
	});
});

describe("mcp endpoint authentication", () => {
	it("rejects requests without a token", async () => {
		const response = await fetchWorker(mcpRequest({}, "/mcp", ""));
		expect(response.status).toBe(401);
	});

	it("rejects requests with the wrong token", async () => {
		const response = await fetchWorker(mcpRequest({}, "/mcp", "wrong"));
		expect(response.status).toBe(401);
	});

	it("closes the endpoint when MCP_AUTH_TOKEN is unset", async () => {
		const response = await fetchWorker(mcpRequest({}), { ...TEST_ENV, MCP_AUTH_TOKEN: undefined });
		expect(response.status).toBe(503);
	});
});

describe("mcp protocol", () => {
	it("lists the full tool catalogue over the modern JSON transport", async () => {
		const response = await fetchWorker(mcpRequest(modernCall("tools/list", {})));
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("application/json");
		const payload = (await response.json()) as { result: { tools: { name: string }[] } };
		const names = payload.result.tools.map((tool) => tool.name);
		expect(names).toHaveLength(35);
		expect(names).toContain("get_instance_overview");
		expect(names).toContain("moderate_account");
		expect(names).toContain("manage_media_cache");
		expect(names).toContain("get_sentinel_status");
		expect(names).toContain("configure_sentinel");
		expect(names).toContain("run_sentinel_check");
	});

	it("accepts a legacy initialize handshake", async () => {
		const response = await fetchWorker(
			new IncomingRequest("https://mcp.example.com/mcp", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					Authorization: "Bearer mcp-secret",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "test", version: "0.0.0" },
					},
				}),
			})
		);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('"serverInfo"');
		expect(body).toContain("cf-activitypub-mcp");
	});

	it("serves the SSE endpoint", async () => {
		const response = await fetchWorker(mcpRequest(modernCall("tools/list", {}), "/sse"));
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");
	});

	it("requires explicit confirmation for destructive tools", async () => {
		const response = await fetchWorker(
			mcpRequest(
				modernCall("tools/call", {
					name: "moderate_account",
					arguments: { account_id: "abc", action: "delete" },
				})
			)
		);
		const payload = (await response.json()) as {
			result: { isError?: boolean; content: { text: string }[] };
		};
		expect(payload.result.isError).toBe(true);
		expect(payload.result.content[0].text).toContain("confirm: true");
	});
});

describe("tool calls against the instance API", () => {
	const originalFetch = globalThis.fetch;
	let requests: { url: URL; init: RequestInit }[] = [];

	function stubInstance(response: () => Response): void {
		requests = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push({ url: new URL(String(input)), init: init ?? {} });
			return response();
		}) as typeof fetch;
	}

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("forwards the operator token and only the provided settings", async () => {
		stubInstance(() => Response.json({ ok: true }));
		const response = await fetchWorker(
			mcpRequest(
				modernCall("tools/call", {
					name: "update_instance_settings",
					arguments: { privacy_policy: "Our policy" },
				})
			)
		);
		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
		expect(requests[0].url.toString()).toBe("http://127.0.0.1:9/api/v1/admin/instance_settings");
		expect(requests[0].init.method).toBe("PUT");
		expect(new Headers(requests[0].init.headers).get("Authorization")).toBe("Bearer admin-secret");
		expect(JSON.parse(String(requests[0].init.body))).toEqual({ privacy_policy: "Our policy" });
	});

	it("surfaces instance errors as MCP error results", async () => {
		stubInstance(() => Response.json({ error: "Unauthorized" }, { status: 401 }));
		const response = await fetchWorker(
			mcpRequest(
				modernCall("tools/call", {
					name: "get_instance_settings",
					arguments: {},
				})
			)
		);
		const payload = (await response.json()) as {
			result: { isError?: boolean; content: { text: string }[] };
		};
		expect(payload.result.isError).toBe(true);
		expect(payload.result.content[0].text).toContain("Unauthorized");
	});
});
