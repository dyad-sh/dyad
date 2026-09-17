#!/bin/bash
# Build results/videos/scores.html — the 3-app leaderboard as an interactive
# page: vendor/model filters, sortable table, a cost-vs-score scatter, and a
# brief description of each app. Same scoring rules and artifacts as
# report.mjs, so it always agrees with RESULTS.md. Self-contained (no external
# assets) so it renders from the bare static server on the tailnet.
set -uo pipefail
BENCH="$(cd "$(dirname "$0")" && pwd)"
DIR="$BENCH/results/videos"
mkdir -p "$DIR"
node - "$BENCH" "$DIR" <<'EOF'
const fs = require("fs");
const path = require("path");
const [BENCH, DIR] = process.argv.slice(2);
const R = (...p) => path.join(BENCH, "results", ...p);

// Mirrors report.mjs: registered models and per-app suite composition.
const MODELS = [
  { name: "GPT 5.6 Terra", slug: "gpt-5.6-terra", vendor: "OpenAI", effort: "medium" },
  { name: "GPT 5.6 Luna", slug: "gpt-5.6-luna", vendor: "OpenAI", effort: "medium" },
  { name: "GPT 5.6 Sol", slug: "gpt-5.6-sol", vendor: "OpenAI", effort: "medium" },
  { name: "GPT 6 Astra", slug: "gpt-6-astra", vendor: "OpenAI", effort: "low" },
  { name: "Claude Sonnet 5", slug: "claude-sonnet-5", vendor: "Anthropic", effort: "medium" },
  { name: "Claude Opus 5", slug: "claude-opus-5", vendor: "Anthropic", effort: "medium" },
  { name: "Claude Fable 5", slug: "claude-fable-5", vendor: "Anthropic", effort: "medium" },
  { name: "Claude Fable 5.1", slug: "claude-fable-5-1", vendor: "Anthropic", effort: "medium" },
  { name: "Grok 4.5", slug: "x-ai_grok-4.5", vendor: "xAI", effort: "provider default" },
  { name: "Grok 4.6", slug: "x-ai_grok-4.6", vendor: "xAI", effort: "provider default (medium)" },
  { name: "GLM 5.3", slug: "z-ai_glm-5.3", vendor: "Z-AI", effort: "provider default" },
  { name: "GLM 5.3 Flash", slug: "z-ai_glm-5.3-flash", vendor: "Z-AI", effort: "provider default" },
  { name: "Gemini 3.8 Flash", slug: "gemini-3.8-flash", vendor: "Google", effort: "medium" },
  { name: "Muse Spark 1.3", slug: "meta_muse-spark-1.3", vendor: "Meta", effort: "provider default" },
  { name: "Auto Sidekick", slug: "auto-sidekick", vendor: "Dyad", effort: "medium", note: "Sol orchestrator + Luna implementer" },
];
// `effort` is what the recording proxy saw on the wire for every request of
// the cell (`reasoning.effort` for OpenAI, `effort` for Anthropic; Dyad's
// product default = medium). OpenRouter-routed models are sent no effort field
// and run at the provider's default; grok-4.6's catalog default is medium.
const APPS = {
  "relay-crm": {
    label: "Relay CRM", tag: "multi-tenant CRM",
    blurb: "A multi-tenant CRM where teams track contacts, companies and a deals pipeline inside shared workspaces with owner, member and viewer roles.",
    cujs: { 1: 10, 2: 12, 3: 12 }, probes: { 1: 2, 2: 6, 3: 8 }, isProbe: (id) => /-s\d/.test(id),
    milestones: [
      "Email/password auth; contacts and companies with list, search, detail and edit pages; JSON API.",
      "Workspaces — every record belongs to one; owners invite teammates by email and invitees accept from an invites page — plus a deals pipeline (lead → qualified → proposal → won/lost).",
      "Owner / member / viewer roles enforced server-side, a per-contact activity timeline, CSV export, and hardening against cross-workspace access.",
    ],
  },
  deskhero: {
    label: "Deskhero", tag: "internal helpdesk",
    blurb: "An internal helpdesk where requesters file tickets and agents work them through a status workflow with SLAs, internal notes and canned replies.",
    cujs: { 1: 9, 2: 12, 3: 12 }, probes: { 1: 3, 2: 8, 3: 10 }, isProbe: (id) => /-p-/.test(id),
    milestones: [
      "Auth and ticket CRUD (subject, body, priority, open/closed) with owner-only access.",
      "Admin / agent / requester roles with role-routed dashboards, ticket assignment, a status workflow with allowed transitions, and internal notes hidden from requesters.",
      "SLA due times derived from priority with overdue tracking, a public reply thread with admin-managed canned responses, admin user management, an audit trail, and hardening.",
    ],
  },
  portalis: {
    label: "Portalis", tag: "B2B SaaS admin portal",
    blurb: "A B2B SaaS admin portal where each organization manages its members, roles, invites, projects, API keys and an audit log in strict isolation from other orgs.",
    cujs: { 1: 10, 2: 12, 3: 12 }, probes: { 1: 2, 2: 7, 3: 9 }, isProbe: (id) => /^S\d-/.test(id),
    milestones: [
      "Auth; organizations with UUID ids and unique slugs; membership verified server-side on every org page; org settings and a members table.",
      "org_admin / org_member roles, email invites with revocable accept links, and org-scoped projects that must never leak across orgs.",
      "An admin-only audit log written in the same transaction as each admin action, read-only API keys whose secret is shown exactly once, and a usage dashboard.",
    ],
  },
};
// Vendor colors: validated with dataviz validate_palette.js against the dark
// surface (all six checks pass; see report.mjs for the light set).
const VENDOR_COLOR = { OpenAI: "#3987e5", Anthropic: "#d95926", xAI: "#199e70", Dyad: "#9678f0", "Z-AI": "#e0568f", Google: "#e3a72f", Meta: "#2cc4d9" };

