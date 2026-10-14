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
node --input-type=module - "$BENCH" "$DIR" <<'EOF'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [BENCH, DIR] = process.argv.slice(2);
const { scoreArtifacts } = await import(pathToFileURL(path.join(BENCH, "scoring.mjs")));
const R = (...p) => path.join(BENCH, "results", ...p);

// Mirrors report.mjs: registered models and per-app suite composition.
const MODELS = [
  {"name":"GPT-6.1 Sol","slug":"gpt-6.1-sol","vendor":"OpenAI","effort":"medium","note":"Benchmark-local catalog entry at official API default medium; not a verified Dyad product default. 128000 output limit."},
  {"name":"Claude Sonnet 5.5","slug":"claude-sonnet-5-5","vendor":"Anthropic","effort":"medium","note":"Explicit medium via benchmark-local catalog pin; not a verified Dyad default (Anthropic API defaults to high). 128000 output limit. Fresh r2 after repairing cache-token recording; interrupted attempt excluded."},
  {"name":"GPT-6 Luna","slug":"gpt-6-luna","vendor":"OpenAI","effort":"medium"},
  {"name":"GPT-6 Sol","slug":"gpt-6-sol","vendor":"OpenAI","effort":"medium"},
  {"name":"Claude Opus 5.5","slug":"claude-opus-5-5","vendor":"Anthropic","effort":"medium"},
  {"name":"grok-4.7","slug":"x-ai_grok-4.7","vendor":"xAI","effort":"provider default","note":"Catalog medium; default has no wire effort override. High arm explicitly requests high. Grok output cap 65536 in both arms."},
  {"name":"mimo-v2.6-pro","slug":"xiaomi_mimo-v2.6-pro","vendor":"Xiaomi","effort":"provider default","note":"Catalog medium; default has no wire effort override. High arm explicitly requests high. Grok output cap 65536 in both arms."},
  {"name":"mimo-v2.6-flash","slug":"xiaomi_mimo-v2.6-flash","vendor":"Xiaomi","effort":"provider default","note":"Catalog medium; default has no wire effort override. High arm explicitly requests high. Grok output cap 65536 in both arms."},
  { name: "DeepSeek V4.1 Flash", slug: "deepseek_deepseek-v4.1-flash", vendor: "DeepSeek", effort: "provider default", note: "Catalog high; no wire override. Cost at vendor off-peak list rates." },
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
const VENDOR_COLOR = { OpenAI: "#3987e5", Anthropic: "#d95926", xAI: "#199e70", Dyad: "#9678f0", "Z-AI": "#e0568f", Google: "#e3a72f", Meta: "#2cc4d9", DeepSeek: "#9299ed", Xiaomi: "#ffad42" };

// Mirrors CELL_OVERRIDES in report.mjs; recovery and user-selected repeat reasons recorded there.
const CELL_OVERRIDES = {
  // Sonnet 5.5: explicitly medium; benchmark-local catalog pin pending Dyad catalog support.
  "claude-sonnet-5-5-relay-crm": "claude-sonnet-5-5-relay-crm-medium-r2",
  "claude-sonnet-5-5-deskhero": "claude-sonnet-5-5-deskhero-medium-r2",
  "claude-sonnet-5-5-portalis": "claude-sonnet-5-5-portalis-medium-r2",
  // User-selected Deskhero repeats (2026-09-22); original scored artifacts preserved.
  "gpt-6-sol-deskhero": "gpt-6-sol-deskhero-repeat1",
  "gpt-6-luna-deskhero": "gpt-6-luna-deskhero-repeat1",
  // r6 recovery after interrupted/context-overflow r5; all score/judge pairs validated.
  "xiaomi_mimo-v2.6-pro-portalis": "xiaomi_mimo-v2.6-pro-portalis-r6",
  // r6 high recovered from prior transport failure; build and all score/judge pairs validated.
  "xiaomi_mimo-v2.6-pro-relay-crm-high": "xiaomi_mimo-v2.6-pro-relay-crm-high-r6",
  // Preserved r5 build; CA-related font-fetch scoring failures repaired and all scores/judges validated.
  "xiaomi_mimo-v2.6-pro-relay-crm": "xiaomi_mimo-v2.6-pro-relay-crm-r5",
  // Budget-blocked Grok high retry; r5 scores/judges validated.
  "x-ai_grok-4.7-relay-crm-high": "x-ai_grok-4.7-relay-crm-high-r5",
  "x-ai_grok-4.7-deskhero-high": "x-ai_grok-4.7-deskhero-high-r5",
  "x-ai_grok-4.7-portalis-high": "x-ai_grok-4.7-portalis-high-r5",
  // Credential-lifetime infrastructure retry; r4 scores/judges validated.
  "x-ai_grok-4.7-relay-crm": "x-ai_grok-4.7-relay-crm-r4",
  "x-ai_grok-4.7-deskhero": "x-ai_grok-4.7-deskhero-r4",
  "x-ai_grok-4.7-portalis": "x-ai_grok-4.7-portalis-r4",
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
  return scoreArtifacts(BENCH, cell, app, cfg);
}

const appNames = Object.keys(APPS);
const rows = MODELS.map((m) => {
  const perApp = Object.fromEntries(appNames.map((a) => [a, scoreCell(m.slug, a)]));
  const present = appNames.map((a) => perApp[a]).filter(Boolean);
  const scoredApps = present.filter((x) => x.composite !== null);
  const overall = scoredApps.length === present.length && present.length >= 3
    ? scoredApps.reduce((s, x) => s + x.composite, 0) / scoredApps.length : null;
  return { name: m.name, slug: m.slug, vendor: m.vendor, effort: m.effort, note: m.note || "", perApp, overall,
    scoredApps: scoredApps.length, presentApps: present.length, costVerified: present.every(x=>x.costVerified),
    totalCost: +present.reduce((s, x) => s + x.cost, 0).toFixed(2),
    totalMin: present.reduce((s, x) => s + x.minutes, 0) };
}).filter((r) => r.presentApps > 0);

const DATA = { rows, apps: Object.fromEntries(appNames.map((a) => [a, { label: APPS[a].label, tag: APPS[a].tag, blurb: APPS[a].blurb, milestones: APPS[a].milestones,
  cujs: Object.values(APPS[a].cujs).reduce((s, x) => s + x, 0), probes: Object.values(APPS[a].probes).reduce((s, x) => s + x, 0) }])),
  vendorColor: VENDOR_COLOR, generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" };

const demoCards = [
  ["claude-sonnet-5-5", "Claude Sonnet 5.5", false, "claude-sonnet-5-5", "-medium-r2", "Explicit medium effort · measured r2 run after recorder fix"],
  ["gpt-6-sol", "GPT-6 Sol", true],
  ["claude-opus-5-5", "Claude Opus 5.5", false],
  ["gpt-6-luna", "GPT-6 Luna", true],
  ["deepseek-v4.1-flash", "DeepSeek V4.1 Flash", false, "deepseek_deepseek-v4.1-flash"],
].map(([slug, name, repeat, appSlug = slug, suffix = "", note]) => `<article class="card demo" id="demo-${slug}">
  <h3>${name}</h3>
  <p>${note || (repeat ? "Original CRM and Portalis · Deskhero repeat 1" : "Original runs · all three apps")}</p>
  <video controls preload="none" playsinline aria-label="${name} — all three app demos" src="demo-${slug}-all-apps.mp4"></video>
  <a href="demo-${slug}-all-apps.mp4">Watch all three apps ↗</a>
  <nav aria-label="${name} individual demos">${[["relay-crm", "Relay CRM"], ["deskhero", "Deskhero"], ["portalis", "Portalis"]].map(([app, label]) => `<a href="demo-${appSlug}-${app}${repeat && app === "deskhero" ? "-repeat1" : suffix}.mp4">${label}${repeat && app === "deskhero" ? " (repeat)" : ""}</a>`).join(" · ")}</nav>
</article>`).join("\n");

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App-builder benchmark — scores</title>
<script>
try { const p = localStorage.getItem('appbench.theme') || 'system'; document.documentElement.dataset.theme = p === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p; } catch { document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
</script>
<style>${fs.readFileSync(path.join(DIR, "../../site/scores.css"), "utf8")}</style>
<div class="wrap">
<div class="topbar"><a class="brand" href="#">dyad<span>/ benchmarks</span></a><nav class="topnav" aria-label="Page navigation"><a href="#results">Results</a><a href="#demos">App demos</a><a href="#methodology">Methodology</a><label class="theme-label"><span>Appearance</span><select id="theme" aria-label="Color theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></nav></div>
<header><div><p class="eyebrow">Real apps. Measured results.</p><h1>App-builder benchmark</h1></div><a class="btn" href="#demos">▶ Watch app demos</a></header>
<p class="lead">How well can AI build a working app? Compare quality, cost, and speed across three real full-stack projects — then watch the results for yourself.</p>

<div class="facts"><span>3 apps per model</span><span>60% functionality · 25% security · 15% judge</span><span>List-priced token costs · excludes judging and tool-service fees</span></div>
<section class="tiles" id="tiles" aria-label="Result highlights"></section>
<section class="card filters" id="results" aria-label="Filter models">
  <div class="frow"><span class="lbl">Vendor</span><span id="vendors"></span><span class="count" id="count"></span></div>
  <details class="model-options"><summary>Choose individual models</summary><div class="frow"><span id="models"></span></div></details>
  <div class="frow"><span class="lbl"></span><input class="search" id="search" aria-label="Find a model" placeholder="Filter by name…"><button class="link" id="all">select all</button><button class="link" id="none">clear</button><button class="link" id="top">top 5</button></div>
</section>

<p class="note run-note">GPT-6 Sol and Luna use user-selected Deskhero repeat1 results with their original Relay CRM and Portalis runs (updated 2026-09-22). Before the harness repair, original overall scores were 74.7 and 71.2; original artifacts are preserved. These are mixed-run results, not fresh three-app runs.</p>


<div class="grid">
  <section class="card chart"><div class="section-head"><div><h2>Quality meets cost</h2><p class="hint">Each point is a model. Select a point or name to explore its results.</p></div><span class="direction">Better value ↗</span></div><p class="hint">≥ marks incomplete token accounting. Those models retain quality scores but are excluded from cost/value comparisons.</p><div class="chart-layout"><div class="plot"><div id="chart"></div><div class="legend" id="legend"></div></div><div class="chart-key" id="chart-key" aria-label="Chart model key"></div></div><div class="chart-detail" id="chart-detail" aria-live="polite"></div></section>
  <section class="card tbl"><h2>Per-app scores <span style="color:var(--muted);font-weight:400;font-size:12px">Sort by any column · scroll sideways on smaller screens</span></h2><table id="table"><thead></thead><tbody></tbody></table></section>
</div>
<div class="tip" id="tip"></div>

<h2 class="sec" id="demos">Watch the apps</h2>
<p class="note">Walkthroughs of the actual generated apps. Unsuccessful tour steps remain visible. Sol and Luna's Deskhero videos use the same repeat runs selected for the leaderboard.</p>
<section class="demos" aria-label="Model video demos">${demoCards}</section>
<p class="note"><a href="index.html">More model demos →</a></p>

<details class="methodology" id="methodology"><summary>What are we measuring?</summary>
<section class="apps" id="apps"></section>
<p class="note">September 2026 audit: saved app checkpoints reevaluated with repaired UI interactions and token accounting. Generated code, scoring weights, and selected runs are unchanged. Judge verdicts are refreshed when their test evidence changes. Missing archives or judges remain unscored; incomplete token costs are labelled ≥.</p><p class="note" id="note"></p></details><footer class="footer"><span>Dyad · App-builder benchmark</span><span>One sample per run. Small score differences may be noise.</span></footer>
</div>
<script>
const DATA = ${JSON.stringify(DATA)};
const themeControl = document.getElementById('theme');
try { themeControl.value = localStorage.getItem('appbench.theme') || 'system'; } catch {}
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() { document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value; }
themeControl.addEventListener('change', () => { try { localStorage.setItem('appbench.theme', themeControl.value); } catch {} applyTheme(); });
systemTheme.addEventListener('change', applyTheme);
applyTheme();
const APPS = Object.keys(DATA.apps);
const rows = DATA.rows;
const VC = DATA.vendorColor;
const pct = (x) => x == null ? "—" : (x * 100).toFixed(1) + "%";
const money = (x, verified = true) => (verified ? "" : "≥") + "$" + x.toFixed(2);

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
    const el = document.createElement("button"); el.type = "button"; el.setAttribute("aria-pressed", String(on)); el.className = "chip " + (on ? "on" : "off"); el.style.setProperty("--c", VC[v] || "#64748b");
    el.innerHTML = '<span class="dot"></span>' + v;
    el.onclick = () => { const mine = rows.filter((r) => r.vendor === v); const allOn = mine.every((r) => selected.has(r.slug)); mine.forEach((r) => allOn ? selected.delete(r.slug) : selected.add(r.slug)); update(); };
    vEl.appendChild(el);
  }
  const mEl = document.getElementById("models"); mEl.innerHTML = "";
  const q = (document.getElementById("search").value || "").toLowerCase();
  for (const r of rows) {
    if (q && !r.name.toLowerCase().includes(q) && !r.vendor.toLowerCase().includes(q)) continue;
    const on = selected.has(r.slug);
    const el = document.createElement("button"); el.type = "button"; el.setAttribute("aria-pressed", String(on)); el.className = "chip model-chip " + (on ? "on" : "off"); el.style.setProperty("--c", VC[r.vendor] || "#64748b");
    el.innerHTML = '<span class="dot"></span>' + r.name + (r.overall != null ? ' <span style="opacity:.8;font-weight:600">' + pct(r.overall) + "</span>" : "");
    el.onclick = () => { on ? selected.delete(r.slug) : selected.add(r.slug); update(); };
    mEl.appendChild(el);
  }
  document.getElementById("count").textContent = visible().length + " of " + rows.length + " models shown";
}
document.getElementById("search").addEventListener("input", () => { document.querySelector(".model-options").open = true; renderFilters(); });
document.getElementById("all").onclick = () => { rows.forEach((r) => selected.add(r.slug)); update(); };
document.getElementById("none").onclick = () => { selected.clear(); update(); };
document.getElementById("top").onclick = () => { selected = new Set(rows.filter((r) => r.overall != null).sort((a, b) => b.overall - a.overall).slice(0, 5).map((r) => r.slug)); update(); };

// ---- tiles ----
function renderTiles() {
  const v = visible().filter((r) => r.overall != null);
  const t = document.getElementById("tiles"); t.innerHTML = "";
  if (!v.length) return;
  const best = [...v].sort((a, b) => b.overall - a.overall)[0];
  const priced = v.filter(r => r.costVerified);
  const pool = priced.some((r) => r.overall >= 0.8) ? priced.filter((r) => r.overall >= 0.8) : priced;
  const value = [...pool].sort((a, b) => (b.overall / b.totalCost) - (a.overall / a.totalCost))[0];
  const fastest = [...v].sort((a, b) => a.totalMin - b.totalMin)[0];
  const tile = (k, val, r, s) => '<div class="card tile" style="--c:' + (r ? VC[r.vendor] : "#334a72") + '"><div class="k">' + k + '</div><div class="v">' + val + '</div><div class="s">' + (r ? "<i></i>" + r.name + " · " : "") + s + "</div></div>";
  t.innerHTML = tile("Highest overall", pct(best.overall), best, money(best.totalCost, best.costVerified))
    + (value ? tile("Best value (≥ 80% overall)", (value.overall * 100 / value.totalCost).toFixed(1) + " pts/$", value, pct(value.overall) + " for " + money(value.totalCost)) : tile("Best value", "—", null, "No verified costs in this selection"))
    + tile("Fastest build", fastest.totalMin + " min", fastest, "all three apps");
}

// ---- scatter ----
${fs.readFileSync(path.join(DIR, "../../site/chart.js"), "utf8")}

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
  thead.innerHTML = "<tr>" + cols.map((c) => '<th tabindex="0" role="columnheader" aria-sort="' + (sortKey === c.k ? (sortDir < 0 ? 'descending' : 'ascending') : 'none') + '" data-k="' + c.k + '" class="' + (sortKey === c.k ? "sorted" : "") + '">' + c.label + (sortKey === c.k ? '<span class="arr">' + (sortDir < 0 ? "▼" : "▲") + "</span>" : "") + "</th>").join("") + "</tr>";
  thead.querySelectorAll("th").forEach((th) => th.onclick = () => { const c = cols.find((x) => x.k === th.dataset.k); if (sortKey === c.k) sortDir = -sortDir; else { sortKey = c.k; sortDir = c.dir; } renderTable(); });
  thead.querySelectorAll("th").forEach((th) => th.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); th.click(); thead.querySelector('[data-k="' + th.dataset.k + '"]').focus(); } });
  const col = cols.find((c) => c.k === sortKey);
  const v = visible().sort((a, b) => { const x = col.get(a), y = col.get(b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
  const best = v.filter((r) => r.overall != null).sort((a, b) => b.overall - a.overall)[0];
  const cell = (c, color) => !c ? '<td class="na">not run</td>' : c.composite == null ? '<td class="na">unscored · ' + money(c.cost, c.costVerified) + "</td>"
    : "<td><b>" + pct(c.composite) + "</b><span class=\\"sub\\">" + money(c.cost, c.costVerified) + " · " + c.minutes + " min</span><div class=\\"bar\\" style=\\"--c:" + color + "\\"><i style=\\"width:" + (c.composite * 100).toFixed(0) + "%\\"></i></div></td>";
  document.querySelector("#table tbody").innerHTML = v.map((r) => { const color = VC[r.vendor] || "#64748b";
    return '<tr class="' + (r === best ? "best" : "") + '"><td class="model"><span class="name"><i style="background:' + color + '"></i>' + r.name + ' <span class="eff" title="reasoning effort recorded on the wire">' + r.effort + "</span></span><span class=\\"sub\\">" + r.vendor + (r.note ? " · " + r.note : "") + "</span></td>"
      + APPS.map((a) => cell(r.perApp[a], color)).join("")
      + '<td class="overall">' + (r.overall == null ? '<span class="na">partial ' + r.scoredApps + "/" + Math.max(3, r.presentApps) + "</span>" : "<b>" + pct(r.overall) + "</b>") + "</td>"
      + "<td><b>" + money(r.totalCost, r.costVerified) + "</b></td><td><b>" + r.totalMin + " min</b></td></tr>"; }).join("");
}

// ---- apps + note ----
const APP_ACCENT = ["#3987e5", "#199e70", "#9678f0"];
document.getElementById("apps").innerHTML = APPS.map((a, i) => { const A = DATA.apps[a];
  return '<section class="card app" style="--c:' + APP_ACCENT[i % APP_ACCENT.length] + '"><h3>' + A.label + "<span>" + A.tag + "</span></h3>"
    + '<p class="blurb">' + A.blurb + "</p><p class=\\"ml\\">Milestones</p><ol>"
    + A.milestones.map((m, j) => "<li><b>M" + (j + 1) + "</b>" + m + "</li>").join("")
    + "</ol><p class=\\"suite\\">Scored by " + A.cujs + " customer-journey tests and " + A.probes + " security probes across three checkpoints, plus an LLM judge.</p></section>"; }).join("");
document.getElementById("note").textContent = "Composite = 60% customer-journey pass rate + 25% security-probe pass rate across all three checkpoints + 15% mean LLM-judge score. Overall = mean of the three apps, shown only once all three are scored. One run per cell — differences of a few points are within run-to-run variance. The effort badge is the reasoning effort recorded on the wire for every request of the cell (Dyad product default = medium); OpenRouter-routed models (Grok, GLM) are sent no effort field and run at the provider default. Generated " + DATA.generated + ".";

function update() { save(); renderFilters(); renderTiles(); renderChart(); renderTable(); }
update();
</script></html>`;
fs.writeFileSync(path.join(DIR, "scores.html"), html);
console.log(`scores page: ${rows.length} models -> ${path.join(DIR, "scores.html")}`);
EOF
