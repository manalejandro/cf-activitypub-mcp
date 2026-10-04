import { ACTIVITYPUB_REPOSITORY, PROJECT_REPOSITORY } from "../config";
import type { HealthReport } from "./health";

/** Renders the public landing page with live health metrics. */
export function renderIndexPage(health: HealthReport): string {
	const overall = health.status === "ok" ? "Operational" : "Degraded";
	const overallClass = health.status === "ok" ? "ok" : "warn";
	const instance = health.instance;
	const instanceLabel = instance.reachable ? "Online" : "Offline";
	const instanceClass = instance.reachable ? "ok" : "down";
	const latency = instance.reachable && instance.latency_ms !== null ? `${instance.latency_ms} ms` : "—";
	const users = instance.users === null ? "—" : String(instance.users);
	const sentinel = health.sentinel;
	const sentinelMode = sentinelModeLabel(sentinel);
	const sentinelDetail = sentinel
		? `${sentinel.decisions_total} decision${sentinel.decisions_total === 1 ? "" : "s"} · ${formatNeurons(
				sentinel.neurons_today
			)} neurons today${sentinel.daily_neuron_budget > 0 ? ` / ${formatNeurons(sentinel.daily_neuron_budget)}` : ""}`
		: "Durable Object agent";

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CF ActivityPub MCP</title>
<meta name="description" content="Remote Model Context Protocol server for administering a CF ActivityPub instance on Cloudflare Workers.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%236366f1'/%3E%3Ctext x='16' y='22' font-family='system-ui,sans-serif' font-size='16' font-weight='700' fill='white' text-anchor='middle'%3EM%3C/text%3E%3C/svg%3E">
<style>
:root{color-scheme:dark;--bg:#0b0f16;--card:#121a27;--card-2:#0e1520;--border:#1f2b3d;--text:#e7edf6;--muted:#8fa0b8;--accent:#7c8cf8;--ok:#34d399;--warn:#fbbf24;--down:#f87171}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#1b2440 0%,var(--bg) 55%);color:var(--text);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;min-height:100vh}
main{max-width:960px;margin:0 auto;padding:56px 24px 40px}
.eyebrow{display:inline-block;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);border:1px solid var(--border);border-radius:999px;padding:4px 12px;background:var(--card-2)}
h1{font-size:clamp(32px,6vw,52px);line-height:1.1;margin:18px 0 10px;letter-spacing:-.02em}
h1 span{color:var(--accent)}
.tagline{color:var(--muted);font-size:18px;max-width:640px;margin:0 0 22px}
.links{display:flex;flex-wrap:wrap;gap:10px}
.links a{color:var(--text);text-decoration:none;border:1px solid var(--border);background:var(--card);padding:8px 14px;border-radius:10px;font-size:14px;font-weight:600;transition:border-color .15s,transform .15s}
.links a:hover{border-color:var(--accent);transform:translateY(-1px)}
section{margin-top:40px}
h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 14px;font-weight:600}
.status-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:6px 14px;font-size:14px;font-weight:600;border:1px solid var(--border);background:var(--card)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--muted)}
.pill.ok .dot{background:var(--ok);box-shadow:0 0 12px var(--ok)}
.pill.warn .dot{background:var(--warn);box-shadow:0 0 12px var(--warn)}
.pill.down .dot{background:var(--down);box-shadow:0 0 12px var(--down)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
.card{background:linear-gradient(180deg,var(--card) 0%,var(--card-2) 100%);border:1px solid var(--border);border-radius:16px;padding:18px}
.card .label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.card .value{font-size:26px;font-weight:700;margin-top:6px;word-break:break-word}
.card .sub{font-size:13px;color:var(--muted);margin-top:4px;word-break:break-word}
.about p{color:var(--muted);max-width:720px;margin:0}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--border);color:var(--muted);font-size:14px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
footer a{color:var(--accent);text-decoration:none}
footer a:hover{text-decoration:underline}
</style>
</head>
<body>
<main>
  <header>
    <span class="eyebrow">Model Context Protocol server</span>
    <h1>CF ActivityPub <span>MCP</span></h1>
    <p class="tagline">A remote MCP server that lets AI assistants administer a CF ActivityPub instance through its administration API — fully hosted on Cloudflare Workers.</p>
    <nav class="links">
      <a href="${PROJECT_REPOSITORY}" rel="noopener">GitHub · cf-activitypub-mcp</a>
      <a href="${ACTIVITYPUB_REPOSITORY}" rel="noopener">GitHub · cf-activitypub-next</a>
    </nav>
  </header>

  <section aria-label="Health">
    <h2>Health</h2>
    <div class="status-row">
      <span class="pill ${overallClass}" id="service-pill"><span class="dot"></span><span id="service-status">${overall}</span></span>
      <span class="pill ${instanceClass}" id="instance-pill"><span class="dot"></span><span id="instance-status">Instance ${instanceLabel}</span></span>
      <span class="pill" id="checked-pill">Checked <span id="checked-at">just now</span></span>
    </div>
  </section>

  <section aria-label="Metrics">
    <h2>Metrics</h2>
    <div class="grid">
      <div class="card">
        <div class="label">MCP server</div>
        <div class="value" id="mcp-version">v${escapeHtml(health.service.version)}</div>
        <div class="sub" id="mcp-tools">${health.service.tools} tools · bearer auth</div>
      </div>
      <div class="card">
        <div class="label">Instance latency</div>
        <div class="value" id="latency">${latency}</div>
        <div class="sub">Public API response time</div>
      </div>
      <div class="card">
        <div class="label">Instance</div>
        <div class="value" id="instance-title">${escapeHtml(instance.title ?? "—")}</div>
        <div class="sub" id="instance-version">${escapeHtml(instance.version ?? "Not reachable")}</div>
      </div>
      <div class="card">
        <div class="label">Active users</div>
        <div class="value" id="instance-users">${users}</div>
        <div class="sub">Reported by the instance</div>
      </div>
      <div class="card">
        <div class="label">AI Sentinel</div>
        <div class="value" id="sentinel-mode">${sentinelMode}</div>
        <div class="sub" id="sentinel-detail">${sentinelDetail}</div>
      </div>
    </div>
  </section>

  <section class="about" aria-label="About">
    <h2>About</h2>
    <p>This service exposes the administration surface of a CF ActivityPub instance as MCP tools, so assistants can inspect and operate the instance after authenticating. It speaks Streamable HTTP and SSE, reports its health here, and ships with audit-friendly defaults. See the repositories above for source code, documentation and license details.</p>
  </section>

  <footer>
    <span>MIT License · Built for Cloudflare Workers</span>
    <span><a href="/health">/health</a> · <a href="/mcp">/mcp</a> · <a href="/sse">/sse</a></span>
  </footer>
