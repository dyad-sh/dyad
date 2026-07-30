// Generates RESULTS.md + scatter-{light,dark}.svg from the current results/
// tree, across all app columns present. Rerun after any scoring pass:
//   node benchmarks/app-builder/report.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const R = (...p) => path.join(BENCH, "results", ...p);

const MODELS = [
  { name: "gpt-5.6-terra", slug: "gpt-5.6-terra", vendor: "OpenAI" },
  { name: "gpt-5.6-luna", slug: "gpt-5.6-luna", vendor: "OpenAI" },
  { name: "gpt-5.6-sol", slug: "gpt-5.6-sol", vendor: "OpenAI" },
  { name: "claude-sonnet-5", slug: "claude-sonnet-5", vendor: "Anthropic" },
  { name: "claude-opus-5", slug: "claude-opus-5", vendor: "Anthropic" },
  { name: "claude-fable-5", slug: "claude-fable-5", vendor: "Anthropic" },
  { name: "grok-4.5", slug: "x-ai_grok-4.5", vendor: "xAI" },
];

// Per-app checkpoint composition + probe-id classifier (suite conventions
// differ per app; see each app's fixtures).
const APPS = {
  "relay-crm": {
    cujs: { 1: 10, 2: 12, 3: 12 },
    probes: { 1: 2, 2: 6, 3: 8 },
    isProbe: (id) => /-s\d/.test(id),
  },
  deskhero: {
    cujs: { 1: 9, 2: 12, 3: 12 },
    probes: { 1: 3, 2: 8, 3: 10 },
    isProbe: (id) => /-p-/.test(id),
  },
  portalis: {
    cujs: { 1: 10, 2: 12, 3: 12 },
    probes: { 1: 2, 2: 7, 3: 9 },
    isProbe: (id) => /^S\d-/.test(id),
  },
};
// Categorical slots 1-3 (validated via dataviz validate_palette.js both modes).
const VENDOR_COLOR = {
  light: { OpenAI: "#2a78d6", Anthropic: "#eb6834", xAI: "#1baf7a" },
  dark: { OpenAI: "#3987e5", Anthropic: "#d95926", xAI: "#199e70" },
};

function scoreCell(slug, app) {
  const cfg = APPS[app];
  const cell = `${slug}-${app}`;
  const sumPath = R("s-cell", `${cell}.summary.json`);
  if (!fs.existsSync(sumPath)) return null;
  const sum = JSON.parse(fs.readFileSync(sumPath));
  const minutes = Math.round(
    sum.milestones.reduce((a, m) => a + m.durationMs, 0) / 60000,
  );
  const cost = sum.milestones.reduce((a, m) => a + m.estimatedUsd, 0);
  let cujP = 0,
    cujT = 0,
    prP = 0,
    prT = 0,
    judge = 0,
    jn = 0,
    scored = 0;
  const fails = [];
  for (const ck of [1, 2, 3]) {
    cujT += cfg.cujs[ck];
    prT += cfg.probes[ck];
    const f = R("s-score", `${cell}-ckpt${ck}-a1.json`);
    if (!fs.existsSync(f)) continue;
    scored++;
    const x = JSON.parse(fs.readFileSync(f));
    if (x.buildStatus !== "ok") {
      // Non-building checkpoint: zero credit (its failures list is empty
      // because the suite never ran — do NOT count that as passing).
      fails.push(`${x.buildStatus}@${app}:ckpt${ck}`);
      continue;
    }
    const probeFails = x.failures.filter(cfg.isProbe).length;
    cujP += cfg.cujs[ck] - (x.failures.length - probeFails);
    prP += cfg.probes[ck] - probeFails;
    fails.push(...x.failures.map((id) => `${id}@${app}:ckpt${ck}`));
    const jf = R("judge", `${cell}-m${ck}.json`);
    if (fs.existsSync(jf)) {
      judge += JSON.parse(fs.readFileSync(jf)).judgeScore;
      jn++;
    }
  }
  const judgeAvg = jn ? judge / jn : 0;
  // Composite only when all 3 checkpoints are scored — a mid-scoring cell
  // would otherwise count its unscored checkpoints as zeros.
  const composite =
    scored === 3
      ? 0.6 * (cujP / cujT) + 0.25 * (prP / prT) + 0.15 * judgeAvg
      : null;
  return {
    minutes,
    cost,
    cujP,
    cujT,
    prP,
    prT,
    judgeAvg,
    composite,
    fails,
    scored,
  };
}

const appNames = Object.keys(APPS);
const rows = MODELS.map((m) => {
  const perApp = Object.fromEntries(
    appNames.map((a) => [a, scoreCell(m.slug, a)]),
  );
  const present = appNames.map((a) => perApp[a]).filter(Boolean);
  const scoredApps = present.filter((x) => x.composite !== null);
  const overall = scoredApps.length
    ? scoredApps.reduce((s, x) => s + x.composite, 0) / scoredApps.length
    : null;
  const totalCost = present.reduce((s, x) => s + x.cost, 0);
  const totalMin = present.reduce((s, x) => s + x.minutes, 0);
  return { ...m, perApp, overall, totalCost, totalMin };
}).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

