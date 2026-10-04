import type { ActivityPubClient } from "../activitypub/client";
import type { InstanceV2, Paginated } from "../activitypub/types";
import type { SentinelAccountInfo, SentinelSnapshot } from "./types";

const MAX_TEXT = 280;
const MAX_ITEMS = 12;

interface AdminAccountRow {
	id: string;
	username?: string;
	domain?: string | null;
	display_name?: string | null;
	created_at?: string | null;
	role?: string;
	suspended?: boolean;
	silenced?: boolean;
	approved?: boolean;
	registration_reason?: string | null;
	account?: { acct?: string; display_name?: string | null } | null;
}

interface AdminReportRow {
	id: string;
	category?: string;
	comment?: string;
	created_at?: string;
	target_account?: { id?: string; acct?: string; display_name?: string | null } | null;
	statuses?: unknown[];
}

interface AdminInstanceRow {
	instance?: {
		domain?: string;
		suspended?: boolean;
		unavailable?: boolean;
		lastSeenAt?: string | null;
	};
}

interface AdminLogRow {
	action?: string;
	target_type?: string | null;
	target_id?: string | null;
	reason?: string | null;
	created_at?: string | null;
}

/**
 * Collects a compact, model-friendly snapshot of the instance. Individual
 * endpoints may fail (permissions, transient errors); failures are reported in
 * `errors` instead of aborting the whole check.
 */
export async function collectSnapshot(client: ActivityPubClient, instanceUrl: string): Promise<SentinelSnapshot> {
	const errors: string[] = [];

	const settled = await Promise.allSettled([
		client.get<InstanceV2>("/api/v2/instance", { timeoutMs: 8_000 }),
		client.get<Paginated<AdminAccountRow>>("/api/v1/admin/accounts", { query: { limit: 1 } }),
		client.get<Paginated<AdminReportRow>>("/api/v1/admin/reports", { query: { limit: MAX_ITEMS } }),
		client.get<Paginated<AdminAccountRow>>("/api/v1/admin/accounts", {
			query: { limit: MAX_ITEMS, local: true, status: "approval_pending" },
		}),
		client.get<Paginated<AdminAccountRow>>("/api/v1/admin/accounts", {
			query: { limit: MAX_ITEMS, local: true, status: "pending" },
		}),
		client.get<Paginated<AdminAccountRow>>("/api/v1/admin/accounts", {
			query: { limit: 5, local: true, status: "active" },
		}),
		client.get<Paginated<AdminInstanceRow>>("/api/v1/admin/instances", {
			query: { limit: MAX_ITEMS, status: "unavailable" },
		}),
		client.get<AdminDomainBlock[]>("/api/v1/admin/domain_blocks"),
		client.get<Paginated<AdminLogRow>>("/api/v1/admin/moderation_log", { query: { limit: 10 } }),
		client.get<{ stats?: Record<string, unknown> }>("/api/v1/admin/media_cache"),
		client.get<Paginated<unknown>>("/api/v1/admin/relays"),
		client.get<Paginated<AdminLogRow>>("/api/v1/admin/moderation_log", { query: { limit: 1 } }),
		client.get<Paginated<AdminInstanceRow>>("/api/v1/admin/instances", { query: { limit: 1 } }),
	]);

	const label = [
		"instance",
		"accounts_total",
		"reports",
		"pending_approval",
		"pending_email",
		"recent_accounts",
		"problem_instances",
		"domain_blocks",
		"recent_moderation",
		"media_cache",
		"relays",
		"moderation_total",
		"instances_total",
	];

	const value = <T>(index: number, fallback: T): T => {
		const result = settled[index];
		if (result.status === "fulfilled") return result.value as T;
		const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
		errors.push(`${label[index]}: ${reason}`);
		return fallback;
	};

	const instance = value<InstanceV2 | null>(0, null);
	const accountsTotal = value<Paginated<AdminAccountRow>>(1, {});
	const reports = value<Paginated<AdminReportRow>>(2, {});
	const approvalPending = value<Paginated<AdminAccountRow>>(3, {});
	const emailPending = value<Paginated<AdminAccountRow>>(4, {});
	const recentAccounts = value<Paginated<AdminAccountRow>>(5, {});
	const problemInstances = value<Paginated<AdminInstanceRow>>(6, {});
	const domainBlocks = value<AdminDomainBlock[]>(7, []);
	const recentModeration = value<Paginated<AdminLogRow>>(8, {});
	const mediaCache = value<{ stats?: Record<string, unknown> }>(9, {});
	const relays = value<Paginated<unknown>>(10, {});
	const moderationTotal = value<Paginated<AdminLogRow>>(11, {});
	const instancesTotal = value<Paginated<AdminInstanceRow>>(12, {});

	const seenAccounts = new Set<string>();
	const pendingAccounts = [...(approvalPending.accounts ?? []), ...(emailPending.accounts ?? [])]
		.filter((row) => {
			if (!row.id || seenAccounts.has(row.id)) return false;
			seenAccounts.add(row.id);
			return true;
		})
		.slice(0, MAX_ITEMS)
		.map((row) => ({
			id: row.id,
			acct: accountHandle(row),
			display_name: truncate(row.display_name ?? row.account?.display_name ?? null, 80),
			status: row.approved === false ? "approval_pending" : "pending",
			created_at: row.created_at ?? null,
			registration_reason: truncate(row.registration_reason ?? null, 200),
		}));

	return {
		collectedAt: new Date().toISOString(),
		instance: instance
			? {
					url: instanceUrl,
					reachable: true,
					latencyMs: null,
					title: instance.title ?? null,
					version: instance.version ?? null,
					users: instance.usage?.users?.active_month ?? null,
				}
			: null,
		totals: {
			accounts: accountsTotal.total ?? null,
			openReports: reports.total ?? null,
			moderationEntries: moderationTotal.total ?? null,
			federatedInstances: instancesTotal.total ?? null,
			relays: relays.total ?? null,
		},
		pendingAccounts,
		recentAccounts: (recentAccounts.accounts ?? []).slice(0, 5).map((row) => ({
			id: row.id,
			acct: accountHandle(row),
			display_name: truncate(row.display_name ?? row.account?.display_name ?? null, 80),
			role: row.role ?? "user",
			created_at: row.created_at ?? null,
		})),
		openReports: (reports.reports ?? []).slice(0, MAX_ITEMS).map((row) => ({
			id: row.id,
			category: row.category ?? "other",
			comment: truncate(row.comment ?? "", MAX_TEXT) ?? "",
			created_at: row.created_at ?? "",
			target: row.target_account?.id
				? {
						id: row.target_account.id,
						acct: row.target_account.acct ?? "",
						display_name: truncate(row.target_account.display_name ?? null, 80),
					}
				: null,
			statuses: Array.isArray(row.statuses) ? row.statuses.length : 0,
		})),
		problemInstances: (problemInstances.instances ?? [])
			.slice(0, MAX_ITEMS)
			.map((row) => ({
				domain: row.instance?.domain ?? "unknown",
				suspended: Boolean(row.instance?.suspended),
				unavailable: Boolean(row.instance?.unavailable),
				last_seen_at: row.instance?.lastSeenAt ?? null,
			})),
		domainBlocks: (Array.isArray(domainBlocks) ? domainBlocks : [])
			.map((block) => block.domain)
			.filter((domain): domain is string => Boolean(domain)),
		mediaCache: pickMediaCacheStats(mediaCache.stats ?? null),
		recentModeration: (recentModeration.log ?? []).slice(0, 10).map((row) => ({
			action: row.action ?? "unknown",
			target_type: row.target_type ?? null,
			target_id: row.target_id ?? null,
			reason: truncate(row.reason ?? null, 160),
			created_at: row.created_at ?? null,
		})),
		errors,
	};
}

