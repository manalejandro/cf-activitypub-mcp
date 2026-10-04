import { describe, expect, it } from "vitest";
import { bearerToken, isAuthorized, secretsMatch } from "../src/auth";
import { normalizeBaseUrl, parseList, readConfig } from "../src/config";

describe("config", () => {
	it("normalizes instance URLs and strips trailing slashes", () => {
		expect(normalizeBaseUrl("https://social.example.com/")).toBe("https://social.example.com");
		expect(normalizeBaseUrl("https://social.example.com/base/")).toBe("https://social.example.com/base");
		expect(normalizeBaseUrl("http://localhost:8787")).toBe("http://localhost:8787");
	});

	it("rejects invalid or non-http URLs", () => {
		expect(normalizeBaseUrl(undefined)).toBeNull();
		expect(normalizeBaseUrl("")).toBeNull();
		expect(normalizeBaseUrl("not-a-url")).toBeNull();
		expect(normalizeBaseUrl("ftp://example.com")).toBeNull();
	});

	it("parses comma-separated lists with deduplication", () => {
		expect(parseList(undefined)).toEqual([]);
		expect(parseList("a, b ,a,,")).toEqual(["a", "b"]);
	});

	it("reads defaults and treats missing secrets as null", () => {
		const config = readConfig({});
		expect(config.instanceUrl).toBeNull();
		expect(config.adminToken).toBeNull();
		expect(config.authToken).toBeNull();
		expect(config.serverName).toBe("cf-activitypub-mcp");
		expect(config.serverVersion).toBe("1.0.0");
		expect(config.allowedOriginHostnames).toBeUndefined();
	});

	it("supports the wildcard origin escape hatch", () => {
		const config = readConfig({ MCP_ALLOWED_ORIGINS: "*" });
		expect(config.allowedOriginHostnames).toBe("*");
	});
});

describe("auth", () => {
	it("compares secrets without leaking length through a shortcut", async () => {
		await expect(secretsMatch("same", "same")).resolves.toBe(true);
		await expect(secretsMatch("same", "different")).resolves.toBe(false);
		await expect(secretsMatch("", "x")).resolves.toBe(false);
	});

	it("extracts bearer tokens case-insensitively", () => {
		expect(bearerToken(new Request("https://example.com", { headers: { Authorization: "Bearer abc" } }))).toBe("abc");
		expect(bearerToken(new Request("https://example.com", { headers: { Authorization: "bearer  abc " } }))).toBe("abc");
		expect(bearerToken(new Request("https://example.com"))).toBeNull();
		expect(bearerToken(new Request("https://example.com", { headers: { Authorization: "Basic abc" } }))).toBeNull();
	});

	it("authorizes only the matching token", async () => {
		const request = new Request("https://example.com", { headers: { Authorization: "Bearer secret" } });
		await expect(isAuthorized(request, "secret")).resolves.toBe(true);
		await expect(isAuthorized(request, "other")).resolves.toBe(false);
		await expect(isAuthorized(request, null)).resolves.toBe(false);
	});
});
