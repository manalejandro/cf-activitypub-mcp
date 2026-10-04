import { ActivityPubClient, ConfigError } from "../activitypub/client";
import type { McpConfig } from "../config";

/**
 * Per-request tool context. Clients are created lazily so a tool call fails
 * with a precise configuration error instead of the worker refusing to boot.
 */
export class ToolContext {
	constructor(readonly config: McpConfig) {}

	/** Authenticated client (instance admin API). */
	admin(): ActivityPubClient {
		if (!this.config.instanceUrl) {
			throw new ConfigError(
				"ACTIVITYPUB_URL is not configured. Set it to the public URL of your CF ActivityPub instance."
			);
		}
		if (!this.config.adminToken) {
			throw new ConfigError(
				"ADMIN_TOKEN is not configured. Set the same operator secret used by the CF ActivityPub instance."
			);
		}
		return new ActivityPubClient(this.config.instanceUrl, this.config.adminToken);
	}

	/** Unauthenticated client (public instance endpoints). */
	public(): ActivityPubClient {
		if (!this.config.instanceUrl) {
			throw new ConfigError(
				"ACTIVITYPUB_URL is not configured. Set it to the public URL of your CF ActivityPub instance."
			);
		}
		return new ActivityPubClient(this.config.instanceUrl);
	}
}
