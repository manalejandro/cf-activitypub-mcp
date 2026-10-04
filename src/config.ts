/**
 * Environment configuration for the CF ActivityPub MCP worker.
 *
 * The worker needs two independent credentials:
 *
 *  - `ADMIN_TOKEN`   — the shared operator secret of the CF ActivityPub
 *                      instance (see cf-activitypub-next). It is sent as a
 *                      Bearer token to the instance admin API.
 *  - `MCP_AUTH_TOKEN` — the bearer token that MCP clients must present to use
 *                      this server. Keeping it separate means the MCP can be
 *                      revoked or rotated without touching the instance.
 */

export interface AppEnv {
	/** Public base URL of the CF ActivityPub instance, e.g. `https://social.example.com`. */
	ACTIVITYPUB_URL?: string;
	/** Name reported by the MCP server (defaults to `cf-activitypub-mcp`). */
	MCP_SERVER_NAME?: string;
	/** Version reported by the MCP server. */
	MCP_SERVER_VERSION?: string;
	/** Comma-separated Host allowlist for the MCP endpoints (custom domains). */
	MCP_ALLOWED_HOSTNAMES?: string;
	/** Comma-separated browser Origin allowlist, or `*` to delegate validation upstream. */
	MCP_ALLOWED_ORIGINS?: string;
	/** Secret: bearer token required by `/mcp` and `/sse`. */
	MCP_AUTH_TOKEN?: string;
	/** Secret: bearer token for the CF ActivityPub admin API. */
	ADMIN_TOKEN?: string;
}

export interface McpConfig {
	/** Normalized instance base URL (no trailing slash) or `null` when unset. */
	instanceUrl: string | null;
	/** Operator token for the instance admin API or `null` when unset. */
	adminToken: string | null;
	/** Bearer token required by this MCP server or `null` when unset. */
	authToken: string | null;
	serverName: string;
	serverVersion: string;
	/** Host header allowlist; empty means "rely on Cloudflare routing". */
	allowedHostnames: string[];
	/** Browser Origin allowlist; `undefined` keeps the SDK defaults. */
	allowedOriginHostnames: string[] | "*" | undefined;
}

export const DEFAULT_SERVER_NAME = "cf-activitypub-mcp";
export const DEFAULT_SERVER_VERSION = "1.0.0";
export const PROJECT_REPOSITORY = "https://github.com/manalejandro/cf-activitypub-mcp";
export const ACTIVITYPUB_REPOSITORY = "https://github.com/manalejandro/cf-activitypub-next";

/** Parses a comma-separated list, trimming blanks and duplicates. */
export function parseList(raw: string | undefined): string[] {
	if (!raw) return [];
	const seen = new Set<string>();
	for (const item of raw.split(",")) {
		const value = item.trim();
		if (value) seen.add(value);
	}
	return [...seen];
}

/**
 * Normalizes an instance URL: requires an http(s) scheme and strips trailing
 * slashes so path joins stay predictable.
 */
export function normalizeBaseUrl(raw: string | undefined): string | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	return url.origin + url.pathname.replace(/\/+$/, "");
}

export function readConfig(env: AppEnv): McpConfig {
	const origins = parseList(env.MCP_ALLOWED_ORIGINS);
	return {
		instanceUrl: normalizeBaseUrl(env.ACTIVITYPUB_URL),
		adminToken: env.ADMIN_TOKEN?.trim() || null,
		authToken: env.MCP_AUTH_TOKEN?.trim() || null,
		serverName: env.MCP_SERVER_NAME?.trim() || DEFAULT_SERVER_NAME,
		serverVersion: env.MCP_SERVER_VERSION?.trim() || DEFAULT_SERVER_VERSION,
		allowedHostnames: parseList(env.MCP_ALLOWED_HOSTNAMES),
		allowedOriginHostnames:
			env.MCP_ALLOWED_ORIGINS?.trim() === "*" ? "*" : origins.length > 0 ? origins : undefined,
	};
}
