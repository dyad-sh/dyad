// Validate the entire rescore before replacing any canonical score artifacts.
// node promote-rescore.mjs --data /path/to/app-builder --scores /audit/rescore
// Produces a portable audit-summary.json; preserves previous artifacts locally.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { evidenceHash } from "./judge/evidence.mjs";
const args = process.argv.slice(2),
  arg = (k) => {
    const i = args.indexOf(k);
    if (i < 0 || !args[i + 1]) throw Error("Required " + k);
    return path.resolve(args[i + 1]);
  };
const data = arg("--data"),
  scores = arg("--scores"),
  manifest = JSON.parse(fs.readFileSync(path.join(scores, "manifest.json"))),
  here = path.dirname(fileURLToPath(import.meta.url));
if (
  manifest.data !== data ||
  manifest.tasks.some((t) => t.status !== "complete")
)
  throw Error("Rescore incomplete or data root differs");
if (fs.existsSync(path.join(scores, "runner.lock")))
  throw Error("Scorer still owns the output directory");
const judges = args.includes("--judges") ? arg("--judges") : null;
const judgeManifest = judges
  ? JSON.parse(fs.readFileSync(path.join(judges, "manifest.json")))
  : null;
if (
  judges &&
  (fs.existsSync(path.join(judges, "runner.lock")) ||
    judgeManifest.data !== data ||
    judgeManifest.scores !== scores ||
    judgeManifest.tasks.some(
      (t) => !["refreshed", "preserved", "not_required"].includes(t.status),
    ))
)
  throw Error("Judge refresh incomplete or sources differ");
const backup = path.join(scores, "previous-canonical"),
  dest = path.join(data, "results/s-score"),
  copies = [],
  judgeCopies = [],
  summary = {
    version: 1,
    suiteHash: manifest.suiteHash,
    finishedAt: manifest.finishedAt,
    checkpoints: [],
    unavailable: manifest.unavailable,
  };
for (const t of manifest.tasks) {
  const key = `${t.cell}-ckpt${t.m}-a1`,
    file = path.join(scores, key + ".json"),
    s = JSON.parse(fs.readFileSync(file));
  if (
    s.suiteHash !== manifest.suiteHash ||
    s.checkpointSha !== t.sha ||
    s.snapshotDb !== t.snapshotDb
  )
    throw Error("Provenance mismatch " + key);
  if (!["ok", "build_failed", "server_error"].includes(s.buildStatus))
    throw Error("Unscored infrastructure failure " + key);
  if (
    s.buildStatus === "ok" &&
    (!s.cujTotal ||
      s.cujRan !== s.cujTotal ||
      s.cujPassed + s.failures.length !== s.cujTotal)
  )
    throw Error("Incomplete coverage " + key);
  const judgeTask = judgeManifest?.tasks.find(
    (j) => j.cell === t.cell && j.m === t.m,
  );
  if (judges && (!judgeTask || judgeTask.testResultsHash !== evidenceHash(s)))
    throw Error("Judge evidence mismatch " + key);
  const judgeName = `${t.cell}-m${t.m}.json`;
  const judgePath =
    judgeTask?.status === "refreshed"
      ? path.join(judges, judgeName)
      : path.join(data, "results/judge", judgeName);
  const verdict = fs.existsSync(judgePath)
    ? JSON.parse(fs.readFileSync(judgePath))
    : null;
  const judgeValid =
    Number.isFinite(verdict?.judgeScore) &&
    verdict.judgeScore >= 0 &&
    verdict.judgeScore <= 1;
  if (
    judges &&
    s.buildStatus === "ok" &&
    (!judgeValid || !["refreshed", "preserved"].includes(judgeTask.status))
  )
    throw Error("Missing judge " + key);
  if (judgeTask?.status === "refreshed") {
    if (
      verdict.testResultsHash !== evidenceHash(s) ||
      verdict.checkpointSha !== t.sha
    )
      throw Error("Refreshed judge provenance mismatch " + key);
    judgeCopies.push({ source: judgePath, name: judgeName });
  }
  summary.checkpoints.push({
    cell: t.cell,
    app: t.app,
    m: t.m,
    sha: t.sha,
    buildStatus: s.buildStatus,
    passed: s.cujPassed,
    total: s.cujTotal,
    failures: s.failures,
    judgeScore: judgeValid ? verdict.judgeScore : null,
    judgeStatus: judgeTask?.status ?? "historical",
    judgeHash: judgeValid
      ? createHash("sha256").update(fs.readFileSync(judgePath)).digest("hex")
      : null,
    scoreHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    unchangedTestsFromSuite: s.unchangedTestsFromSuite ?? null,
  });
  for (const [prefix, extension] of [
    ["", ".json"],
    ["cuj-", ".json"],
    ["build-", ".log"],
  ]) {
    const name = prefix + key + extension,
      source = path.join(scores, name);
    if (fs.existsSync(source)) copies.push({ source, name });
    else if (prefix === "cuj-" && s.buildStatus === "ok")
      throw Error("Missing raw Playwright report " + key);
  }
}
fs.mkdirSync(backup, { recursive: true });
fs.mkdirSync(dest, { recursive: true });
fs.mkdirSync(path.join(data, "results/judge"), { recursive: true });
// An old score without its saved source cannot be reevaluated. Preserve it in
// the backup, but do not silently mix the previous harness into the new tables.
const unavailable = manifest.unavailable.filter(
  (t) => t.reason !== "unknown app",
);
for (const t of unavailable) {
  const name = `${t.cell}-ckpt${t.m}-a1.json`;
  const old = path.join(dest, name),
    saved = path.join(backup, name);
  if (fs.existsSync(old) && !fs.existsSync(saved))
    fs.copyFileSync(old, saved, fs.constants.COPYFILE_EXCL);
}
// Backup first, then write through temporary sibling files. The static site is
// regenerated only after this command exits, never from half-promoted data.
for (const { name } of copies) {
  const old = path.join(dest, name),
    saved = path.join(backup, name);
  if (fs.existsSync(old) && !fs.existsSync(saved))
    fs.copyFileSync(old, saved, fs.constants.COPYFILE_EXCL);
}
for (const { source, name } of copies) {
  const target = path.join(dest, name);
  fs.copyFileSync(source, target + ".promoting");
  fs.renameSync(target + ".promoting", target);
}
for (const { source, name } of judgeCopies) {
  const target = path.join(data, "results/judge", name);
  const saved = path.join(backup, "judge", name);
  fs.mkdirSync(path.dirname(saved), { recursive: true });
  if (fs.existsSync(target) && !fs.existsSync(saved))
    fs.copyFileSync(target, saved, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(source, target + ".promoting");
  fs.renameSync(target + ".promoting", target);
}
for (const t of unavailable) {
  const target = path.join(dest, `${t.cell}-ckpt${t.m}-a1.json`);
  fs.writeFileSync(
    target + ".promoting",
    JSON.stringify(
      {
        buildStatus: "checkpoint_unavailable",
        reason: t.reason,
        suiteHash: manifest.suiteHash,
        scoredAt: manifest.finishedAt,
      },
      null,
      2,
    ) + "\n",
  );
  fs.renameSync(target + ".promoting", target);
}
fs.writeFileSync(
  path.join(scores, "audit-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    promoted: summary.checkpoints.length,
    refreshedJudges: judgeCopies.length,
    unavailable: unavailable.length,
    missingJudges: summary.checkpoints.filter(
      (c) => c.buildStatus === "ok" && c.judgeScore === null,
    ).length,
    summary: path.join(scores, "audit-summary.json"),
    source: here,
  }),
);
