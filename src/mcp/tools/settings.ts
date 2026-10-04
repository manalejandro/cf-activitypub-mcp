import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ToolContext } from "../context";
import { run } from "../result";

const ruleSchema = z.object({
	id: z.string().describe("Stable rule identifier, e.g. `1`."),
	text: z.string().describe("Rule text shown to users."),
});

const languageSchema = z.object({
	code: z.string().describe("ISO 639-1/639-3 language code, e.g. `en`."),
	name: z.string().optional().describe("English name of the language."),
	native_name: z.string().optional().describe("Native name of the language."),
});

/**
 * Instance settings: server rules, policy documents, supported languages and
 * the registration policy.
 */
export function registerSettingsTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"get_instance_settings",
		{
			title: "Get instance settings",
			description:
				"Returns the instance settings managed from the admin panel: rules, privacy policy, terms of service, extended description, languages and the registration policy (enabled, approval required, reason required, message, minimum age, registration URL).",
			inputSchema: z.object({}),
		},
		async () => run(() => ctx.admin().get("/api/v1/admin/instance_settings"))
	);

	server.registerTool(
		"update_instance_settings",
		{
			title: "Update instance settings",
			description:
				"Updates instance settings. Only the fields provided are changed; omitted fields keep their current value. Changes are recorded in the moderation log and invalidate the cached instance payload. Requires a full administrator (the ADMIN_TOKEN grants it).",
			inputSchema: z.object({
				rules: z.array(ruleSchema).optional().describe("Replacement list of server rules."),
				privacy_policy: z.string().optional().describe("Privacy policy text (markdown/plain text)."),
				terms_of_service: z.string().optional().describe("Terms of service text."),
				extended_description: z.string().optional().describe("Long instance description."),
				languages: z.array(languageSchema).optional().describe("Supported languages for the instance."),
				registrations_enabled: z.boolean().optional().describe("Allow new registrations."),
				registrations_approval_required: z.boolean().optional().describe("New sign-ups require manual approval."),
				registrations_reason_required: z.boolean().optional().describe("Applicants must provide a reason."),
				registrations_message: z.string().optional().describe("Message shown on the sign-up page."),
				registrations_min_age: z.string().optional().describe("Minimum age for registration."),
				registrations_url: z.string().optional().describe("External registration URL (empty to clear)."),
			}),
		},
		async (args) =>
			run(async () => {
				const body: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(args)) {
					if (value !== undefined) body[key] = value;
				}
				if (Object.keys(body).length === 0) {
					return { ok: false, message: "No settings were provided; nothing to update." };
				}
				return ctx.admin().put("/api/v1/admin/instance_settings", body);
			})
	);

	return ["get_instance_settings", "update_instance_settings"];
}
