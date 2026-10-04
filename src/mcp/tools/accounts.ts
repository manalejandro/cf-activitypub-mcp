import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { fail, run } from "../result";

const accountStatus = z
	.enum(["all", "active", "pending", "approval_pending", "suspended", "silenced"])
	.default("all")
	.describe(
		"Filter by registration/moderation status: `active` (verified and approved), `pending` (email not verified), `approval_pending` (awaiting approval), `suspended`, `silenced` or `all`."
	);

const accountRole = z
	.enum(["all", "user", "moderator", "admin"])
	.default("all")
	.describe("Filter by instance role.");

/** Actions that require `confirm: true` because they are destructive. */
const CONFIRM_REQUIRED = new Set(["delete", "reject", "suspend", "demote"]);

/**
 * Account administration: listing, inspection and moderation actions.
 */
export function registerAccountTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"list_accounts",
		{
			title: "List accounts",
			description:
				"Lists local and remote accounts known to the instance, with filters for status, role, locality and a username/display-name query. Returns `{ accounts, total }`.",
			inputSchema: z.object({
				query: z.string().optional().describe("Case-insensitive match on username or display name."),
				status: accountStatus,
				role: accountRole,
				local: z.boolean().default(false).describe("Only local accounts."),
				remote: z.boolean().default(false).describe("Only remote (cached) accounts."),
				limit: z.number().int().min(1).max(200).default(40).describe("Accounts per page."),
				page: z.number().int().min(1).default(1).describe("1-based page number."),
			}),
		},
		async ({ query, status, role, local, remote, limit, page }) =>
			run(() =>
				ctx.admin().get("/api/v1/admin/accounts", {
					query: { q: query, status, role, local, remote, limit, page },
				})
			)
	);

	server.registerTool(
		"get_account",
		{
			title: "Get account",
			description:
				"Returns one account with its moderation flags (confirmed, approved, suspended, silenced), role and public profile.",
			inputSchema: z.object({
				account_id: z.string().describe("Local actor id (UUID) or remote actor id."),
			}),
		},
		async ({ account_id }) => run(() => ctx.admin().get(`/api/v1/admin/accounts/${encodeURIComponent(account_id)}`))
	);

	server.registerTool(
		"moderate_account",
		{
			title: "Moderate account",
			description:
				"Runs a moderation action on an account. Actions: approve/unapprove (registration approval), reject (deny a pending sign-up and delete it), silence/unsilence, suspend/unsuspend, promote/demote (user → moderator → admin and back) and delete (permanently remove the account and its data). Destructive actions (`delete`, `reject`, `suspend`, `demote`) require `confirm: true`. The instance enforces its own safety guards (reserved actor, self-actions, last administrator).",
			inputSchema: z.object({
				account_id: z.string().describe("Account id to moderate."),
				action: z
					.enum([
						"approve",
						"unapprove",
						"reject",
						"silence",
						"unsilence",
						"suspend",
						"unsuspend",
						"promote",
						"demote",
						"delete",
					])
					.describe("Moderation action to run."),
				confirm: z
					.boolean()
					.default(false)
					.describe("Must be `true` for destructive actions: delete, reject, suspend, demote."),
			}),
		},
		async ({ account_id, action, confirm }) => {
			if (CONFIRM_REQUIRED.has(action) && confirm !== true) {
				return fail(
					`\`${action}\` is destructive. Call moderate_account again with confirm: true to proceed.`
				);
			}
			const id = encodeURIComponent(account_id);
			return run(() => {
				const client = ctx.admin();
				switch (action) {
					case "approve":
						return client.post(`/api/v1/admin/accounts/${id}/approve`);
					case "unapprove":
						return client.patch(`/api/v1/admin/accounts/${id}`, { action: "unapprove" });
					case "reject":
						return client.post(`/api/v1/admin/accounts/${id}/reject`);
					case "silence":
						return client.post(`/api/v1/admin/accounts/${id}/silence`);
					case "unsilence":
						return client.post(`/api/v1/admin/accounts/${id}/unsilence`);
					case "suspend":
						return client.post(`/api/v1/admin/accounts/${id}/suspend`);
					case "unsuspend":
						return client.post(`/api/v1/admin/accounts/${id}/unsuspend`);
					case "promote":
						return client.post(`/api/v1/admin/accounts/${id}/promote`);
					case "demote":
						return client.post(`/api/v1/admin/accounts/${id}/demote`);
					case "delete":
						return client.delete(`/api/v1/admin/accounts/${id}`);
				}
			});
		}
	);

	server.registerTool(
		"verify_account",
		{
			title: "Verify account fields",
			description:
				"Forces a rel=\"me\" verification refresh for a local or cached remote account, useful to grant the verified badge without waiting for the periodic job.",
			inputSchema: z.object({
				account_id: z.string().describe("Account id whose profile fields should be re-verified."),
			}),
		},
		async ({ account_id }) =>
			run(() => ctx.admin().post("/api/v1/admin/verify_account", { id: account_id }))
	);

	return ["list_accounts", "get_account", "moderate_account", "verify_account"];
}
