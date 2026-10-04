import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { InstanceV2, MediaCachePayload, Paginated } from "../../activitypub/types";
import type { ToolContext } from "../context";
import { run } from "../result";

/**
 * Overview and health tools: a quick pulse of the instance and a combined
 * summary that saves several round trips when an agent starts working.
 */
export function registerOverviewTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"check_instance_health",
		{
			title: "Check instance health",
			description:
				"Checks that the CF ActivityPub instance is reachable and returns its public metadata plus the measured latency. Use this before running heavier administrative operations.",
			inputSchema: z.object({}),
		},
		async () =>
			run(async () => {
				const client = ctx.public();
				const started = Date.now();
				try {
					const instance = await client.get<InstanceV2>("/api/v2/instance", { timeoutMs: 8_000 });
					return {
						status: "ok",
						checked_at: new Date().toISOString(),
						instance_url: ctx.config.instanceUrl,
						latency_ms: Date.now() - started,
						instance: summarizeInstance(instance),
					};
				} catch (error) {
					return {
						status: "unreachable",
						checked_at: new Date().toISOString(),
						instance_url: ctx.config.instanceUrl,
						latency_ms: Date.now() - started,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			})
	);

	server.registerTool(
		"get_instance_info",
		{
			title: "Get instance info",
			description:
				"Returns the full public instance payload (title, version, description, languages, registration policy, limits and configuration) served at GET /api/v2/instance.",
			inputSchema: z.object({}),
		},
		async () => run(() => ctx.public().get<InstanceV2>("/api/v2/instance"))
	);

	server.registerTool(
		"get_instance_overview",
		{
			title: "Get instance overview",
			description:
				"Returns a combined administrative summary: public instance metadata, account/report/moderation/federation/relay totals and media cache stats. Individual sections that fail are reported in `warnings` instead of failing the whole call.",
			inputSchema: z.object({}),
		},
		async () =>
			run(async () => {
				const publicClient = ctx.public();
				const admin = ctx.admin();
				const [instance, accounts, reports, moderation, federation, relays, mediaCache] =
					await Promise.allSettled([
						publicClient.get<InstanceV2>("/api/v2/instance", { timeoutMs: 8_000 }),
						admin.get<Paginated<unknown>>("/api/v1/admin/accounts", { query: { limit: 1 } }),
						admin.get<Paginated<unknown>>("/api/v1/admin/reports", { query: { limit: 1 } }),
						admin.get<Paginated<unknown>>("/api/v1/admin/moderation_log", { query: { limit: 1 } }),
						admin.get<Paginated<unknown>>("/api/v1/admin/instances", { query: { limit: 1 } }),
						admin.get<Paginated<unknown>>("/api/v1/admin/relays"),
						admin.get<MediaCachePayload>("/api/v1/admin/media_cache"),
					]);

				const warnings: string[] = [];
				const value = <T>(result: PromiseSettledResult<T>, label: string, fallback: T): T => {
					if (result.status === "fulfilled") return result.value;
					const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
					warnings.push(`${label}: ${reason}`);
					return fallback;
				};

				const instanceValue = value(instance, "instance", null as InstanceV2 | null);
				const accountsValue = value(accounts, "accounts", {} as Paginated<unknown>);
				const reportsValue = value(reports, "reports", {} as Paginated<unknown>);
				const moderationValue = value(moderation, "moderation_log", {} as Paginated<unknown>);
				const federationValue = value(federation, "instances", {} as Paginated<unknown>);
				const relaysValue = value(relays, "relays", {} as Paginated<unknown>);
				const mediaValue = value(mediaCache, "media_cache", null as MediaCachePayload | null);

				return {
					instance: instanceValue ? summarizeInstance(instanceValue) : null,
					totals: {
						accounts: accountsValue.total ?? null,
						open_reports: reportsValue.total ?? null,
						moderation_log_entries: moderationValue.total ?? null,
						federated_instances: federationValue.total ?? null,
						relays: relaysValue.total ?? null,
					},
					media_cache: mediaValue?.stats ?? null,
					warnings,
				};
			})
	);

	return ["check_instance_health", "get_instance_info", "get_instance_overview"];
}

function summarizeInstance(instance: InstanceV2): Record<string, unknown> {
	return {
		uri: instance.uri ?? null,
		title: instance.title ?? null,
		version: instance.version ?? null,
		description: instance.description ?? null,
		users: instance.usage?.users?.active_month ?? null,
		languages: instance.languages ?? [],
		registrations: instance.registrations ?? null,
	};
}
