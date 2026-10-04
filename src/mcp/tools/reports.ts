import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * Report (abuse ticket) management.
 */
export function registerReportTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"list_reports",
		{
			title: "List reports",
			description:
				"Lists abuse reports, newest first, including the reported statuses, target/reporter accounts and internal notes. Returns `{ reports, total }`.",
			inputSchema: z.object({
				limit: z.number().int().min(1).max(100).default(40).describe("Reports per page."),
				offset: z.number().int().min(0).default(0).describe("Number of reports to skip."),
			}),
		},
		async ({ limit, offset }) =>
			run(() => ctx.admin().get("/api/v1/admin/reports", { query: { limit, offset } }))
	);

	server.registerTool(
		"get_report",
		{
			title: "Get report",
			description: "Returns a single report with its statuses, accounts and internal notes.",
			inputSchema: z.object({
				report_id: z.string().describe("Report id."),
			}),
		},
		async ({ report_id }) =>
			run(() => ctx.admin().get(`/api/v1/admin/reports/${encodeURIComponent(report_id)}`))
	);

	server.registerTool(
		"manage_report",
		{
			title: "Manage report",
			description:
				"Acts on a report: `resolve` marks it as action taken, `dismiss` deletes it (and its notes), `reopen` clears the action-taken flag, `delete` permanently removes the ticket and `add_note` appends an internal note (never federated). `dismiss` and `delete` require `confirm: true`. Note: `add_note` needs an OAuth token owned by a local actor — the shared ADMIN_TOKEN cannot author notes and the call will fail with 401 in that case.",
			inputSchema: z.object({
				report_id: z.string().describe("Report id."),
				action: z
					.enum(["resolve", "dismiss", "reopen", "delete", "add_note"])
					.describe("Action to run."),
				note: z
					.string()
					.optional()
					.describe("Note content. Required for `add_note`, ignored otherwise."),
				confirm: z
					.boolean()
					.default(false)
					.describe("Must be `true` for `dismiss` and `delete`."),
			}),
		},
		async ({ report_id, action, note, confirm }) => {
			if ((action === "dismiss" || action === "delete") && confirm !== true) {
				return fail(`\`${action}\` is destructive. Call manage_report again with confirm: true to proceed.`);
			}
			if (action === "add_note" && (!note || !note.trim())) {
				return fail("`note` is required when action is `add_note`.");
			}
			const id = encodeURIComponent(report_id);
			return run(() => {
				const client = ctx.admin();
				switch (action) {
					case "resolve":
						return client.post(`/api/v1/admin/reports/${id}/resolve`);
					case "dismiss":
						return client.post(`/api/v1/admin/reports/${id}/dismiss`);
					case "reopen":
						return client.post(`/api/v1/admin/reports/${id}/reopen`);
					case "delete":
						return client.delete(`/api/v1/admin/reports/${id}`);
					case "add_note":
						return client.post(`/api/v1/admin/reports/${id}/notes`, { content: note!.trim() });
				}
			});
		}
	);

	return ["list_reports", "get_report", "manage_report"];
}
