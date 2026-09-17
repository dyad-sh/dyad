// Recompute recorded cell costs from the raw per-request token counts in
// proxy/logs, using the CURRENT pricing/pricing.json.
//
// Why this exists: the proxy prices each request as it happens and the eval
// stores the resulting per-milestone dollars in the cell summary. Those numbers
// are therefore frozen at the prices in force during the run — editing
// pricing.json afterwards changes nothing, and the report would keep publishing
// stale dollars with no indication anything was wrong.
//
// Milestone attribution: summaries record only durations, not absolute starts,
// so requests are clustered into milestones at the largest inter-request gaps
// (milestones are separated by build + snapshot + commit, which dwarfs the gap
// between two requests inside a turn). That heuristic is CHECKED, not assumed:
// re-pricing each cluster at the OLD rates must reproduce the recorded
// milestone costs. A cell that fails the check is reported and left alone.
//
//   node reprice.mjs            # report only
//   node reprice.mjs --write    # rewrite summaries that pass the check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const WRITE = process.argv.includes("--write");
const pricing = JSON.parse(
  fs.readFileSync(path.join(BENCH, "pricing", "pricing.json"), "utf8"),
);

function priceOf(model, usage, table) {
  // Longest match wins (same fix as the proxy): a model id that extends
  // another id must not inherit the shorter id's rates.
  const key = Object.keys(table)
    .filter((k) => model?.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return null;
  const p = table[key];
  const cached = usage.cachedTokens ?? 0;
  const writes = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, (usage.promptTokens ?? 0) - cached - writes);
  const tier =
    p.tiers && (usage.promptTokens ?? 0) >= p.tiers.threshold ? p.tiers : p;
  const writeRate = p.cacheWrite ?? tier.input;
  return (
    (uncached * tier.input + cached * tier.cachedInput + writes * writeRate) /
      1e6 +
    ((usage.completionTokens ?? 0) * tier.output) / 1e6
  );
}

// Old prices, reconstructed for the validation step: luna is the only model
// repriced so far, and this is what it was pinned at on 2026-07-28.
const OLD = JSON.parse(JSON.stringify(pricing.models));
OLD["gpt-5.6-luna"] = { input: 1, cachedInput: 0.1, output: 6 };

const logDir = path.join(BENCH, "proxy", "logs");
const cellDir = path.join(BENCH, "results", "s-cell");
const report = [];

for (const file of fs
  .readdirSync(logDir)
  // Canonical logs only. Model names contain dots (gpt-5.6-luna), so a dot
  // count cannot distinguish variants; historical copies are marked with an
  // UPPERCASE suffix (.RUN2, .SFORMS, .SLEEPWEDGE) and only those are skipped.
  .filter(
    (f) => f.endsWith(".jsonl") && !/\.[A-Z][A-Za-z0-9-]*\.jsonl$/.test(f),
  )) {
  const rows = [];
  for (const line of fs
    .readFileSync(path.join(logDir, file), "utf8")
    .split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.usage?.promptTokens != null) rows.push(r);
    } catch {
      /* partial line */
    }
  }
  if (!rows.length) continue;
  const cellId = rows[0].cellId;
  const sumPath = path.join(cellDir, `${cellId}.summary.json`);
  if (!fs.existsSync(sumPath)) continue;
  const summary = JSON.parse(fs.readFileSync(sumPath, "utf8"));
  if (summary.milestones.length !== 3) continue;

  rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  // split at the two largest gaps
  const gaps = rows
    .slice(1)
    .map((r, i) => ({
      i: i + 1,
      gap: Date.parse(r.ts) - Date.parse(rows[i].ts),
    }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 2)
    .map((g) => g.i)
    .sort((a, b) => a - b);
  const clusters = [
    rows.slice(0, gaps[0]),
    rows.slice(gaps[0], gaps[1]),
    rows.slice(gaps[1]),
  ];

  const sumOld = clusters.map((c) =>
    c.reduce((t, r) => t + (priceOf(r.model, r.usage, OLD) ?? 0), 0),
  );
  const sumNew = clusters.map((c) =>
    c.reduce((t, r) => t + (priceOf(r.model, r.usage, pricing.models) ?? 0), 0),
  );
  const recorded = summary.milestones.map((m) => m.estimatedUsd);
  const total = recorded.reduce((a, b) => a + b, 0) || 1;
  // Trust this log as a faithful record of this cell only if replaying ALL of
  // its requests at the OLD prices reproduces the recorded cell total. That is
  // what rejects the collision-merged logs from before run-cell.sh composed the
  // proxy log name the same way the eval composes the cell id: several cells
  // appended to one file, so replaying it yields wildly the wrong total.
  const oldAll = sumOld.reduce((a, b) => a + b, 0);
  const drift = Math.abs(oldAll - total) / total;
  const models = [...new Set(rows.map((r) => r.model))].join("+");
  const ok = drift <= 0.05;
  report.push({
    cellId,
    models,
    oldTotal: total,
    newTotal: sumNew.reduce((a, b) => a + b, 0),
    drift,
    ok,
  });
  if (ok && WRITE) {
    // Only the SUM is ever published, so scale the recorded per-milestone
    // shares to the recomputed total rather than trusting the clustering.
    const newAll = sumNew.reduce((a, b) => a + b, 0);
    summary.milestones.forEach((m, i) => {
      m.estimatedUsd = +((recorded[i] / total) * newAll).toFixed(4);
    });
    summary.repricedAt = new Date().toISOString();
    fs.writeFileSync(sumPath, JSON.stringify(summary, null, 2));
  }
}

report.sort((a, b) => a.cellId.localeCompare(b.cellId));
let changed = 0;
for (const r of report) {
  const delta = r.newTotal - r.oldTotal;
  if (Math.abs(delta) > 0.005) changed++;
  console.log(
    `${r.ok ? "ok  " : "SKIP"} ${r.cellId.padEnd(42)} $${r.oldTotal.toFixed(2)} -> $${r.newTotal.toFixed(2)}` +
      `${Math.abs(delta) > 0.005 ? `  (${delta > 0 ? "+" : ""}${delta.toFixed(2)})` : ""}` +
      `  [${r.models}]${r.ok ? "" : `  attribution drift ${(r.drift * 100).toFixed(0)}%`}`,
  );
}
console.log(
  `\n${report.length} cells, ${changed} with a cost change, ${report.filter((r) => !r.ok).length} skipped` +
    `${WRITE ? " (summaries rewritten)" : " (dry run — pass --write to apply)"}`,
);