/** Fetches the accounts referenced by account-target proposals. */
export async function lookupAccountInfo(
	client: ActivityPubClient,
	ids: string[]
): Promise<Map<string, SentinelAccountInfo>> {
	const result = new Map<string, SentinelAccountInfo>();
	await Promise.all(
		[...new Set(ids)].map(async (id) => {
			try {
				const row = await client.get<{
					id: string;
					username?: string;
					domain?: string | null;
					role?: string;
					suspended?: boolean;
					silenced?: boolean;
					approved?: boolean;
					account?: { acct?: string } | null;
				}>(`/api/v1/admin/accounts/${encodeURIComponent(id)}`);
				if (!row?.id) return;
				result.set(id, {
					id: row.id,
					acct: row.account?.acct ?? accountHandle(row as AdminAccountRow),
					role: row.role ?? "user",
					suspended: Boolean(row.suspended),
					silenced: Boolean(row.silenced),
					approved: row.approved !== false,
				});
			} catch {
				// Unresolvable accounts are blocked later by the policy layer.
			}
		})
	);
	return result;
}

interface AdminDomainBlock {
	domain?: string;
}

function accountHandle(row: AdminAccountRow): string {
	if (row.account?.acct) return row.account.acct;
	const username = row.username ?? "unknown";
	return row.domain ? `${username}@${row.domain}` : `@${username}`;
}

function truncate(value: string | null, max: number): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).replace(/\s+/g, " ").trim();
	if (!text) return null;
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function pickMediaCacheStats(stats: Record<string, unknown> | null): Record<string, unknown> | null {
	if (!stats) return null;
	const picked: Record<string, unknown> = {};
	for (const key of ["objects", "bytes", "maxBytes", "hits", "misses", "pending", "evicted"]) {
		if (stats[key] !== undefined) picked[key] = stats[key];
	}
	return Object.keys(picked).length > 0 ? picked : stats;
}
