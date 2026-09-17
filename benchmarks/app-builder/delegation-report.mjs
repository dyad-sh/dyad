// Quality + cost for the Implementer-delegation arms on relay-crm.
//
// Same composite as report.mjs (60% CUJ + 25% probes + 15% judge, and only when
// all three checkpoints scored), but grouped by ARM rather than by model, and it
// prints the per-arm spread. With n=2-3 per arm the spread is the whole story:
// a 3-point mean gap between arms whose own runs range over 5 points is noise.
//
//   node benchmarks/app-builder/delegation-report.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const R = (...p) => path.join(BENCH, "results", ...p);

const CFG = {
  cujs: { 1: 10, 2: 12, 3: 12 },
  probes: { 1: 2, 2: 6, 3: 8 },
  isProbe: (id) => /-s\d/.test(id),
};

// Arm -> cells. v3b is the V3 prompt re-run under the step-limit fix
// (partial accepted at join; Implementer budget 50 -> 100).
const ARMS = {
  "v1 (shipped prompt, 50-step impl)": [
    "auto-sidekick-relay-crm-dl-v1-r1",
    "auto-sidekick-relay-crm-dl-v1-r2",
    "auto-sidekick-relay-crm-dl-v1-r3",
  ],
  "v3 (delegate-by-default, 50-step impl)": [
    "auto-sidekick-relay-crm-dl-v3-r1",
    "auto-sidekick-relay-crm-dl-v3-r2",
    "auto-sidekick-relay-crm-dl-v3-r3",
  ],
  "v3b (delegate-by-default, 100-step impl)": [
    "auto-sidekick-relay-crm-dl-v3b-r1",
    "auto-sidekick-relay-crm-dl-v3b-r2",
    "auto-sidekick-relay-crm-dl-v3b-r3",
  ],
  "v3c/d luna + run_build (root+impl = luna)": [
    "gpt-5.6-luna-relay-crm-dl-v3c-r1",
    "gpt-5.6-luna-relay-crm-dl-v3d-r2",
    "gpt-5.6-luna-relay-crm-dl-v3d-r3",
  ],
  "v3c/d auto-sidekick + run_build": [
    "auto-sidekick-relay-crm-dl-v3c-r2",
    "auto-sidekick-relay-crm-dl-v3d-r1",
    "auto-sidekick-relay-crm-dl-v3d-r2",
  ],
  "v4 (assignment form, + run_build)": [
    "auto-sidekick-relay-crm-dl-v4-r1",
    "auto-sidekick-relay-crm-dl-v4-r2",
    "auto-sidekick-relay-crm-dl-v4-r3",
  ],
  // Reference, not an arm: no Implementer at all, so no delegation prompt
  // applies. Included because the whole question is whether delegating to a
  // cheap sub-agent beats just running the frontier model on its own.
  "reference: gpt-5.6-sol (no sub-agent)": ["gpt-5.6-sol-relay-crm"],
};

function spawnCounts(cell, m) {
  const f = R("s-cell", `${cell}.m${m}.messages.json`);
  if (!fs.existsSync(f)) return null;
  let msgs;
  try {
    msgs = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
  let implementer = 0;
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const name = n.toolName ?? n.tool_name;
    const input = n.input ?? n.args;
    if (
      name === "spawn_agent" &&
      input &&
      typeof input === "object" &&
      (input.persona ?? input.agentType) === "implementer"
    )
      implementer++;
    for (const v of Object.values(n)) walk(v);
  };
  walk(msgs);
  return implementer;
}

