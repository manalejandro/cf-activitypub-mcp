import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * Moderation audit trail.
 */
export function registerModerationLogTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"get_moderation_log",
		{
			title: "Get moderation log",
			description:
				"Reads the audit trail of automated and human moderation decisions, with optional filters by target type, action and target id. Returns `{ log, total }`.",
			inputSchema: z.object({
				limit: z.number().int().min(1).max(200).default(50).describe("Entries per page."),
				offset: z.number().int().min(0).default(0).describe("Entries to skip."),
				target_type: z
					.string()
					.optional()
					.describe("Filter by target type, e.g. `account`, `status`, `domain`, `report`, `instance`."),
				action: z
					.string()
					.optional()
					.describe("Filter by action, e.g. `suspended`, `approved`, `blocked`, `resolved`."),
				target_id: z.string().optional().describe("Filter by the exact target id."),
			}),
		},
		async ({ limit, offset, target_type, action, target_id }) =>
			run(() =>
				ctx.admin().get("/api/v1/admin/moderation_log", {
					query: { limit, offset, target_type, action, target_id },
				})
			)
	);

	server.registerTool(
		"manage_moderation_log",
		{
			title: "Manage moderation log",
			description:
				"Deletes one audit entry (`delete_entry`, requires `entry_id`) or wipes the whole audit trail (`clear_all`). Both are destructive; `clear_all` requires `confirm: true` and is itself recorded as a new log entry.",
			inputSchema: z.object({
				action: z.enum(["delete_entry", "clear_all"]).describe("Operation to perform."),
				entry_id: z.string().optional().describe("Log entry id. Required for `delete_entry`."),
				confirm: z.boolean().default(false).describe("Must be `true` for `clear_all`."),
			}),
		},
		async ({ action, entry_id, confirm }) => {
			if (action === "clear_all" && confirm !== true) {
				return fail("`clear_all` wipes the audit trail. Call manage_moderation_log again with confirm: true to proceed.");
			}
			if (action === "delete_entry" && !entry_id) {
				return fail("`entry_id` is required when action is `delete_entry`.");
			}
			return run(() => {
				const client = ctx.admin();
				if (action === "clear_all") return client.delete("/api/v1/admin/moderation_log");
				return client.delete(`/api/v1/admin/moderation_log/${encodeURIComponent(entry_id!)}`);
			});
		}
	);

	return ["get_moderation_log", "manage_moderation_log"];
}
