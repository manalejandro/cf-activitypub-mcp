import { afterEach, describe, expect, it } from "vitest";
import { ActivityPubClient, ApiError } from "../src/activitypub/client";

interface CapturedRequest {
	url: URL;
	init: RequestInit;
}

const originalFetch = globalThis.fetch;
let captured: CapturedRequest[] = [];

function stubFetch(handler: (request: CapturedRequest) => Response): void {
	captured = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = { url: new URL(String(input)), init: init ?? {} };
		captured.push(request);
		return handler(request);
	}) as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("ActivityPubClient", () => {
	it("joins paths, appends query params and drops empty values", async () => {
		stubFetch(() => Response.json({ ok: true }));
		const client = new ActivityPubClient("https://social.example.com/");
		await client.get("/api/v1/admin/accounts", {
			query: { limit: 10, status: "all", q: undefined, empty: "" },
		});
		expect(captured).toHaveLength(1);
		expect(captured[0].url.toString()).toBe(
			"https://social.example.com/api/v1/admin/accounts?limit=10&status=all"
		);
	});

	it("sends the operator token as a bearer header", async () => {
		stubFetch(() => Response.json({}));
		await new ActivityPubClient("https://social.example.com", "admin-secret").get("/api/v2/instance");
		const headers = new Headers(captured[0].init.headers);
		expect(headers.get("Authorization")).toBe("Bearer admin-secret");
		expect(headers.get("Accept")).toBe("application/json");
	});

	it("omits the authorization header for public requests", async () => {
		stubFetch(() => Response.json({}));
		await new ActivityPubClient("https://social.example.com").get("/api/v2/instance");
		const headers = new Headers(captured[0].init.headers);
		expect(headers.get("Authorization")).toBeNull();
	});

	it("serializes JSON bodies with the right content type", async () => {
		stubFetch(() => Response.json({ ok: true }));
		await new ActivityPubClient("https://social.example.com", "token").put("/api/v1/admin/instance_settings", {
			privacy_policy: "hello",
		});
		const headers = new Headers(captured[0].init.headers);
		expect(headers.get("Content-Type")).toBe("application/json");
		expect(captured[0].init.body).toBe(JSON.stringify({ privacy_policy: "hello" }));
		expect(captured[0].init.method).toBe("PUT");
	});

	it("returns null for empty successful responses", async () => {
		stubFetch(() => new Response(null, { status: 204 }));
		const result = await new ActivityPubClient("https://social.example.com", "token").delete(
			"/api/v1/admin/accounts/abc"
		);
		expect(result).toBeNull();
	});

	it("raises ApiError with the instance error message", async () => {
		stubFetch(() => Response.json({ error: "Administrator role required" }, { status: 403 }));
		const promise = new ActivityPubClient("https://social.example.com", "token").post(
			"/api/v1/admin/domain_blocks",
			{ domain: "spam.example" }
		);
		await expect(promise).rejects.toBeInstanceOf(ApiError);
		await expect(promise).rejects.toMatchObject({ status: 403, message: "Administrator role required" });
	});

	it("reports unreachable instances with a clear message", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("network down");
		}) as typeof fetch;
		const promise = new ActivityPubClient("https://social.example.com").get("/api/v2/instance");
		await expect(promise).rejects.toMatchObject({ status: 0 });
		await expect(promise).rejects.toThrow(/Could not reach the ActivityPub instance/);
	});
});
