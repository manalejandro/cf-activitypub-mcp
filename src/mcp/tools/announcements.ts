import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * Instance announcements (the banner shown to users).
 *
 * Note: the instance exposes the announcement list to authenticated actors
 * only, so this MCP can create and delete announcements with the shared
 * ADMIN_TOKEN but cannot read the list back.
 */
export function registerAnnouncementTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"manage_announcement",
		{
			title: "Manage announcement",
			description:
				"Creates (`create`, requires `content`) or deletes (`delete`, requires `announcement_id` and `confirm: true`) an instance announcement. The create response contains the new id. Listing announcements is not available with the shared operator token, which the instance only accepts for authenticated actors.",
			inputSchema: z.object({
				action: z.enum(["create", "delete"]).describe("Operation to perform."),
				content: z.string().optional().describe("Announcement text. Required for `create`."),
				announcement_id: z
					.string()
					.optional()
					.describe("Announcement id. Required for `delete`."),
				confirm: z.boolean().default(false).describe("Must be `true` for `delete`."),
			}),
		},
		async ({ action, content, announcement_id, confirm }) => {
			if (action === "create") {
				if (!content || !content.trim()) return fail("`content` is required when action is `create`.");
				return run(() => ctx.admin().post("/api/v1/announcements", { content: content.trim() }));
			}
			if (!announcement_id) return fail("`announcement_id` is required when action is `delete`.");
			if (confirm !== true) {
				return fail("`delete` is destructive. Call manage_announcement again with confirm: true to proceed.");
			}
			return run(() =>
				ctx.admin().delete(`/api/v1/announcements/${encodeURIComponent(announcement_id)}`)
			);
		}
	);

	return ["manage_announcement"];
}