// Mirrors CELL_OVERRIDES in report.mjs (labelled reruns of cells lost to a
// provider/harness fault; reasons recorded there).
const CELL_OVERRIDES = {
  "meta_muse-spark-1.3-portalis": "meta_muse-spark-1.3-portalis-r2",
  "meta_muse-spark-1.3-relay-crm": "meta_muse-spark-1.3-relay-crm-r2",
  // gpt-6-astra's product default became low on 2026-09-04; the low cells are
  // the headline (see report.mjs MODELS.headlineSuffix).
  "gpt-6-astra-relay-crm": "gpt-6-astra-relay-crm-low",
  "gpt-6-astra-deskhero": "gpt-6-astra-deskhero-low",
  "gpt-6-astra-portalis": "gpt-6-astra-portalis-low",
};
function scoreCell(slug, app) {
  const cfg = APPS[app];
  const cell = CELL_OVERRIDES[`${slug}-${app}`] ?? `${slug}-${app}`;
  const sumPath = R("s-cell", `${cell}.summary.json`);
  if (!fs.existsSync(sumPath)) return null;
  const sum = JSON.parse(fs.readFileSync(sumPath));
  const minutes = Math.round(sum.milestones.reduce((a, m) => a + m.durationMs, 0) / 60000);
  const cost = sum.milestones.reduce((a, m) => a + m.estimatedUsd, 0);
  let cujP = 0, cujT = 0, prP = 0, prT = 0, judge = 0, scored = 0;
  for (const ck of [1, 2, 3]) {
    cujT += cfg.cujs[ck]; prT += cfg.probes[ck];
    const f = R("s-score", `${cell}-ckpt${ck}-a1.json`);
    if (!fs.existsSync(f)) continue;
    const x = JSON.parse(fs.readFileSync(f));
    if (x.buildStatus === "harness_error") continue; // unscored, not zero
    scored++;
    if (x.buildStatus !== "ok") continue;
    const pf = x.failures.filter(cfg.isProbe).length;
    cujP += cfg.cujs[ck] - (x.failures.length - pf); prP += cfg.probes[ck] - pf;
    const jf = R("judge", `${cell}-m${ck}.json`);
    if (fs.existsSync(jf)) judge += JSON.parse(fs.readFileSync(jf)).judgeScore;
  }
  const composite = scored === 3 ? 0.6 * (cujP / cujT) + 0.25 * (prP / prT) + 0.15 * (judge / scored) : null;
  return { minutes, cost: +cost.toFixed(2), composite, cujP, cujT, prP, prT };
}