// ---- scatter SVG (overall score vs total cost) ----------------------------
function scatter(mode) {
  const ink =
    mode === "light"
      ? { text: "#374151", muted: "#6b7280", grid: "#e5e7eb", ring: "#fcfcfb" }
      : { text: "#d1d5db", muted: "#9ca3af", grid: "#374151", ring: "#1a1a19" };
  const W = 720,
    H = 420,
    M = { t: 44, r: 24, b: 52, l: 64 };
  const maxCost = Math.max(...rows.map((r) => r.totalCost), 1);
  const xMax = Math.ceil(maxCost / 10) * 10;
  const yMin = 80,
    yMax = 96;
  const X = (c) => M.l + ((W - M.l - M.r) * c) / xMax;
  const Y = (s) =>
    M.t + (H - M.t - M.b) * (1 - (s * 100 - yMin) / (yMax - yMin));
  const els = [];
  for (let g = yMin; g <= yMax; g += 4) {
    els.push(
      `<line x1="${M.l}" y1="${Y(g / 100)}" x2="${W - M.r}" y2="${Y(g / 100)}" stroke="${ink.grid}" stroke-width="1"/>`,
      `<text x="${M.l - 8}" y="${Y(g / 100) + 4}" text-anchor="end" fill="${ink.muted}" font-size="11">${g}%</text>`,
    );
  }
  const xStep = xMax > 30 ? 10 : 4;
  for (let c = 0; c <= xMax; c += xStep) {
    els.push(
      `<text x="${X(c)}" y="${H - M.b + 18}" text-anchor="middle" fill="${ink.muted}" font-size="11">$${c}</text>`,
    );
  }
  let flip = false;
  for (const r of rows) {
    if (r.overall === null) continue;
    const c = VENDOR_COLOR[mode][r.vendor];
    flip = !flip;
    els.push(
      `<circle cx="${X(r.totalCost)}" cy="${Y(r.overall)}" r="7" fill="${c}" stroke="${ink.ring}" stroke-width="2"/>`,
      `<text x="${X(r.totalCost)}" y="${Y(r.overall) + (flip ? -12 : 22)}" text-anchor="middle" fill="${ink.text}" font-size="11.5">${r.name}</text>`,
    );
  }
  const legend = Object.entries(VENDOR_COLOR[mode])
    .map(
      ([v, c], i) =>
        `<circle cx="${M.l + 12 + i * 110}" cy="${18}" r="5" fill="${c}"/>` +
        `<text x="${M.l + 22 + i * 110}" y="${22}" fill="${ink.text}" font-size="12">${v}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif">
${legend}
${els.join("\n")}
<text x="${(M.l + W - M.r) / 2}" y="${H - 10}" text-anchor="middle" fill="${ink.text}" font-size="12.5">Total build cost, all apps (USD, list price)</text>
<text transform="rotate(-90)" x="${-(M.t + (H - M.t - M.b) / 2)}" y="16" text-anchor="middle" fill="${ink.text}" font-size="12.5">Overall composite (axis from ${yMin}%)</text>
</svg>`;
}
fs.writeFileSync(path.join(BENCH, "scatter-light.svg"), scatter("light"));
fs.writeFileSync(path.join(BENCH, "scatter-dark.svg"), scatter("dark"));

// ---- RESULTS.md ------------------------------------------------------------
const pct = (x) => (x === null ? "—" : `${(100 * x).toFixed(1)}%`);
const appCol = (r, a) => {
  const x = r.perApp[a];
  if (!x) return "—";
  if (x.composite === null) return `built ($${x.cost.toFixed(2)})`;
  return `${pct(x.composite)} ($${x.cost.toFixed(2)})`;
};
const table = rows
  .map(
    (r) =>
      `| ${r.name} | ${appCol(r, "relay-crm")} | ${appCol(r, "deskhero")} | ${appCol(r, "portalis")} | ${r.totalMin} min | $${r.totalCost.toFixed(2)} | **${pct(r.overall)}** |`,
  )
  .join("\n");
const failDetail = rows
  .map((r) => {
    const fails = appNames.flatMap((a) => r.perApp[a]?.fails ?? []);
    return `- **${r.name}**: ${fails.length ? fails.join(", ") : "clean sweep"}`;
  })
  .join("\n");

fs.writeFileSync(
  path.join(BENCH, "RESULTS.md"),
  `# App-Builder Benchmark — Results

Run: 2026-07-29 · 7 models × up to 3 apps (Relay CRM, Deskhero, Portalis) ×
3 milestones each, N=1, Dyad local-agent mode at product-default reasoning
effort (medium, recorded per request). Per checkpoint: fixed Playwright CUJ
suites + adversarial security probes against pinned UI contracts, plus an LLM
judge (gpt-5.6-sol, single judge, input-capped). Composite per app =
60% CUJ + 25% probes + 15% judge; overall = mean of scored app composites.
Costs are list-price dollars from exact per-request token counts
(cached/uncached/cache-write split) captured at the wire.

| Model | Relay CRM | Deskhero | Portalis | Build time | Total cost | Overall |
|---|---|---|---|---|---|---|
${table}

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="scatter-dark.svg">
  <img alt="Overall composite score versus total build cost across all apps" src="scatter-light.svg">
</picture>

## Per-model failures

${failDetail}

## Caveats (disclosed by design)

- N=1 per cell. Judge is gpt-5.6-sol for all candidates (user decision;
  same-vendor bias toward the gpt-5.6 family — bounded by the 15% judge weight).
- claude-sonnet-5 priced at intro rates (through 2026-08-31).
- Web tools enabled (product realism over reproducibility; web drift caveat).
- Durations exclude infra stalls (client-abort rows checked per cell).
- A complementary blind code review (opus-5, correctness/security/
  maintainability) lives in results/opus-review/ — behavioral scores and code
  quality diverge; see the PR discussion.

Regenerate: \`node benchmarks/app-builder/report.mjs\` (reads results/).
`,
);
console.log("wrote RESULTS.md + scatters");
console.log(
  rows
    .map((r) => `${r.name} ${pct(r.overall)} $${r.totalCost.toFixed(2)}`)
    .join(" | "),
);
