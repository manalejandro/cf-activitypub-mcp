import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * Canonical email blocks (registration abuse prevention).
 */
export function registerEmailBlockTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"list_email_blocks",
		{
			title: "List email blocks",
			description:
				"Lists blocked mailboxes (canonical email hashes) with their reference email and reason. Requires a full administrator.",
			inputSchema: z.object({}),
		},
		async () => run(() => ctx.admin().get("/api/v1/admin/canonical_email_blocks"))
	);

	server.registerTool(
		"manage_email_block",
		{
			title: "Manage email block",
			description:
				"Blocks a mailbox so no variant of it can register (`block`, requires `email`), or removes a block (`unblock`, requires the `hash` returned by the list). Every block is recorded in the moderation log.",
			inputSchema: z.object({
				action: z.enum(["block", "unblock"]).describe("Operation to perform."),
				email: z.string().optional().describe("Email address to block. Required for `block`."),
				hash: z.string().optional().describe("Canonical email hash. Required for `unblock`."),
				reason: z.string().optional().describe("Reason stored with the block."),
			}),
		},
		async ({ action, email, hash, reason }) => {
			if (action === "block" && !email) {
				return fail("`email` is required when action is `block`.");
			}
			if (action === "unblock" && !hash) {
				return fail("`hash` is required when action is `unblock`.");
			}
			return run(() => {
				const client = ctx.admin();
				if (action === "unblock") {
					return client.delete("/api/v1/admin/canonical_email_blocks", { query: { hash } });
				}
				return client.post("/api/v1/admin/canonical_email_blocks", { email, reason });
			});
		}
	);

	return ["list_email_blocks", "manage_email_block"];
}