const appNames = Object.keys(APPS);
const rows = MODELS.map((m) => {
  const perApp = Object.fromEntries(appNames.map((a) => [a, scoreCell(m.slug, a)]));
  const present = appNames.map((a) => perApp[a]).filter(Boolean);
  const scoredApps = present.filter((x) => x.composite !== null);
  const overall = scoredApps.length === present.length && present.length > 0
    ? scoredApps.reduce((s, x) => s + x.composite, 0) / scoredApps.length : null;
  return { name: m.name, slug: m.slug, vendor: m.vendor, effort: m.effort, note: m.note || "", perApp, overall,
    scoredApps: scoredApps.length, presentApps: present.length,
    totalCost: +present.reduce((s, x) => s + x.cost, 0).toFixed(2),
    totalMin: present.reduce((s, x) => s + x.minutes, 0) };
}).filter((r) => r.presentApps > 0);

const DATA = { rows, apps: Object.fromEntries(appNames.map((a) => [a, { label: APPS[a].label, tag: APPS[a].tag, blurb: APPS[a].blurb, milestones: APPS[a].milestones,
  cujs: Object.values(APPS[a].cujs).reduce((s, x) => s + x, 0), probes: Object.values(APPS[a].probes).reduce((s, x) => s + x, 0) }])),
  vendorColor: VENDOR_COLOR, generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" };

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App-builder benchmark — scores</title>
<style>
 :root{--bg:#0b1220;--panel:#111a2e;--panel2:#0f172a;--line:#1f2a44;--ink:#e5e7eb;--ink2:#cbd5e1;--muted:#8b9bb4;--dim:#64748b;--accent:#93c5fd;--best:#13233d}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);background-image:radial-gradient(1200px 500px at 15% -10%,#182a52 0%,transparent 60%),radial-gradient(900px 400px at 100% 0%,#2a1a3a 0%,transparent 55%);background-repeat:no-repeat;color:var(--ink);font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
 .wrap{max-width:1240px;margin:0 auto;padding:36px 24px 56px}
 header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:8px}
 .eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:0 0 6px}
 h1{font-size:32px;margin:0;letter-spacing:-.02em;color:#f8fafc} .lead{color:var(--muted);margin:0 0 22px;max-width:860px;font-size:15.5px}
 a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
 .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:9px;border:1px solid #2b3a5c;background:#131f3a;color:#e5e7eb;font-weight:600;font-size:13.5px} .btn:hover{border-color:#3d5484;text-decoration:none;background:#172546}
 .card{background:linear-gradient(180deg,#121c33 0%,var(--panel) 100%);border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 10px 30px rgba(0,0,0,.25)}
 /* filters */
 .filters{padding:14px 16px;margin-bottom:16px;display:flex;flex-direction:column;gap:12px}
 .frow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
 .frow .lbl{color:var(--muted);font-size:13px;min-width:64px}
 .chip{display:inline-flex;align-items:center;gap:8px;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--ink2);cursor:pointer;font-size:13.5px;user-select:none;transition:background .12s,border-color .12s,transform .08s}
 .chip:hover{border-color:#3d5484;transform:translateY(-1px)} .chip.on{border-color:transparent;color:#fff;background:var(--c,#334a72);box-shadow:0 4px 14px color-mix(in srgb,var(--c,#334a72) 35%,transparent)}
 .chip .dot{width:9px;height:9px;border-radius:50%;background:var(--c)} .chip.on .dot{background:#fff;opacity:.9} .chip.off .dot{opacity:.6}
 .model-chip.off{opacity:.6}
 .search{flex:1;min-width:180px;max-width:320px;padding:7px 11px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:inherit}
 .link{background:none;border:none;color:var(--accent);cursor:pointer;font:inherit;font-size:13px;padding:0 4px}
 .count{color:var(--muted);font-size:13px;margin-left:auto}
 /* tiles */
 .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}
 .tile{padding:16px 18px;position:relative;overflow:hidden} .tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--c,#334a72)}
 .tile .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em;font-weight:600}
 .tile .v{font-size:28px;font-weight:800;color:#f8fafc;margin-top:4px;letter-spacing:-.02em;line-height:1.15} .tile .s{color:var(--ink2);font-size:13px;margin-top:4px}
 .tile .s i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);margin-right:6px;vertical-align:0}
 /* layout: chart + table */
 .grid{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}
 .chart svg{max-width:960px;margin:0 auto}
 .chart{padding:14px 16px} .chart h2,.tbl h2{margin:0 0 6px;font-size:15px;color:var(--ink2)} .chart .hint{color:var(--muted);font-size:12.5px;margin:0 0 6px}
 svg{width:100%;height:auto;display:block;overflow:visible}
 .legend{display:flex;flex-wrap:wrap;gap:10px 14px;margin-top:8px;font-size:12.5px;color:var(--ink2)} .legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px}
 .tip{position:fixed;pointer-events:none;background:#0f172a;border:1px solid #334a72;border-radius:8px;padding:8px 10px;font-size:12.5px;color:var(--ink);box-shadow:0 8px 24px rgba(0,0,0,.45);display:none;z-index:9}
 /* table */
 .tbl{padding:8px 0 4px;overflow-x:auto}
 .tbl h2{padding:6px 16px 0}
 table{border-collapse:collapse;width:100%;min-width:700px}
 th,td{padding:9px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
 td .sub{white-space:nowrap}
 th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em;background:var(--panel2);cursor:pointer;white-space:nowrap;position:sticky;top:0}
 th.sorted{color:#f8fafc} th .arr{opacity:.6;margin-left:4px}
 td b{color:#f8fafc;font-size:15.5px} td .sub{display:block;color:var(--muted);font-size:12px;margin-top:1px}
 td.model{white-space:nowrap} td.model .name{font-weight:600;display:flex;align-items:center;gap:8px} td.model .name i{width:9px;height:9px;border-radius:50%;display:inline-block}
 .eff{display:inline-block;padding:1px 7px;border-radius:999px;border:1px solid #2b3a5c;color:#a5b4cf;font-size:11px;font-weight:500;letter-spacing:.02em;white-space:nowrap;vertical-align:1px}
 td.overall b{font-size:19px} .na{color:var(--dim)} tr.best td{background:var(--best)} tr.best td.model .name{color:#fff} tbody tr:hover td{background:#152039} tr.hidden{display:none}
 .bar{height:4px;border-radius:2px;background:#1f2a44;margin-top:6px;overflow:hidden} .bar i{display:block;height:100%;background:var(--c)}
 /* apps */
 h2.sec{font-size:17px;margin:30px 0 10px;color:var(--ink2)}
 .apps{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
 .app{padding:18px 20px;border-top:3px solid var(--c,#334a72)} .app h3{margin:0;font-size:18px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;color:#f8fafc} .app h3 span{color:var(--muted);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
 .app .blurb{margin:8px 0 12px;color:var(--ink);font-size:14.5px;line-height:1.5}
 .app .ml{color:var(--muted);font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px}
 .app ol{margin:0;padding:0;list-style:none;color:var(--ink2);font-size:13.5px} .app li{margin:6px 0;padding-left:34px;position:relative} .app li b{position:absolute;left:0;top:1px;display:inline-block;min-width:26px;text-align:center;padding:0 4px;border-radius:6px;background:#1c2740;color:#e2e8f0;font-size:11.5px;line-height:18px}
 .app .suite{color:var(--muted);font-size:12.5px;margin:12px 0 0;padding-top:10px;border-top:1px solid var(--line)}
 .note{color:var(--muted);font-size:12.5px;margin-top:18px}
</style>
<div class="wrap">
<header><div><p class="eyebrow">Dyad · full-stack app builds</p><h1>App-builder benchmark</h1></div><a class="btn" href="index.html">▶ Relay CRM demo videos</a></header>
<p class="lead">Each model built three full-stack apps end to end inside Dyad — three milestones each, one run per cell — and every build is scored against a fixed suite of customer-journey tests, security probes and an LLM judge. Cost is exact token usage at pinned public list prices.</p>

<section class="card filters">
  <div class="frow"><span class="lbl">Vendor</span><span id="vendors"></span><span class="count" id="count"></span></div>
  <div class="frow"><span class="lbl">Models</span><span id="models"></span></div>
  <div class="frow"><span class="lbl"></span><input class="search" id="search" placeholder="Filter by name…"><button class="link" id="all">select all</button><button class="link" id="none">clear</button><button class="link" id="top">top 5</button></div>
</section>

<section class="tiles" id="tiles"></section>

<div class="grid">
  <section class="card chart"><h2>Overall score vs total cost</h2><p class="hint">Log-scale cost, cheaper to the right. Up and to the right is better. Hover a point for detail.</p><div id="chart"></div><div class="legend" id="legend"></div></section>
  <section class="card tbl"><h2>Per-app scores <span style="color:var(--muted);font-weight:400;font-size:12.5px">— click a column to sort</span></h2><table id="table"><thead></thead><tbody></tbody></table></section>
</div>
<div class="tip" id="tip"></div>

<h2 class="sec">The three apps</h2>
<section class="apps" id="apps"></section>
<p class="note" id="note"></p>
</div>
<script>
const DATA = ${JSON.stringify(DATA)};
const APPS = Object.keys(DATA.apps);
const rows = DATA.rows;
const VC = DATA.vendorColor;
const pct = (x) => x == null ? "—" : (x * 100).toFixed(1) + "%";
const money = (x) => "$" + x.toFixed(2);

// ---- selection state (persisted per browser) ----
let selected = new Set(rows.map((r) => r.slug));
try { const s = JSON.parse(localStorage.getItem("appbench.sel") || "null"); if (Array.isArray(s) && s.length) selected = new Set(s.filter((x) => rows.some((r) => r.slug === x))); } catch {}
let sortKey = "overall", sortDir = -1;
const save = () => { try { localStorage.setItem("appbench.sel", JSON.stringify([...selected])); } catch {} };
const visible = () => rows.filter((r) => selected.has(r.slug));

// ---- filters ----
const vendors = [...new Set(rows.map((r) => r.vendor))];
function renderFilters() {
  const vEl = document.getElementById("vendors"); vEl.innerHTML = "";
  for (const v of vendors) {
    const on = rows.filter((r) => r.vendor === v).every((r) => selected.has(r.slug));
    const el = document.createElement("span"); el.className = "chip " + (on ? "on" : "off"); el.style.setProperty("--c", VC[v] || "#64748b");
    el.innerHTML = '<span class="dot"></span>' + v;
    el.onclick = () => { const mine = rows.filter((r) => r.vendor === v); const allOn = mine.every((r) => selected.has(r.slug)); mine.forEach((r) => allOn ? selected.delete(r.slug) : selected.add(r.slug)); update(); };
    vEl.appendChild(el);
  }
  const mEl = document.getElementById("models"); mEl.innerHTML = "";
  const q = (document.getElementById("search").value || "").toLowerCase();
  for (const r of rows) {
    if (q && !r.name.toLowerCase().includes(q) && !r.vendor.toLowerCase().includes(q)) continue;
    const on = selected.has(r.slug);
    const el = document.createElement("span"); el.className = "chip model-chip " + (on ? "on" : "off"); el.style.setProperty("--c", VC[r.vendor] || "#64748b");
    el.innerHTML = '<span class="dot"></span>' + r.name + (r.overall != null ? ' <span style="opacity:.8;font-weight:600">' + pct(r.overall) + "</span>" : "");
    el.onclick = () => { on ? selected.delete(r.slug) : selected.add(r.slug); update(); };
    mEl.appendChild(el);
  }
  document.getElementById("count").textContent = visible().length + " of " + rows.length + " models shown";
}
document.getElementById("search").addEventListener("input", renderFilters);
document.getElementById("all").onclick = () => { rows.forEach((r) => selected.add(r.slug)); update(); };
document.getElementById("none").onclick = () => { selected.clear(); update(); };
document.getElementById("top").onclick = () => { selected = new Set(rows.filter((r) => r.overall != null).sort((a, b) => b.overall - a.overall).slice(0, 5).map((r) => r.slug)); update(); };

// ---- tiles ----
function renderTiles() {
  const v = visible().filter((r) => r.overall != null);
  const t = document.getElementById("tiles"); t.innerHTML = "";
  if (!v.length) return;
  const best = [...v].sort((a, b) => b.overall - a.overall)[0];
  const pool = v.some((r) => r.overall >= 0.8) ? v.filter((r) => r.overall >= 0.8) : v;
  const value = [...pool].sort((a, b) => (b.overall / b.totalCost) - (a.overall / a.totalCost))[0];
  const cheapGood = [...v].filter((r) => r.overall >= 0.85).sort((a, b) => a.totalCost - b.totalCost)[0];
  const fastest = [...v].sort((a, b) => a.totalMin - b.totalMin)[0];
  const tile = (k, val, r, s) => '<div class="card tile" style="--c:' + (r ? VC[r.vendor] : "#334a72") + '"><div class="k">' + k + '</div><div class="v">' + val + '</div><div class="s">' + (r ? "<i></i>" + r.name + " · " : "") + s + "</div></div>";
  t.innerHTML = tile("Highest overall", pct(best.overall), best, money(best.totalCost))
    + tile("Best value (≥ 80% overall)", (value.overall * 100 / value.totalCost).toFixed(1) + " pts/$", value, pct(value.overall) + " for " + money(value.totalCost))
    + (cheapGood ? tile("Cheapest at ≥ 85%", money(cheapGood.totalCost), cheapGood, pct(cheapGood.overall)) : tile("Cheapest at ≥ 85%", "—", null, "none in selection"))
    + tile("Fastest build", fastest.totalMin + " min", fastest, "all three apps");
}

// ---- scatter ----
function renderChart() {
  const v = visible().filter((r) => r.overall != null);
  const W = 960, H = 380, L = 48, Rm = 20, T = 14, B = 40;
  const el = document.getElementById("chart");
  if (!v.length) { el.innerHTML = '<p class="hint">Select at least one scored model.</p>'; document.getElementById("legend").innerHTML = ""; return; }
  // Axes fit the SELECTION: log-x spans the selected costs with ~25% padding
  // each side, y spans the selected scores rounded out to the next 5%, so a
  // narrow selection zooms in instead of leaving the plot mostly empty.
  const costs = v.map((r) => r.totalCost), scores = v.map((r) => r.overall * 100);
  let lo = Math.log10(Math.min(...costs)) - 0.12, hi = Math.log10(Math.max(...costs)) + 0.12;
  if (hi - lo < 0.6) { const mid = (lo + hi) / 2; lo = mid - 0.3; hi = mid + 0.3; }
  // Cost axis runs high -> low left to right, so "up and to the right" is better.
  const lx = (c) => L + (hi - Math.log10(c)) / (hi - lo) * (W - L - Rm);
  let ymin = Math.max(0, Math.floor((Math.min(...scores) - 4) / 5) * 5), ymax = Math.min(100, Math.ceil((Math.max(...scores) + 4) / 5) * 5);
  if (ymax - ymin < 15) { ymin = Math.max(0, ymin - 5); ymax = Math.min(100, ymax + 5); }
  const ystep = ymax - ymin > 40 ? 10 : 5;
  const ly = (s) => T + (1 - (s * 100 - ymin) / (ymax - ymin)) * (H - T - B);
  let g = "";
  for (let y = ymin; y <= ymax + 1e-9; y += ystep) g += '<line x1="' + L + '" x2="' + (W - Rm) + '" y1="' + ly(y / 100) + '" y2="' + ly(y / 100) + '" stroke="#1c2740"/><text x="' + (L - 8) + '" y="' + (ly(y / 100) + 4) + '" text-anchor="end" font-size="11" fill="#8b9bb4">' + y + "%</text>";
  // Log ticks: 1-2-5 decades, densified to 1-1.5-2-3-4-5-7 when the span is narrow.
  const mant = hi - lo > 1.2 ? [1, 2, 5] : hi - lo > 0.7 ? [1, 2, 3, 5, 7] : [1, 1.5, 2, 3, 4, 5, 7];
  for (let e = Math.floor(lo) - 1; e <= Math.ceil(hi); e++) for (const m of mant) { const c = m * Math.pow(10, e); if (Math.log10(c) < lo || Math.log10(c) > hi) continue;
    g += '<line y1="' + T + '" y2="' + (H - B) + '" x1="' + lx(c) + '" x2="' + lx(c) + '" stroke="#1c2740"/><text x="' + lx(c) + '" y="' + (H - B + 16) + '" text-anchor="middle" font-size="11" fill="#8b9bb4">$' + (c >= 10 ? Math.round(c) : +c.toFixed(2)) + "</text>"; }
  g += '<text x="' + ((L + W - Rm) / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="11.5" fill="#8b9bb4">Total cost, three apps (log) — cheaper →</text>';
  // points + selective direct labels (all ≤ 12 points get a label; nudge overlaps)
  const pts = v.map((r) => ({ r, x: lx(r.totalCost), y: ly(r.overall) })).sort((a, b) => a.y - b.y);
  // Label placement: try above-right, then below-right, then keep stepping
  // down until the label box clears every label already placed.
  const boxes = pts.map((p) => ({ x0: p.x - 9, x1: p.x + 9, y: p.y })); // markers count as occupied too
  const clash = (b) => boxes.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && Math.abs(b.y - o.y) < 13);
  for (const p of pts) {
    const w = p.r.name.length * 6.6;
    const crowdedRight = pts.some((q) => q !== p && q.x > p.x && q.x - p.x < w + 40 && Math.abs(q.y - p.y) < 16);
    const right = p.x + 12 + w <= W && !crowdedRight;
    const x0 = right ? p.x + 12 : p.x - 12 - w, x1 = x0 + w;
    let dy = -10, tries = 0, box;
    for (;;) { box = { x0, x1, y: p.y + dy }; if (!clash(box) || tries > 12) break; dy = tries === 0 ? 14 : dy + 13; tries++; }
    boxes.push(box);
    const c = VC[p.r.vendor] || "#64748b";
    g += '<g class="pt" data-slug="' + p.r.slug + '"><circle cx="' + p.x + '" cy="' + p.y + '" r="7" fill="' + c + '" stroke="#0b1220" stroke-width="2"/><circle cx="' + p.x + '" cy="' + p.y + '" r="14" fill="transparent"/>'
      + (Math.abs(dy) > 14 ? '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + (right ? x0 - 3 : x1 + 3) + '" y2="' + (p.y + dy) + '" stroke="#475569" stroke-width="1"/>' : "")
      + '<text x="' + (right ? x0 : x1) + '" y="' + (p.y + dy + 4) + '" text-anchor="' + (right ? "start" : "end") + '" font-size="11.5" fill="#cbd5e1">' + p.r.name + "</text></g>";
  }
  el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Overall score versus total cost">' + g + "</svg>";
  const tip = document.getElementById("tip");
  el.querySelectorAll(".pt").forEach((n) => {
    const r = rows.find((x) => x.slug === n.dataset.slug);
    n.addEventListener("mousemove", (e) => { tip.style.display = "block"; tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY + 14) + "px";
      tip.innerHTML = "<b>" + r.name + "</b> · " + r.vendor + " · effort " + r.effort + "<br>Overall <b>" + pct(r.overall) + "</b> · " + money(r.totalCost) + " · " + r.totalMin + " min<br>" + APPS.map((a) => DATA.apps[a].label + " " + (r.perApp[a] ? pct(r.perApp[a].composite) : "—")).join(" · "); });
    n.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  });
  const seen = [...new Set(v.map((r) => r.vendor))];
  document.getElementById("legend").innerHTML = seen.map((s) => '<span><i style="background:' + VC[s] + '"></i>' + s + "</span>").join("");
}

// ---- table ----
const cols = [
  { k: "name", label: "Model", get: (r) => r.name.toLowerCase(), dir: 1 },
  ...APPS.map((a) => ({ k: a, label: DATA.apps[a].label, get: (r) => r.perApp[a]?.composite ?? -1, dir: -1 })),
  { k: "overall", label: "Overall", get: (r) => r.overall ?? -1, dir: -1 },
  { k: "totalCost", label: "Total cost", get: (r) => r.totalCost, dir: 1 },
  { k: "totalMin", label: "Build time", get: (r) => r.totalMin, dir: 1 },
];
function renderTable() {
  const thead = document.querySelector("#table thead");
  thead.innerHTML = "<tr>" + cols.map((c) => '<th data-k="' + c.k + '" class="' + (sortKey === c.k ? "sorted" : "") + '">' + c.label + (sortKey === c.k ? '<span class="arr">' + (sortDir < 0 ? "▼" : "▲") + "</span>" : "") + "</th>").join("") + "</tr>";
  thead.querySelectorAll("th").forEach((th) => th.onclick = () => { const c = cols.find((x) => x.k === th.dataset.k); if (sortKey === c.k) sortDir = -sortDir; else { sortKey = c.k; sortDir = c.dir; } renderTable(); });
  const col = cols.find((c) => c.k === sortKey);
  const v = visible().sort((a, b) => { const x = col.get(a), y = col.get(b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
  const best = v.filter((r) => r.overall != null).sort((a, b) => b.overall - a.overall)[0];
  const cell = (c, color) => !c ? '<td class="na">not run</td>' : c.composite == null ? '<td class="na">built · ' + money(c.cost) + "</td>"
    : "<td><b>" + pct(c.composite) + "</b><span class=\\"sub\\">" + money(c.cost) + " · " + c.minutes + " min</span><div class=\\"bar\\" style=\\"--c:" + color + "\\"><i style=\\"width:" + (c.composite * 100).toFixed(0) + "%\\"></i></div></td>";
  document.querySelector("#table tbody").innerHTML = v.map((r) => { const color = VC[r.vendor] || "#64748b";
    return '<tr class="' + (r === best ? "best" : "") + '"><td class="model"><span class="name"><i style="background:' + color + '"></i>' + r.name + ' <span class="eff" title="reasoning effort recorded on the wire">' + r.effort + "</span></span><span class=\\"sub\\">" + r.vendor + (r.note ? " · " + r.note : "") + "</span></td>"
      + APPS.map((a) => cell(r.perApp[a], color)).join("")
      + '<td class="overall">' + (r.overall == null ? '<span class="na">partial ' + r.scoredApps + "/" + r.presentApps + "</span>" : "<b>" + pct(r.overall) + "</b>") + "</td>"
      + "<td><b>" + money(r.totalCost) + "</b></td><td><b>" + r.totalMin + " min</b></td></tr>"; }).join("");
}

// ---- apps + note ----
const APP_ACCENT = ["#3987e5", "#199e70", "#9678f0"];
document.getElementById("apps").innerHTML = APPS.map((a, i) => { const A = DATA.apps[a];
  return '<section class="card app" style="--c:' + APP_ACCENT[i % APP_ACCENT.length] + '"><h3>' + A.label + "<span>" + A.tag + "</span></h3>"
    + '<p class="blurb">' + A.blurb + "</p><p class=\\"ml\\">Milestones</p><ol>"
    + A.milestones.map((m, j) => "<li><b>M" + (j + 1) + "</b>" + m + "</li>").join("")
    + "</ol><p class=\\"suite\\">Scored by " + A.cujs + " customer-journey tests and " + A.probes + " security probes across three checkpoints, plus an LLM judge.</p></section>"; }).join("");
document.getElementById("note").textContent = "Composite = 60% customer-journey tests + 25% security probes + 15% LLM judge, averaged over an app's three checkpoints. Overall = mean of the three apps, shown only once all three are scored. One run per cell — differences of a few points are within run-to-run variance. The effort badge is the reasoning effort recorded on the wire for every request of the cell (Dyad product default = medium); OpenRouter-routed models (Grok, GLM) are sent no effort field and run at the provider default. Generated " + DATA.generated + ".";

function update() { save(); renderFilters(); renderTiles(); renderChart(); renderTable(); }
update();
</script></html>`;
fs.writeFileSync(path.join(DIR, "scores.html"), html);
console.log(`scores page: ${rows.length} models -> ${path.join(DIR, "scores.html")}`);
EOF
