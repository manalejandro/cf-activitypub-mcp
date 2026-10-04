import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { run } from "../result";

/**
 * Instance-wide domain blocks (federation rules).
 */
export function registerDomainBlockTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"list_domain_blocks",
		{
			title: "List domain blocks",
			description:
				"Lists every instance-wide domain block with its severity (`silence` or `suspend`), media/report rejection flags and comments.",
			inputSchema: z.object({}),
		},
		async () => run(() => ctx.admin().get("/api/v1/admin/domain_blocks"))
	);

	server.registerTool(
		"manage_domain_block",
		{
			title: "Manage domain block",
			description:
				"Blocks or unblocks a domain instance-wide. `block` creates (or replaces) the rule with the given severity and flags; `unblock` removes it. Every change is recorded in the moderation log. Requires a full administrator (the ADMIN_TOKEN grants it).",
			inputSchema: z.object({
				action: z.enum(["block", "unblock"]).describe("Operation to perform."),
				domain: z.string().describe("Domain to block/unblock, e.g. `spam.example`."),
				severity: z
					.enum(["silence", "suspend"])
					.default("suspend")
					.describe("`silence` hides the domain from timelines; `suspend` rejects all federation."),
				reject_media: z.boolean().default(true).describe("Refuse media from the domain."),
				reject_reports: z.boolean().default(true).describe("Refuse reports originating from the domain."),
				private_comment: z.string().optional().describe("Internal note (never published)."),
				public_comment: z.string().optional().describe("Public comment shown on the blocklist."),
				obfuscate: z.boolean().default(false).describe("Obfuscate the domain in public blocklists."),
			}),
		},
		async ({ action, domain, severity, reject_media, reject_reports, private_comment, public_comment, obfuscate }) =>
			run(() => {
				const client = ctx.admin();
				if (action === "unblock") {
					return client.delete("/api/v1/admin/domain_blocks", { query: { domain } });
				}
				return client.post("/api/v1/admin/domain_blocks", {
					domain,
					severity,
					reject_media,
					reject_reports,
					private_comment,
					public_comment,
					obfuscate,
				});
			})
	);

	return ["list_domain_blocks", "manage_domain_block"];
}
