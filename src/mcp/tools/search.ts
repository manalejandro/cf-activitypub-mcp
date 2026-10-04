import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { run } from "../result";

/**
 * Federated search over accounts, statuses, hashtags and collections.
 */
export function registerSearchTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"search",
		{
			title: "Search the fediverse",
			description:
				"Searches accounts, statuses, hashtags and collections. Accepts plain queries, `@user@domain` handles and full URLs (resolving remote objects when `resolve` is true). Useful to find an account id before moderating it.",
			inputSchema: z.object({
				query: z.string().describe("Search query, handle or URL."),
				type: z
					.enum(["all", "accounts", "statuses", "hashtags", "collections"])
					.default("all")
					.describe("Restrict the result type."),
				resolve: z
					.boolean()
					.default(false)
					.describe("Fetch and cache matching remote objects from their origin server."),
				limit: z.number().int().min(1).max(40).default(20).describe("Results per type."),
				offset: z.number().int().min(0).default(0).describe("Results to skip."),
			}),
		},
		async ({ query, type, resolve, limit, offset }) =>
			run(() =>
				ctx.public().get("/api/v2/search", {
					query: { q: query, type, resolve, limit, offset },
				})
			)
	);

	return ["search"];
}
