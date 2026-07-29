// Generates RESULTS.md + scatter-{light,dark}.svg from the current results/
// tree. Rerun after any scoring pass: node benchmarks/app-builder/report.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const R = (...p) => path.join(BENCH, "results", ...p);

const MODELS = [
  { name: "gpt-5.6-terra", cell: "gpt-5.6-terra-relay-crm", vendor: "OpenAI" },
  { name: "gpt-5.6-luna", cell: "gpt-5.6-luna-relay-crm", vendor: "OpenAI" },
  { name: "gpt-5.6-sol", cell: "gpt-5.6-sol-relay-crm", vendor: "OpenAI" },
  {
    name: "claude-sonnet-5",
    cell: "claude-sonnet-5-relay-crm",
    vendor: "Anthropic",
  },
  {
    name: "claude-opus-5",
    cell: "claude-opus-5-relay-crm",
    vendor: "Anthropic",
  },
  {
    name: "claude-fable-5",
    cell: "claude-fable-5-relay-crm",
    vendor: "Anthropic",
  },
  { name: "grok-4.5", cell: "x-ai_grok-4.5-relay-crm", vendor: "xAI" },
];
const PROBES = { 1: 2, 2: 6, 3: 8 };
const CUJS = { 1: 10, 2: 12, 3: 12 };
// Categorical slots 1-3 (validated via dataviz validate_palette.js both modes).
const VENDOR_COLOR = {
  light: { OpenAI: "#2a78d6", Anthropic: "#eb6834", xAI: "#1baf7a" },
  dark: { OpenAI: "#3987e5", Anthropic: "#d95926", xAI: "#199e70" },
};

const rows = MODELS.map((m) => {
  const sum = JSON.parse(
    fs.readFileSync(R("s-cell", `${m.cell}.summary.json`)),
  );
  const minutes = Math.round(
    sum.milestones.reduce((a, x) => a + x.durationMs, 0) / 60000,
  );
  const cost = sum.milestones.reduce((a, x) => a + x.estimatedUsd, 0);
  let cujP = 0,
    cujT = 0,
    prP = 0,
    prT = 0,
    judge = 0,
    jn = 0;
  const fails = [];
  for (const ck of [1, 2, 3]) {
    cujT += CUJS[ck];
    prT += PROBES[ck];
    const f = R("s-score", `${m.cell}-ckpt${ck}-a1.json`);
    if (!fs.existsSync(f)) continue;
    const x = JSON.parse(fs.readFileSync(f));
    const probeFails = x.failures.filter((id) => /-s\d/.test(id)).length;
    cujP += CUJS[ck] - (x.failures.length - probeFails);
    prP += PROBES[ck] - probeFails;
    fails.push(...x.failures.map((id) => `${id}@ckpt${ck}`));
    const jf = R("judge", `${m.cell}-m${ck}.json`);
    if (fs.existsSync(jf)) {
      judge += JSON.parse(fs.readFileSync(jf)).judgeScore;
      jn++;
    }
  }
  const judgeAvg = jn ? judge / jn : 0;
  const composite = 0.6 * (cujP / cujT) + 0.25 * (prP / prT) + 0.15 * judgeAvg;
  return {
    ...m,
    minutes,
    cost,
    cujP,
    cujT,
    prP,
    prT,
    judgeAvg,
    composite,
    fails,
  };
}).sort((a, b) => b.composite - a.composite);

