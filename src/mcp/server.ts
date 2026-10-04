import { McpServer } from "@modelcontextprotocol/server";
import { readConfig } from "../config";
import { ToolContext } from "./context";
import { registerAccountTools } from "./tools/accounts";
import { registerAnnouncementTools } from "./tools/announcements";
import { registerDomainBlockTools } from "./tools/domain-blocks";
import { registerEmailBlockTools } from "./tools/email-blocks";
import { registerEmojiTools } from "./tools/emojis";
import { registerInstanceTools } from "./tools/instances";
import { registerLicenseTools } from "./tools/licenses";
import { registerMediaCacheTools } from "./tools/media-cache";
import { registerModerationLogTools } from "./tools/moderation-log";
import { registerOverviewTools } from "./tools/overview";
import { registerRelayTools } from "./tools/relays";
import { registerReportTools } from "./tools/reports";
import { registerSearchTools } from "./tools/search";
import { registerSentinelTools } from "./tools/sentinel";
import { registerSettingsTools } from "./tools/settings";

const SERVER_INSTRUCTIONS = `This server administers a CF ActivityPub (Mastodon-compatible) instance running on Cloudflare Workers.

Start with \`get_instance_overview\` or \`check_instance_health\` to understand the current state, then drill down with the domain-specific tools:
- Accounts: list_accounts, get_account, moderate_account, verify_account
- Reports: list_reports, get_report, manage_report
- Federation: list_instances, manage_instance, list_domain_blocks, manage_domain_block, list_relays, manage_relay
- Content and policy: get_instance_settings, update_instance_settings, list_licenses, manage_license, list_emojis, manage_emoji, manage_announcement, search
- Operations: get_media_cache, manage_media_cache, list_email_blocks, manage_email_block, get_moderation_log, manage_moderation_log
- AI Sentinel (Centinela): get_sentinel_status, configure_sentinel, run_sentinel_check, get_sentinel_decisions, clear_sentinel_decisions

Rules:
1. Destructive actions require an explicit \`confirm: true\` argument; ask the operator before setting it.
2. Moderation actions are audited in the moderation log; do not delete audit entries unless asked.
3. Prefer account ids returned by list_accounts/search over guessing ids.
4. When an operation fails, surface the instance error message instead of retrying blindly.
5. The Sentinel starts in \`observe\` mode. Only switch it to \`enforce\` when the operator explicitly asks and understands the configured allow-list.`;

/**
 * Registers every tool on the given server. Returns the tool names so callers
 * can advertise the catalogue without duplicating it.
 */
export function registerAllTools(server: McpServer, ctx: ToolContext): string[] {
	return [
		...registerOverviewTools(server, ctx),
		...registerSettingsTools(server, ctx),
		...registerAccountTools(server, ctx),
		...registerSearchTools(server, ctx),
		...registerReportTools(server, ctx),
		...registerDomainBlockTools(server, ctx),
		...registerInstanceTools(server, ctx),
		...registerRelayTools(server, ctx),
		...registerLicenseTools(server, ctx),
		...registerModerationLogTools(server, ctx),
		...registerMediaCacheTools(server, ctx),
		...registerEmailBlockTools(server, ctx),
		...registerEmojiTools(server, ctx),
		...registerAnnouncementTools(server, ctx),
		...registerSentinelTools(server, ctx),
	];
}

/** Builds a fresh MCP server for one request (the handler is stateless). */
export function createMcpServer(ctx: ToolContext): McpServer {
	const server = new McpServer(
		{ name: ctx.config.serverName, version: ctx.config.serverVersion },
		{ instructions: SERVER_INSTRUCTIONS }
	);
	registerAllTools(server, ctx);
	return server;
}

let cachedToolNames: string[] | null = null;

/** Static tool catalogue, used by the health endpoint and the index page. */
export function toolNames(): string[] {
	if (!cachedToolNames) {
		const server = new McpServer({ name: "catalogue", version: "0.0.0" });
		cachedToolNames = registerAllTools(server, new ToolContext(readConfig({})));
	}
	return cachedToolNames;
}