function scoreCell(cell) {
  const sumPath = R("s-cell", `${cell}.summary.json`);
  if (!fs.existsSync(sumPath)) return null;
  const sum = JSON.parse(fs.readFileSync(sumPath));
  const built = sum.milestones.length;
  const minutes = sum.milestones.reduce((a, m) => a + m.durationMs, 0) / 60000;
  const cost = sum.milestones.reduce((a, m) => a + m.estimatedUsd, 0);
  const errorEvents = sum.milestones.map((m) => m.errorEvents ?? 0);
  let spawns = 0;
  for (const m of sum.milestones) spawns += spawnCounts(cell, m.m) ?? 0;

  let cujP = 0,
    cujT = 0,
    prP = 0,
    prT = 0,
    judge = 0,
    scored = 0;
  for (const ck of [1, 2, 3]) {
    cujT += CFG.cujs[ck];
    prT += CFG.probes[ck];
    const f = R("s-score", `${cell}-ckpt${ck}-a1.json`);
    if (!fs.existsSync(f)) continue;
    scored++;
    const x = JSON.parse(fs.readFileSync(f));
    // harness_error = the SCORER broke (e.g. Playwright browser GC'd), not
    // the model. Zero-crediting it blames the model for the harness; treat the
    // checkpoint as unscored so the composite stays null until a rescore.
    if (x.buildStatus === "harness_error") {
      scored--;
      continue;
    }
    if (x.buildStatus !== "ok") continue;
    const probeFails = x.failures.filter(CFG.isProbe).length;
    cujP += CFG.cujs[ck] - (x.failures.length - probeFails);
    prP += CFG.probes[ck] - probeFails;
    const jf = R("judge", `${cell}-m${ck}.json`);
    if (fs.existsSync(jf)) judge += JSON.parse(fs.readFileSync(jf)).judgeScore;
  }
  const judgeAvg = scored ? judge / scored : 0;
  const composite =
    scored === 3
      ? 0.6 * (cujP / cujT) + 0.25 * (prP / prT) + 0.15 * judgeAvg
      : null;
  return {
    built,
    minutes,
    cost,
    composite,
    cujP,
    cujT,
    prP,
    prT,
    judgeAvg,
    scored,
    spawns,
    errorEvents,
  };
}

const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

console.log(
  "| arm | cell | built | composite | CUJ | probes | judge | cost | min | impl spawns |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|");
const byArm = {};
for (const [arm, cells] of Object.entries(ARMS)) {
  byArm[arm] = [];
  for (const cell of cells) {
    const s = scoreCell(cell);
    if (!s) {
      console.log(
        `| ${arm} | ${cell.replace(/^(auto-sidekick|gpt-5\.6-luna)-relay-crm-/, "$1 ")} | — not built — |`,
      );
      continue;
    }
    byArm[arm].push(s);
    console.log(
      `| ${arm} | ${cell.replace(/^(auto-sidekick|gpt-5\.6-luna)-relay-crm-/, "$1 ")} | ${s.built}/3 | ` +
        `${pct(s.composite)} | ${s.cujP}/${s.cujT} | ${s.prP}/${s.prT} | ` +
        `${s.judgeAvg.toFixed(2)} | $${s.cost.toFixed(2)} | ${s.minutes.toFixed(0)} | ${s.spawns} |`,
    );
  }
}

console.log(
  "\n### arm summary (complete cells only for quality; ALL cells for cost)",
);
console.log(
  "| arm | n built 3/3 | composite mean | composite range | cost mean (3/3 only) | cost range | aborted |",
);
console.log("|---|---|---|---|---|---|---|");
for (const [arm, cells] of Object.entries(byArm)) {
  const full = cells.filter((c) => c.composite != null);
  const comps = full.map((c) => c.composite);
  const costs = full.map((c) => c.cost);
  const aborted = cells.filter((c) => c.built < 3).length;
  console.log(
    `| ${arm} | ${full.length}/${cells.length} | ${pct(mean(comps))} | ` +
      `${comps.length ? `${pct(Math.min(...comps))}–${pct(Math.max(...comps))}` : "n/a"} | ` +
      `${costs.length ? `$${mean(costs).toFixed(2)}` : "n/a"} | ` +
      `${costs.length ? `$${Math.min(...costs).toFixed(2)}–$${Math.max(...costs).toFixed(2)}` : "n/a"} | ${aborted} |`,
  );
}
console.log(
  "\nCost mean uses only 3/3 cells: an aborted cell never paid for milestone 3,\n" +
    "so averaging it in would read as a cost saving rather than a missing milestone.",
);