// ---- scatter SVG (score vs cost) ------------------------------------------
function scatter(mode) {
  const ink =
    mode === "light"
      ? { text: "#374151", muted: "#6b7280", grid: "#e5e7eb", ring: "#fcfcfb" }
      : { text: "#d1d5db", muted: "#9ca3af", grid: "#374151", ring: "#1a1a19" };
  const W = 720,
    H = 420,
    M = { t: 44, r: 24, b: 52, l: 64 };
  const xMax = 14,
    yMin = 85,
    yMax = 95;
  const X = (c) => M.l + ((W - M.l - M.r) * c) / xMax;
  const Y = (s) =>
    M.t + (H - M.t - M.b) * (1 - (s * 100 - yMin) / (yMax - yMin));
  const els = [];
  for (let g = yMin; g <= yMax; g += 2.5) {
    els.push(
      `<line x1="${M.l}" y1="${Y(g / 100)}" x2="${W - M.r}" y2="${Y(g / 100)}" stroke="${ink.grid}" stroke-width="1"/>`,
      `<text x="${M.l - 8}" y="${Y(g / 100) + 4}" text-anchor="end" fill="${ink.muted}" font-size="11">${g}%</text>`,
    );
  }
  for (let c = 0; c <= xMax; c += 2) {
    els.push(
      `<text x="${X(c)}" y="${H - M.b + 18}" text-anchor="middle" fill="${ink.muted}" font-size="11">$${c}</text>`,
    );
  }
  // label offsets tuned for collisions (terra/luna share x≈1.5)
  const off = {
    "gpt-5.6-terra": [0, 22],
    "gpt-5.6-luna": [-46, -12],
    "grok-4.5": [40, -12],
    "claude-sonnet-5": [0, 22],
    "gpt-5.6-sol": [0, -12],
    "claude-opus-5": [0, 22],
    "claude-fable-5": [0, -12],
  };
  for (const r of rows) {
    const c = VENDOR_COLOR[mode][r.vendor];
    const [dx, dy] = off[r.name] ?? [0, -12];
    els.push(
      `<circle cx="${X(r.cost)}" cy="${Y(r.composite)}" r="7" fill="${c}" stroke="${ink.ring}" stroke-width="2"/>`,
      `<text x="${X(r.cost) + dx}" y="${Y(r.composite) + dy}" text-anchor="middle" fill="${ink.text}" font-size="11.5">${r.name}</text>`,
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
<text x="${(M.l + W - M.r) / 2}" y="${H - 10}" text-anchor="middle" fill="${ink.text}" font-size="12.5">Build cost per app (USD, list price)</text>
<text transform="rotate(-90)" x="${-(M.t + (H - M.t - M.b) / 2)}" y="16" text-anchor="middle" fill="${ink.text}" font-size="12.5">Composite score (axis from ${yMin}%)</text>
</svg>`;
}
fs.writeFileSync(path.join(BENCH, "scatter-light.svg"), scatter("light"));
fs.writeFileSync(path.join(BENCH, "scatter-dark.svg"), scatter("dark"));

// ---- RESULTS.md ------------------------------------------------------------
const table = rows
  .map(
    (r) =>
      `| ${r.name} | ${r.minutes} min | $${r.cost.toFixed(2)} | ${r.cujP}/${r.cujT} | ${r.prP}/${r.prT} | ${r.judgeAvg.toFixed(2)} | **${(100 * r.composite).toFixed(1)}%** |`,
  )
  .join("\n");
const failDetail = rows
  .map(
    (r) =>
      `- **${r.name}**: ${r.fails.length ? r.fails.join(", ") : "clean sweep"}`,
  )
  .join("\n");

fs.writeFileSync(
  path.join(BENCH, "RESULTS.md"),
  `# App-Builder Benchmark — Results (Relay CRM column)

Run: 2026-07-29 · 7 models × 1 app (Relay CRM) × 3 milestones, N=1, Dyad
local-agent mode at product-default reasoning effort (medium, recorded per
request). Scored: 34 CUJs + 16 security probes per model (fixed Playwright
suites against pinned UI contracts) + LLM judge (gpt-5.6-sol, single judge,
input-capped). Costs are list-price dollars computed from exact per-request
token counts (cached/uncached/cache-write split) captured at the wire.

| Model | Build | Cost | CUJs | Security | Judge | Composite |
|---|---|---|---|---|---|---|
${table}

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="scatter-dark.svg">
  <img alt="Composite score vs build cost scatter; quality clusters between 90 and 93 percent while cost spans 1.46 to 12.86 dollars" src="scatter-light.svg">
</picture>

## Reading

- **Quality is a tight band (90–93%) while cost spans ~9×.** gpt-5.6-terra and
  gpt-5.6-luna deliver ≈97% of claude-fable-5's composite at ≈11% of its price.
- **terra built the app in 6 minutes** — 63 agent steps vs 120–260 for the
  others, same app size (~5k LOC) and equal CUJ pass rate: efficiency, not
  skipped work.
- **Every model passed all cross-tenant/role-escalation probes** except one
  luna miss (crm-m1-s02); server-side authorization held across the board.
- claude-sonnet-5 is the only model failing the sign-up-flow CUJ (crm-m1-01)
  at every checkpoint.

## Per-model failures

${failDetail}

## Caveats (disclosed by design)

- N=1 per cell; single app so far (Relay CRM; apps 2–3 are designed, not run).
- Judge is gpt-5.6-sol for all candidates (user decision; same-vendor bias
  toward the gpt-5.6 family — mitigated by judge weight of 15%).
- claude-sonnet-5 priced at intro rates (through 2026-08-31).
- Durations exclude infra stalls (verified: zero client-abort rows in all
  seven cells); luna's cell predates the headless code-explorer fix but never
  attempted deep context.
- Web tools enabled (product realism over reproducibility; web drift caveat).

Regenerate: \`node benchmarks/app-builder/report.mjs\` (reads results/).
`,
);
console.log("wrote RESULTS.md + scatter-light.svg + scatter-dark.svg");
console.log(
  rows.map((r) => `${r.name} ${(100 * r.composite).toFixed(1)}%`).join(" | "),
);
