import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceHash } from "./judge/evidence.mjs";
const cli = fileURLToPath(new URL("./promote-rescore.mjs", import.meta.url));
function setup(t) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "appbench-promote-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const scores = path.join(data, "audit"),
    dest = path.join(data, "results/s-score");
  fs.mkdirSync(scores);
  fs.mkdirSync(dest, { recursive: true });
  const task = {
      cell: "model-app",
      app: "relay-crm",
      m: 1,
      sha: "saved-sha",
      snapshotDb: "sim_saved",
      status: "complete",
    },
    manifest = { data, suiteHash: "suite", tasks: [task], unavailable: [] };
  const save = () =>
    fs.writeFileSync(
      path.join(scores, "manifest.json"),
      JSON.stringify(manifest),
    );
  save();
  const name = "model-app-ckpt1-a1.json";
  fs.writeFileSync(path.join(dest, name), "old score");
  fs.writeFileSync(
    path.join(scores, name),
    JSON.stringify({
      suiteHash: "suite",
      checkpointSha: "saved-sha",
      snapshotDb: "sim_saved",
      buildStatus: "ok",
      cujPassed: 2,
      cujRan: 2,
      cujTotal: 2,
      failures: [],
    }),
  );
  fs.writeFileSync(path.join(scores, "cuj-" + name), "{}");
  const run = (extra = []) =>
    execFileSync(
      process.execPath,
      [cli, "--data", data, "--scores", scores, ...extra],
      {
        stdio: "pipe",
      },
    );
  return { data, scores, dest, manifest, name, save, run };
}
test("promotion validates all tasks before changing canonical data", (t) => {
  const f = setup(t);
  f.manifest.tasks.push({
    ...f.manifest.tasks[0],
    cell: "pending-app",
    status: "pending",
  });
  f.save();
  assert.throws(f.run);
  assert.equal(fs.readFileSync(path.join(f.dest, f.name), "utf8"), "old score");
});
test("promotion preserves original artifacts and reports absent judges without manufacturing a zero", (t) => {
  const f = setup(t);
  f.run();
  assert.equal(
    fs.readFileSync(path.join(f.scores, "previous-canonical", f.name), "utf8"),
    "old score",
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.dest, f.name))).cujPassed,
    2,
  );
  const s = JSON.parse(
    fs.readFileSync(path.join(f.scores, "audit-summary.json")),
  );
  assert.equal(s.checkpoints[0].judgeScore, null);
  f.run();
  assert.equal(
    fs.readFileSync(path.join(f.scores, "previous-canonical", f.name), "utf8"),
    "old score",
  );
});

test("unavailable archives retire old harness scores without losing them", (t) => {
  const f = setup(t);
  f.manifest.unavailable.push({
    cell: "missing-app",
    m: 1,
    reason: "archived checkout missing",
  });
  f.save();
  const name = "missing-app-ckpt1-a1.json";
  fs.writeFileSync(path.join(f.dest, name), "historical score");
  f.run();
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.dest, name))).buildStatus,
    "checkpoint_unavailable",
  );
  assert.equal(
    fs.readFileSync(path.join(f.scores, "previous-canonical", name), "utf8"),
    "historical score",
  );
});

test("judge promotion rejects stale evidence before publishing any scores", (t) => {
  const f = setup(t),
    judges = path.join(f.data, "new-judges");
  fs.mkdirSync(judges);
  const score = JSON.parse(fs.readFileSync(path.join(f.scores, f.name)));
  const task = {
    cell: "model-app",
    m: 1,
    status: "refreshed",
    testResultsHash: evidenceHash(score),
  };
  fs.writeFileSync(
    path.join(judges, "manifest.json"),
    JSON.stringify({ data: f.data, scores: f.scores, tasks: [task] }),
  );
  const verdict = {
    judgeScore: 0.9,
    checkpointSha: "saved-sha",
    testResultsHash: "stale",
  };
  const file = path.join(judges, "model-app-m1.json");
  fs.writeFileSync(file, JSON.stringify(verdict));
  assert.throws(() => f.run(["--judges", judges]));
  assert.equal(fs.readFileSync(path.join(f.dest, f.name), "utf8"), "old score");
  verdict.testResultsHash = evidenceHash(score);
  fs.writeFileSync(file, JSON.stringify(verdict));
  f.run(["--judges", judges]);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.data, "results/judge/model-app-m1.json")),
    ).judgeScore,
    0.9,
  );
});
