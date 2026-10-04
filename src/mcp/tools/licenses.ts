import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * License catalogue (FEP-6757) used by statuses and media.
 */
export function registerLicenseTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"list_licenses",
		{
			title: "List licenses",
			description: "Lists the instance license catalogue (id, name, URL, icon and badge keys).",
			inputSchema: z.object({}),
		},
		async () => run(() => ctx.admin().get("/api/v1/admin/licenses"))
	);

	server.registerTool(
		"manage_license",
		{
			title: "Manage license",
			description:
				"Adds, updates or removes a catalogue entry: `add` requires a name and an HTTPS URL, `update` changes the fields provided for an existing id, and `delete` removes it (statuses keep their stored license URL). `delete` requires `confirm: true`.",
			inputSchema: z.object({
				action: z.enum(["add", "update", "delete"]).describe("Operation to perform."),
				id: z
					.string()
					.optional()
					.describe("Catalogue id. Required for `update` and `delete`; optional for `add` (derived from the name when omitted)."),
				name: z.string().optional().describe("Display name (max 120 chars)."),
				url: z.string().optional().describe("Public HTTPS license URL."),
				icon: z.string().optional().describe("Icon URL (max 500 chars)."),
				badge_keys: z.string().optional().describe("Space-separated badge keys (max 60 chars)."),
				sort_order: z.number().int().optional().describe("Ordering hint (default 100)."),
				confirm: z.boolean().default(false).describe("Must be `true` for `delete`."),
			}),
		},
		async ({ action, id, name, url, icon, badge_keys, sort_order, confirm }) => {
			if (action === "delete" && confirm !== true) {
				return fail("`delete` is destructive. Call manage_license again with confirm: true to proceed.");
			}
			if (action === "add" && (!name || !url)) {
				return fail("`name` and `url` are required when action is `add`.");
			}
			if (action !== "add" && !id) {
				return fail(`\`id\` is required when action is \`${action}\`.`);
			}
			return run(() =>
				ctx.admin().post("/api/v1/admin/licenses", {
					action,
					id: id ?? undefined,
					name: name ?? undefined,
					url: url ?? undefined,
					icon: icon ?? undefined,
					badge_keys: badge_keys ?? undefined,
					sort_order: sort_order ?? undefined,
				})
			);
		}
	);

	return ["list_licenses", "manage_license"];
}
