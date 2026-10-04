import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * ActivityPub relay subscriptions.
 */
export function registerRelayTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"list_relays",
		{
			title: "List relays",
			description: "Lists subscribed ActivityPub relays with their subscription state.",
			inputSchema: z.object({}),
		},
		async () => run(() => ctx.admin().get("/api/v1/admin/relays"))
	);

	server.registerTool(
		"manage_relay",
		{
			title: "Manage relay",
			description:
				"Adds a relay or changes its subscription: `add` registers a new relay inbox URL, `enable` subscribes to it, `disable` unsubscribes and `remove` forgets it. `remove` requires `confirm: true`.",
			inputSchema: z.object({
				action: z.enum(["add", "enable", "disable", "remove"]).describe("Operation to perform."),
				inbox_url: z
					.string()
					.optional()
					.describe("Public HTTPS relay inbox URL. Required for `add`."),
				relay_id: z
					.string()
					.optional()
					.describe("Relay id. Required for `enable`, `disable` and `remove`."),
				confirm: z.boolean().default(false).describe("Must be `true` for `remove`."),
			}),
		},
		async ({ action, inbox_url, relay_id, confirm }) => {
			if (action === "remove" && confirm !== true) {
				return fail("`remove` is destructive. Call manage_relay again with confirm: true to proceed.");
			}
			if (action === "add" && !inbox_url) {
				return fail("`inbox_url` is required when action is `add`.");
			}
			if (action !== "add" && !relay_id) {
				return fail(`\`relay_id\` is required when action is \`${action}\`.`);
			}
			return run(() =>
				ctx.admin().post("/api/v1/admin/relays", {
					action,
					inbox_url: inbox_url ?? undefined,
					id: relay_id ?? undefined,
				})
			);
		}
	);

	return ["list_relays", "manage_relay"];
}
