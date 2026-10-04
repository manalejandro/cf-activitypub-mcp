# CF ActivityPub MCP

**English** | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/github/v/tag/manalejandro/cf-activitypub-mcp?label=version)](https://github.com/manalejandro/cf-activitypub-mcp/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/manalejandro/cf-activitypub-mcp/pulls)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-6E56CF)](https://modelcontextprotocol.io/)

> A remote [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI assistants administer a [CF ActivityPub](https://github.com/manalejandro/cf-activitypub-next) instance through its administration API — fully hosted on Cloudflare Workers.

## Overview

**CF ActivityPub MCP** is the administration companion for [CF ActivityPub Next](https://github.com/manalejandro/cf-activitypub-next), the Mastodon-compatible ActivityPub server built for Cloudflare Workers.

Point it at your instance with the same `ADMIN_TOKEN` operator secret, connect any MCP-capable assistant, and manage accounts, reports, federation rules, relays, media cache, settings and more through natural conversation. The worker:

- Exposes the full administration surface as **35 well-described MCP tools**.
- Includes **Centinela**, an AI watchdog running on **Cloudflare Durable Objects** that reviews the instance on a schedule, asks **Workers AI** for an analysis and can propose or execute guarded actions.
- Speaks **Streamable HTTP** (`/mcp`, JSON responses) and an **SSE-shaped endpoint** (`/sse`) for clients that require it.
- Requires its own **bearer token** (`MCP_AUTH_TOKEN`) on every MCP request, independent from the instance token.
- Publishes a **public landing page** and a **`/health` JSON report** with live metrics, including the Sentinel state.
- Runs with **Cloudflare observability** (traces, logs and real-time issues) enabled.
- Deploys to a **custom domain** with a single `wrangler deploy`.

> The MCP never stores instance data: every tool call is a thin, authenticated proxy to the CF ActivityPub admin API, which keeps its own audit trail. Centinela stores only its own configuration, run history and decisions inside its Durable Object.

## Architecture

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| MCP transport | [Agents SDK](https://developers.cloudflare.com/agents/) `createMcpHandler` (stateless, MCP SDK v2) |
| Protocols | Streamable HTTP + SSE response shaping, JSON-RPC 2.0 |
| Authentication | Bearer token (`MCP_AUTH_TOKEN`) with constant-time comparison |
| Upstream | CF ActivityPub admin API (`ADMIN_TOKEN`) |
| AI Sentinel | Cloudflare Durable Objects (SQLite-backed) + Agents SDK scheduling + Workers AI |
| Observability | Workers Logs, Traces and Issues |
| Language | TypeScript, Zod schemas |

## Endpoints

| Path | Method | Auth | Description |
|---|---|---|---|
| `/` | GET | Public | Landing page with live health metrics |
| `/health` | GET | Public | JSON health report (worker + instance) |
| `/mcp` | POST | Bearer | Streamable HTTP MCP endpoint; JSON by default, SSE when needed |
| `/sse` | POST | Bearer | SSE-shaped MCP endpoint for SSE-first clients |
| `/mcp`, `/sse` | OPTIONS | Public | CORS preflight handled by the MCP handler |

Modern protocol revisions (`2026-07-28`) receive JSON responses; legacy clients are served through the stateless compatibility lane. The deprecated HTTP+SSE session transport (a long-lived `GET /sse` stream plus `POST /messages`) is intentionally not implemented — point legacy clients at `/mcp` (or use a proxy such as [`mcp-remote`](https://www.npmjs.com/package/mcp-remote)).

## Requirements

- A deployed **CF ActivityPub Next** instance with `ADMIN_TOKEN` configured (`wrangler secret put ADMIN_TOKEN` in that project).
- A **Cloudflare account** with the domain you want to use. Centinela additionally uses **Workers AI** (available on the free plan with a daily neuron allowance) and one **Durable Object**.
- **Node.js 20+** and npm.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure the instance URL (and optionally the custom domain)
#    Edit `vars` in wrangler.jsonc: ACTIVITYPUB_URL=https://social.example.com

# 3. Create the two secrets
npx wrangler secret put ADMIN_TOKEN      # same value as the instance's ADMIN_TOKEN
npx wrangler secret put MCP_AUTH_TOKEN   # openssl rand -hex 32

# 4. Local development
npm run dev

# 5. Deploy
npm run deploy
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in both tokens.

## Configuration

### Plain-text variables (`vars` in `wrangler.jsonc`)

| Variable | Required | Description |
|---|---|---|
| `ACTIVITYPUB_URL` | Yes | Public base URL of the CF ActivityPub instance, e.g. `https://social.example.com` |
| `MCP_SERVER_NAME` | No | Name reported by the MCP server (default `cf-activitypub-mcp`) |
| `MCP_SERVER_VERSION` | No | Version reported by the MCP server (default `1.0.0`) |
| `MCP_ALLOWED_HOSTNAMES` | No | Comma-separated Host allowlist for the MCP endpoints. Localhost and `workers.dev` are always accepted when unset |
| `MCP_ALLOWED_ORIGINS` | No | Comma-separated browser Origin allowlist, or `*` when an upstream layer validates origins. Only needed for browser-based MCP clients |

The `SENTINEL_*` variables that seed Centinela are documented in [AI Sentinel (Centinela)](#ai-sentinel-centinela).

### Secrets (`wrangler secret put`)

| Secret | Description |
|---|---|
| `ADMIN_TOKEN` | The operator secret of the CF ActivityPub instance. Grants full administrator access to its API |
| `MCP_AUTH_TOKEN` | Bearer token that MCP clients must present on `/mcp` and `/sse`. Generate with `openssl rand -hex 32` |

## Authentication

Two independent credentials are involved:

1. **MCP clients → this worker.** Every request to `/mcp` or `/sse` must include `Authorization: Bearer <MCP_AUTH_TOKEN>`. Requests are rejected with `401` otherwise, and the endpoint is closed with `503` when the secret is not configured. Token comparison hashes both values before comparing to avoid timing leaks.
2. **This worker → the ActivityPub instance.** Tool calls send `Authorization: Bearer <ADMIN_TOKEN>` to the instance admin API. The instance validates it with its own `admin-auth` logic and writes every mutation to the moderation log.

Rotate each token independently: changing `MCP_AUTH_TOKEN` only affects MCP access; changing `ADMIN_TOKEN` must be done in both workers.

## Connecting an MCP client

### Claude Desktop (via `mcp-remote`)

```json
{
	"mcpServers": {
		"cf-activitypub": {
			"command": "npx",
			"args": [
				"mcp-remote",
				"https://mcp.example.com/mcp",
				"--header",
				"Authorization: Bearer <MCP_AUTH_TOKEN>"
			]
		}
	}
}
```

### Clients with native remote transport (Cursor, VS Code, others)

```json
{
	"mcpServers": {
		"cf-activitypub": {
			"url": "https://mcp.example.com/mcp",
			"headers": {
				"Authorization": "Bearer <MCP_AUTH_TOKEN>"
			}
		}
	}
}
```

Use `https://mcp.example.com/sse` instead of `/mcp` when a client explicitly requires an SSE endpoint.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL:       https://mcp.example.com/mcp
# Header:    Authorization: Bearer <MCP_AUTH_TOKEN>
```

## Tools

The server exposes 35 tools, grouped by administrative domain. Destructive actions (`delete`, `reject`, `suspend`, `demote`, `purge`, `clear_all`, `remove`, `dismiss`) require an explicit `confirm: true` argument, so an assistant cannot destroy data by accident.

### Overview and health

| Tool | Description |
|---|---|
| `check_instance_health` | Reachability and latency of the instance plus its public metadata |
| `get_instance_info` | Full public instance payload (version, languages, limits, registration policy) |
| `get_instance_overview` | Combined summary: metadata, account/report/moderation/federation/relay totals and media cache stats |

### Instance settings

| Tool | Description |
|---|---|
| `get_instance_settings` | Rules, policies, languages and registration settings |
| `update_instance_settings` | Updates any subset of the settings above |

### Accounts and moderation

| Tool | Description |
|---|---|
| `list_accounts` | Search/filter local and remote accounts (status, role, locality, query) |
| `get_account` | One account with moderation flags, role and profile |
| `moderate_account` | approve, unapprove, reject, silence, unsilence, suspend, unsuspend, promote, demote, delete |
| `verify_account` | Forces a `rel="me"` verification refresh |
| `search` | Federated search for accounts, statuses, hashtags and collections |

### Reports

| Tool | Description |
|---|---|
| `list_reports` | Abuse reports with statuses, accounts and notes |
| `get_report` | One report ticket |
| `manage_report` | resolve, dismiss, reopen, delete, add_note |

### Federation

| Tool | Description |
|---|---|
| `list_domain_blocks` | Instance-wide domain blocks |
| `manage_domain_block` | block / unblock a domain (severity, media/report rejection, comments) |
| `list_instances` | Federation registry with status filters |
| `manage_instance` | add, refresh, reset, suspend, unsuspend, purge |
| `list_relays` | Subscribed ActivityPub relays |
| `manage_relay` | add, enable, disable, remove |

### Content and policy

| Tool | Description |
|---|---|
| `list_licenses` | License catalogue (FEP-6757) |
| `manage_license` | add, update, delete |
| `list_emojis` | Custom emojis, including disabled ones |
| `manage_emoji` | upload (URL or base64), enable/disable, delete |
| `manage_announcement` | create / delete instance announcements |

### Operations

| Tool | Description |
|---|---|
| `get_media_cache` | Cache statistics, most served entries and effective config |
| `manage_media_cache` | enforce_budget, purge |
| `list_email_blocks` | Blocked mailboxes (canonical email hashes) |
| `manage_email_block` | block / unblock a mailbox |
| `get_moderation_log` | Audit trail with target/action filters |
| `manage_moderation_log` | delete_entry, clear_all |

### AI Sentinel (Centinela)

| Tool | Description |
|---|---|
| `get_sentinel_status` | Configuration, AI usage ledger, last run, next check and decision totals |
| `configure_sentinel` | Mode, interval, model, thresholds, allow-list, protected domains, webhook |
| `run_sentinel_check` | Runs an analysis immediately (respects the current mode) |
| `get_sentinel_decisions` | Decision history with status, target, confidence and result |
| `clear_sentinel_decisions` | Deletes the decision and run history (requires confirmation) |

### Known limitations

- `manage_report` with `action: "add_note"` needs an OAuth token owned by a local actor; the shared `ADMIN_TOKEN` cannot author notes and the instance answers `401`.
- Announcement listing is actor-only on the instance, so this MCP can create and delete announcements but not list them.
- The MCP never exposes the instance database directly; it is limited to what the admin API supports.

## AI Sentinel (Centinela)

Centinela is an autonomous watchdog that lives in a **SQLite-backed Durable Object** and wakes up on a schedule managed by the [Agents SDK](https://developers.cloudflare.com/agents/) (backed by Durable Object alarms).

On every check it:

1. Collects a compact snapshot through the admin API: instance health, counters, pending registrations, open reports, problem federated instances, domain blocks, media cache pressure and the recent moderation log.
2. Asks **Workers AI** (JSON mode) for a structured analysis: summary, severity, findings and proposed actions.
3. Applies **deterministic guardrails** in code — not in the prompt — and then records, proposes or executes the surviving actions depending on the configured mode.

### Modes

| Mode | Behavior |
|---|---|
| `observe` | Analyses and records findings only. Nothing is proposed or executed. |
| `suggest` | Records proposed actions so the operator can review them, but never calls the instance API. |
| `enforce` | Executes actions that pass every guardrail. |

`enforce` is powerful: start in `observe`, review the decision history, then move to `suggest` and only then to `enforce` with a narrow allow-list.

### Guardrails

- **Action allow-list.** Only `resolve_report`, `dismiss_report`, `silence_account`, `suspend_account`, `block_domain` and `enforce_media_cache` exist, and the operator chooses which are enabled.
- **Per-action confidence floors** combined with the configured `minConfidence` (for example, suspending an account or blocking a domain requires ≥ 0.9 by default).
- **Per-run budget.** At most `maxActionsPerRun` actions are executed per check.
- **Daily neuron budget.** The Sentinel estimates the neuron cost of every Workers AI call from the provider token counts and the official per-model rates. When `dailyNeuronBudget` is reached (UTC day, matching Cloudflare's reset at 00:00 UTC), scheduled checks are skipped and recorded until the next day. Set it to `0` for unlimited usage.
- **Cooldowns.** The same action against the same target is not repeated within `cooldownHours` (24 by default).
- **Protected targets.** Administrators and moderators can never be silenced or suspended; protected domains can never be blocked; already-blocked domains and already-moderated accounts are skipped.
- **Prompt-injection defense.** Report comments, registration reasons and display names are treated as untrusted data, and the guardrails run in code so a manipulated model cannot exceed its mandate.
- **Audit trail.** Every run and decision is stored in the Durable Object with status `observed`, `proposed`, `blocked`, `executed` or `failed`.

### Configuration

The agent is seeded on first boot from `wrangler.jsonc` variables and can then be reconfigured live through `configure_sentinel`:

| Variable | Default | Description |
|---|---|---|
| `SENTINEL_ENABLED` | `false` | Start the periodic schedule |
| `SENTINEL_MODE` | `observe` | `observe`, `suggest` or `enforce` |
| `SENTINEL_INTERVAL_SECONDS` | `900` | Seconds between checks (60 – 86400) |
| `SENTINEL_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Workers AI model |
| `SENTINEL_MAX_ACTIONS` | `3` | Hard cap of executed actions per run |
| `SENTINEL_MIN_CONFIDENCE` | `0.8` | Minimum model confidence |
| `SENTINEL_COOLDOWN_HOURS` | `24` | Cooldown window per action+target |
| `SENTINEL_DAILY_NEURON_BUDGET` | `10000` | Workers AI budget in neurons per UTC day (`0` = unlimited) |
| `SENTINEL_ALLOWED_ACTIONS` | all actions | Comma-separated allow-list |
| `SENTINEL_PROTECTED_DOMAINS` | empty | Domains the Sentinel must never act against |
| `SENTINEL_NOTIFY_WEBHOOK` | empty | HTTPS webhook that receives a JSON summary after each run |

A typical first configuration from an MCP client:

```text
configure_sentinel { "enabled": true, "mode": "suggest", "interval_seconds": 3600, "daily_neuron_budget": 10000 }
run_sentinel_check {}
get_sentinel_decisions { "limit": 20 }
```

`get_sentinel_status` reports the live ledger: `usage.neuronsUsed`, `usage.dailyNeuronBudget`, `usage.remaining`, `usage.runs` and token totals for the current UTC day. The budget is a safety valve, not an exact invoice: usage is estimated from the token counts the model returns (or from text length when the model omits them) and the published per-model rates.

> **Local development:** the local simulator cannot execute Workers AI bindings, so Sentinel checks in `wrangler dev` are recorded as errors and do not consume neurons. Deploy the worker (or use `wrangler dev --remote` with a publicly reachable `ACTIVITYPUB_URL`) to exercise the model.

> Centinela complements the instance's own **Guardian**: the Guardian moderates content inside CF ActivityPub, while Centinela watches the instance as an operator would and acts through the admin API. Both keep their own audit trails.

## Health and landing page

- `GET /` renders a public landing page linking to both repositories and showing live metrics (worker status, instance status, latency, active users, tool count and Sentinel mode).
- `GET /health` returns the same data as JSON, suitable for uptime monitors:

```json
{
	"status": "ok",
	"service": { "name": "cf-activitypub-mcp", "version": "1.0.0", "tools": 35, "authentication": "bearer" },
	"instance": { "url": "https://social.example.com", "reachable": true, "latency_ms": 42, "users": 128 },
	"sentinel": { "enabled": true, "mode": "suggest", "last_run_at": "2026-10-04T04:00:00.000Z", "last_run_status": "ok", "decisions_total": 12, "neurons_today": 843, "daily_neuron_budget": 10000 }
}
```

No secrets or administrative details are exposed by either endpoint. The Sentinel section is read through its Durable Object and cached for a minute so health polling does not keep the agent awake.

## Security

- **Fail closed.** MCP endpoints refuse to serve when `MCP_AUTH_TOKEN` is missing.
- **Least privilege.** The MCP only knows the instance admin API; it cannot reach Cloudflare account resources.
- **Auditability.** Every mutation performed through the MCP is recorded by the instance in its moderation log; Centinela keeps its own decision history.
- **Confirmation guards.** Destructive tools require `confirm: true`; the model must be told explicitly.
- **Sentinel guardrails.** The AI never executes an action outside the allow-list, below the confidence floor, over the per-run budget or against protected accounts and domains. Guardrails run in code, not in the prompt.
- **Prompt-injection defense.** Snapshot content is treated as untrusted data and never as instructions.
- **Constant-time token comparison.** Candidate and expected tokens are hashed and compared with an XOR accumulator.
- **Origin/Host allowlists.** Optional `MCP_ALLOWED_ORIGINS` / `MCP_ALLOWED_HOSTNAMES` restrict browser and Host access.
- **Source maps.** `upload_source_maps` keeps stack traces readable in the dashboard without shipping them to clients.

If you find a security issue, please open a private report through GitHub rather than a public issue.

## Development

| Script | Purpose |
|---|---|
| `npm run dev` | Start the local Workers dev server |
| `npm run deploy` | Deploy to Cloudflare (custom domain from `wrangler.jsonc`) |
| `npm test` | Run the Vitest suite inside the Workers runtime |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | Strict TypeScript check |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after binding changes |

### Project structure

```
src/
  index.ts                  Worker entry: routing, auth, endpoints, DO export
  config.ts                 Environment parsing and defaults
  auth.ts                   Bearer authentication and secret comparison
  activitypub/
    client.ts               Authenticated client for the instance API
    types.ts                Shared API payload shapes
  mcp/
    server.ts               MCP server factory and tool catalogue
    context.ts              Per-request tool context (lazy clients + env)
    result.ts               Tool result helpers
    tools/                  One module per administrative domain
  sentinel/
    agent.ts                Centinela: SQLite-backed Durable Object agent
    analyze.ts              Workers AI prompt and structured analysis
    snapshot.ts             Instance snapshot collection
    policy.ts               Deterministic guardrails and settings validation
    defaults.ts             Environment-seeded configuration
    types.ts                Sentinel types and action catalogue
  web/
    health.ts               Health report collection (includes Sentinel)
    index-page.ts           Public landing page renderer
test/
  index.spec.ts             Worker routes and MCP protocol tests
  config.spec.ts            Config and auth unit tests
  client.spec.ts            ActivityPub client unit tests
  sentinel.spec.ts          Sentinel policy, analysis and Durable Object tests
```

## Deployment notes

1. Set `routes[0].pattern` in `wrangler.jsonc` to your subdomain (for example `mcp.example.com`). Wrangler creates the DNS record and certificate automatically on deploy.
2. Set `ACTIVITYPUB_URL` to the public URL of your instance.
3. Configure both secrets with `wrangler secret put`.
4. Run `npm run deploy`, then open `https://mcp.example.com/` to verify the health metrics.
5. Observability is already enabled: traces, logs and real-time issues are available in the Cloudflare dashboard under the worker's **Observability** tab.

The first deploy applies the `v1` migration and creates the SQLite-backed `SentinelAgent` Durable Object class. The MCP tool endpoints themselves stay stateless and work entirely through the instance API; only Centinela uses Durable Object storage, Workers AI and alarms.

## License

[MIT](LICENSE) © 2026 manalejandro

CF ActivityPub MCP is not affiliated with Cloudflare, Inc. or the Mastodon project. The author is not responsible for the use of this software, nor for any charges Cloudflare may apply.