</main>
<script>
(function () {
  var pills = {
    service: { el: document.getElementById("service-pill"), text: document.getElementById("service-status") },
    instance: { el: document.getElementById("instance-pill"), text: document.getElementById("instance-status") }
  };
  function setPill(target, cls, text) {
    target.el.className = "pill " + cls;
    target.text.textContent = text;
  }
  function text(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.textContent = String(value);
  }
  function sentinelModeLabel(sentinel) {
    if (!sentinel) return "Unavailable";
    if (!sentinel.enabled) return "Paused";
    if (sentinel.mode === "enforce") return "Enforcing";
    if (sentinel.mode === "suggest") return "Suggesting";
    return "Observing";
  }
  function formatNeurons(value) {
    if (!value || value <= 0) return "0";
    if (value < 1000) return String(Math.round(value));
    if (value < 1000000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + "k";
    return (value / 1000000).toFixed(1) + "M";
  }
  function refresh() {
    fetch("/health", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) return;
        setPill(pills.service, data.status === "ok" ? "ok" : "warn", data.status === "ok" ? "Operational" : "Degraded");
        var instance = data.instance || {};
        setPill(pills.instance, instance.reachable ? "ok" : "down", instance.reachable ? "Instance Online" : "Instance Offline");
        text("latency", instance.reachable && instance.latency_ms !== null && instance.latency_ms !== undefined ? instance.latency_ms + " ms" : "—");
        text("instance-title", instance.title || "—");
        text("instance-version", instance.version || (instance.reachable ? "—" : "Not reachable"));
        text("instance-users", instance.users === null || instance.users === undefined ? "—" : instance.users);
        text("mcp-version", "v" + (data.service && data.service.version ? data.service.version : ""));
        text("mcp-tools", data.service ? data.service.tools + " tools · bearer auth" : "");
        text("checked-at", new Date(data.timestamp).toLocaleTimeString());
        var sentinel = data.sentinel || null;
        text("sentinel-mode", sentinelModeLabel(sentinel));
        text("sentinel-detail", sentinel
          ? sentinel.decisions_total + " decision" + (sentinel.decisions_total === 1 ? "" : "s") + " · " + formatNeurons(sentinel.neurons_today) + " neurons today" + (sentinel.daily_neuron_budget > 0 ? " / " + formatNeurons(sentinel.daily_neuron_budget) : "")
          : "Durable Object agent");
      })
      .catch(function () {});
  }
  refresh();
  setInterval(refresh, 30000);
})();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function sentinelModeLabel(sentinel: HealthReport["sentinel"]): string {
	if (!sentinel) return "Unavailable";
	if (!sentinel.enabled) return "Paused";
	if (sentinel.mode === "enforce") return "Enforcing";
	if (sentinel.mode === "suggest") return "Suggesting";
	return "Observing";
}

function formatNeurons(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "0";
	if (value < 1_000) return String(Math.round(value));
	if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return `${(value / 1_000_000).toFixed(1)}M`;
}
