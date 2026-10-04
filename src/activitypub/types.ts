/**
 * Shared shapes returned by the CF ActivityPub API that this MCP inspects.
 */

export interface InstanceV2 {
	uri?: string;
	title?: string;
	version?: string;
	source_url?: string;
	description?: string;
	usage?: { users?: { active_month?: number } };
	languages?: string[];
	registrations?: {
		enabled?: boolean;
		approval_required?: boolean;
		reason_required?: boolean;
		message?: string | null;
		min_age?: number | null;
		url?: string | null;
	};
	[key: string]: unknown;
}

export interface MediaCachePayload {
	stats?: Record<string, unknown>;
	top_served?: unknown[];
	config?: Record<string, unknown>;
}

export interface Paginated<T> {
	total?: number;
	accounts?: T[];
	reports?: T[];
	log?: T[];
	instances?: T[];
	relays?: T[];
	[key: string]: unknown;
}
