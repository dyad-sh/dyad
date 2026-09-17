// Per-MILESTONE relationship between Implementer delegation and cost.
//
// The question: when the root agent delegates, does the main loop shrink
// (delegation substitutes for its own work) or grow (delegation is additive —
// composing an assignment, absorbing a report, re-reading files it did not
// write, all on a conversation already carrying ~107k tokens)?
//
// Milestone is the unit because spawn counts come from the per-milestone
// message logs and cost comes from the per-milestone spend-counter delta in the
// summary — both exact, neither needing the request-clustering heuristic that
// the repricing tool has to validate.
//
//   node analyze-delegation.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(BENCH, "results", "s-cell");

function spawnCounts(file) {
  let explorer = 0,
    implementer = 0;
  let msgs;
  try {
    msgs = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const name = n.toolName ?? n.tool_name;
    const input = n.input ?? n.args;
    if (name === "spawn_agent" && input && typeof input === "object") {
      (input.persona ?? input.agentType) === "implementer"
        ? implementer++
        : explorer++;
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(msgs);
  return { explorer, implementer };
}

const points = [];
for (const f of fs.readdirSync(dir)) {
  const m = f.match(/^(auto-sidekick-relay-crm[^.]*)\.summary\.json$/);
  if (!m) continue;
  const cell = m[1];
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  } catch {
    continue;
  }
  for (const ms of summary.milestones) {
    const counts = spawnCounts(
      path.join(dir, `${cell}.m${ms.m}.messages.json`),
    );
    if (!counts) continue;
    points.push({
      cell,
      m: ms.m,
      ...counts,
      usd: ms.estimatedUsd,
      min: ms.durationMs / 60000,
    });
  }
}

if (!points.length) {
  console.log("no data yet");
  process.exit(0);
}
points.sort((a, b) => a.cell.localeCompare(b.cell) || a.m - b.m);
console.log("| cell | m | explorer | implementer | cost | min |");
console.log("|---|---|---|---|---|---|");
for (const p of points)
  console.log(
    `| ${p.cell.replace("auto-sidekick-relay-crm", "…")} | ${p.m} | ${p.explorer} | **${p.implementer}** | $${p.usd.toFixed(2)} | ${p.min.toFixed(0)} |`,
  );

// Milestone number is a strong confounder: later milestones cost more AND
// delegate more, so a raw correlation would mostly measure milestone depth.
// Compare within each milestone instead.
console.log("\n### within-milestone comparison (controls for milestone depth)");
for (const m of [1, 2, 3]) {
  const g = points.filter((p) => p.m === m);
  if (g.length < 2) continue;
  const withImpl = g.filter((p) => p.implementer > 0);
  const without = g.filter((p) => p.implementer === 0);
  const mean = (a) =>
    a.length ? a.reduce((s, x) => s + x.usd, 0) / a.length : null;
  const a = mean(withImpl),
    b = mean(without);
  console.log(
    `  m${m}: n=${g.length}  with-implementer n=${withImpl.length}` +
      `${a != null ? ` mean $${a.toFixed(2)}` : ""}` +
      `  |  without n=${without.length}${b != null ? ` mean $${b.toFixed(2)}` : ""}` +
      `${a != null && b != null ? `  →  ${(((a - b) / b) * 100).toFixed(0)}%` : "  (need both groups)"}`,
  );
}

const n = points.length;
const xs = points.map((p) => p.implementer),
  ys = points.map((p) => p.usd);
const mx = xs.reduce((a, b) => a + b, 0) / n,
  my = ys.reduce((a, b) => a + b, 0) / n;
const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
const vx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
const vy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
console.log(
  `\npooled across all milestones (CONFOUNDED by milestone depth, shown for completeness):` +
    `\n  n=${n}  r=${vx && vy ? (cov / (vx * vy)).toFixed(2) : "n/a"}`,
);
