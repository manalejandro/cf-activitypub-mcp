import { ActivityPubClient } from "../activitypub/client";
import type { InstanceV2 } from "../activitypub/types";
import type { AppEnv } from "../config";
import { readConfig } from "../config";
import { toolNames } from "../mcp/server";

export type OverallStatus = "ok" | "degraded";

export interface HealthReport {
	status: OverallStatus;
	timestamp: string;
	service: {
		name: string;
		version: string;
		status: OverallStatus;
		tools: number;
		transports: string[];
		authentication: "bearer";
		endpoints: { mcp: string; sse: string; health: string };
		configured: {
			instance_url: boolean;
			admin_token: boolean;
			mcp_auth_token: boolean;
		};
	};
	instance: {
		url: string | null;
		reachable: boolean;
		status: number | null;
		latency_ms: number | null;
		title: string | null;
		version: string | null;
		description: string | null;
		users: number | null;
		error?: string;
	};
}

const HEALTH_TIMEOUT_MS = 5_000;

/**
 * Collects the public health report shown on the index page and served at
 * `/health`. It never includes secrets or administrative details.
 */
export async function collectHealth(env: AppEnv): Promise<HealthReport> {
	const config = readConfig(env);
	const configured =
		Boolean(config.instanceUrl) && Boolean(config.adminToken) && Boolean(config.authToken);

	const service: HealthReport["service"] = {
		name: config.serverName,
		version: config.serverVersion,
		status: configured ? "ok" : "degraded",
		tools: toolNames().length,
		transports: ["streamable-http", "sse"],
		authentication: "bearer",
		endpoints: { mcp: "/mcp", sse: "/sse", health: "/health" },
		configured: {
			instance_url: Boolean(config.instanceUrl),
			admin_token: Boolean(config.adminToken),
			mcp_auth_token: Boolean(config.authToken),
		},
	};

	if (!config.instanceUrl) {
		return {
			status: "degraded",
			timestamp: new Date().toISOString(),
			service,
			instance: {
				url: null,
				reachable: false,
				status: null,
				latency_ms: null,
				title: null,
				version: null,
				description: null,
				users: null,
				error: "ACTIVITYPUB_URL is not configured",
			},
		};
	}

	const client = new ActivityPubClient(config.instanceUrl);
	const started = Date.now();
	try {
		const instance = await client.get<InstanceV2>("/api/v2/instance", { timeoutMs: HEALTH_TIMEOUT_MS });
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			service,
			instance: {
				url: config.instanceUrl,
				reachable: true,
				status: 200,
				latency_ms: Date.now() - started,
				title: instance.title ?? null,
				version: instance.version ?? null,
				description: instance.description ?? null,
				users: instance.usage?.users?.active_month ?? null,
			},
		};
	} catch (error) {
		return {
			status: "degraded",
			timestamp: new Date().toISOString(),
			service,
			instance: {
				url: config.instanceUrl,
				reachable: false,
				status: null,
				latency_ms: Date.now() - started,
				title: null,
				version: null,
				description: null,
				users: null,
				error: error instanceof Error ? error.message : String(error),
			},
		};
	}
}
