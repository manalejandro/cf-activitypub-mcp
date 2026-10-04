import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

/**
 * Remote media cache (R2) statistics and maintenance.
 */
export function registerMediaCacheTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"get_media_cache",
		{
			title: "Get media cache",
			description:
				"Returns remote media cache statistics (objects, bytes, hits, queue), the most served entries and the effective cache configuration.",
			inputSchema: z.object({}),
		},
		async () => run(() => ctx.admin().get("/api/v1/admin/media_cache"))
	);

	server.registerTool(
		"manage_media_cache",
		{
			title: "Manage media cache",
			description:
				"Maintains the remote media cache: `enforce_budget` evicts least-served objects until the configured byte budget is respected, and `purge` deletes every cached object and row. `purge` requires `confirm: true`.",
			inputSchema: z.object({
				action: z.enum(["enforce_budget", "purge"]).describe("Operation to perform."),
				confirm: z.boolean().default(false).describe("Must be `true` for `purge`."),
			}),
		},
		async ({ action, confirm }) => {
			if (action === "purge" && confirm !== true) {
				return fail("`purge` deletes the whole media cache. Call manage_media_cache again with confirm: true to proceed.");
			}
			return run(() => {
				const client = ctx.admin();
				if (action === "purge") return client.delete("/api/v1/admin/media_cache");
				return client.post("/api/v1/admin/media_cache");
			});
		}
	);

	return ["get_media_cache", "manage_media_cache"];
}
