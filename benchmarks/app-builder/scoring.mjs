import fs from "node:fs";
import path from "node:path";
const infrastructure = new Set([
  "harness_error",
  "server_not_ready",
  "cuj_runner_failed",
  "install_failed",
]);

// Shared by the Markdown report and the site so invalid artifacts, accounting
// labels and weights cannot drift between the two published views.
export function scoreArtifacts(bench, cell, app, cfg) {
  const read = (kind, name) => {
    const p = path.join(bench, "results", kind, name);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
  };
  const sum = read("s-cell", cell + ".summary.json");
  if (!sum) return null;
  const minutes = Math.round(
      sum.milestones.reduce((a, m) => a + m.durationMs, 0) / 60000,
    ),
    cost = sum.milestones.reduce((a, m) => a + m.estimatedUsd, 0);
  const accountingStatus = sum.accountingAudit?.status ?? "legacy",
    costVerified =
      accountingStatus === "verified" || accountingStatus === "legacy";
  let cujP = 0,
    cujT = 0,
    prP = 0,
    prT = 0,
    judge = 0,
    scored = 0;
  const fails = [];
  for (const ck of [1, 2, 3]) {
    cujT += cfg.cujs[ck];
    prT += cfg.probes[ck];
    const x = read("s-score", `${cell}-ckpt${ck}-a1.json`);
    if (!x || infrastructure.has(x.buildStatus)) continue;
    if (x.buildStatus !== "ok") {
      if (!["build_failed", "server_error"].includes(x.buildStatus)) continue;
      scored++;
      fails.push(`${x.buildStatus}@${app}:ckpt${ck}`);
      continue;
    }
    const expected = cfg.cujs[ck] + cfg.probes[ck];
    if (
      x.cujTotal !== expected ||
      x.cujRan !== expected ||
      !Array.isArray(x.failures) ||
      new Set(x.failures).size !== x.failures.length ||
      x.cujPassed !== expected - x.failures.length
    )
      continue;
    const verdict = read("judge", `${cell}-m${ck}.json`);
    if (
      !Number.isFinite(verdict?.judgeScore) ||
      verdict.judgeScore < 0 ||
      verdict.judgeScore > 1
    )
      continue;
    const pf = x.failures.filter(cfg.isProbe).length;
    if (pf > cfg.probes[ck] || x.failures.length - pf > cfg.cujs[ck]) continue;
    scored++;
    cujP += cfg.cujs[ck] - (x.failures.length - pf);
    prP += cfg.probes[ck] - pf;
    judge += verdict.judgeScore;
    fails.push(...x.failures.map((id) => `${id}@${app}:ckpt${ck}`));
  }
  const judgeAvg = scored ? judge / scored : 0;
  return {
    minutes,
    cost,
    costVerified,
    accountingStatus,
    cujP,
    cujT,
    prP,
    prT,
    judgeAvg,
    composite:
      scored === 3
        ? (0.6 * cujP) / cujT + (0.25 * prP) / prT + 0.15 * judgeAvg
        : null,
    fails,
    scored,
  };
}
