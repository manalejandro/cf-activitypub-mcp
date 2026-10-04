import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * Federation registry: known remote instances, their health and their
 * suspension state.
 */
export function registerInstanceTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"list_instances",
		{
			title: "List federated instances",
			description:
				"Lists the federation registry (known remote instances) with status filters and search. Returns `{ instances, total, page, limit }`.",
			inputSchema: z.object({
				query: z.string().optional().describe("Match on the instance domain."),
				status: z
					.enum(["all", "healthy", "unreachable", "suspended", "dormant"])
					.default("all")
					.describe("Filter by registry status."),
				limit: z.number().int().min(1).max(200).default(40).describe("Instances per page."),
				page: z.number().int().min(1).default(1).describe("1-based page number."),
			}),
		},
		async ({ query, status, limit, page }) =>
			run(() => ctx.admin().get("/api/v1/admin/instances", { query: { q: query, status, limit, page } }))
	);

	server.registerTool(
		"manage_instance",
		{
			title: "Manage federated instance",
			description:
				"Manages a remote instance in the federation registry: `add`/`refresh` fetches its metadata, `reset` clears delivery-failure state so deliveries resume, `suspend`/`unsuspend` toggle instance suspension, and `purge` deletes every cached actor and post from that domain. `purge` and `suspend` require `confirm: true`.",
			inputSchema: z.object({
				domain: z.string().describe("Remote instance domain, e.g. `mastodon.social`."),
				action: z
					.enum(["add", "refresh", "reset", "suspend", "unsuspend", "purge"])
					.default("refresh")
					.describe("Operation to perform."),
				confirm: z
					.boolean()
					.default(false)
					.describe("Must be `true` for `purge` and `suspend`."),
			}),
		},
		async ({ domain, action, confirm }) => {
			if ((action === "purge" || action === "suspend") && confirm !== true) {
				return fail(`\`${action}\` is destructive. Call manage_instance again with confirm: true to proceed.`);
			}
			return run(() => {
				const client = ctx.admin();
				if (action === "purge") {
					return client.delete("/api/v1/admin/instances", { query: { domain } });
				}
				return client.post("/api/v1/admin/instances", {
					domain,
					action: action === "add" ? "add" : action,
				});
			});
		}
	);

	return ["list_instances", "manage_instance"];
}
