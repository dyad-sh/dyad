import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreArtifacts } from "./scoring.mjs";
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appbench-score-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cell = "model-app",
    cfg = {
      cujs: { 1: 1, 2: 1, 3: 1 },
      probes: { 1: 1, 2: 1, 3: 1 },
      isProbe: (id) => id.startsWith("S"),
    };
  const write = (kind, name, j) => {
    fs.mkdirSync(path.join(dir, "results", kind), { recursive: true });
    fs.writeFileSync(path.join(dir, "results", kind, name), JSON.stringify(j));
  };
  write("s-cell", cell + ".summary.json", {
    milestones: [1, 2, 3].map((m) => ({
      m,
      durationMs: 60000,
      estimatedUsd: 1,
    })),
    accountingAudit: { status: "verified" },
  });
  for (const n of [1, 2, 3]) {
    write("s-score", `${cell}-ckpt${n}-a1.json`, {
      buildStatus: "ok",
      cujPassed: 2,
      cujTotal: 2,
      cujRan: 2,
      failures: [],
    });
    write("judge", `${cell}-m${n}.json`, { judgeScore: 1 });
  }
  return {
    dir,
    cell,
    cfg,
    write,
    score: () => scoreArtifacts(dir, cell, "app", cfg),
  };
}
test("shared report/site scorer preserves weights, zeroes generated build failures", (t) => {
  const f = setup(t);
  assert.equal(f.score().composite, 1);
  f.write("s-score", f.cell + "-ckpt2-a1.json", {
    buildStatus: "build_failed",
  });
  assert.ok(Math.abs(f.score().composite - 2 / 3) < 1e-12);
});
test("infrastructure, incomplete coverage and invalid judges stay unscored", (t) => {
  const f = setup(t);
  for (const status of [
    "harness_error",
    "server_not_ready",
    "cuj_runner_failed",
    "install_failed",
  ]) {
    f.write("s-score", f.cell + "-ckpt2-a1.json", { buildStatus: status });
    assert.equal(f.score().composite, null);
  }
  f.write("s-score", f.cell + "-ckpt2-a1.json", {
    buildStatus: "ok",
    cujPassed: 2,
    cujTotal: 2,
    cujRan: 1,
    failures: [],
  });
  assert.equal(f.score().composite, null);
  f.write("s-score", f.cell + "-ckpt2-a1.json", {
    buildStatus: "ok",
    cujPassed: 2,
    cujTotal: 2,
    cujRan: 2,
    failures: [],
  });
  f.write("judge", f.cell + "-m2.json", {});
  assert.equal(f.score().composite, null);
});
test("partial accounting retains quality but disqualifies exact cost comparisons", (t) => {
  const f = setup(t);
  f.write("s-cell", f.cell + ".summary.json", {
    milestones: [{ durationMs: 60000, estimatedUsd: 3 }],
    accountingAudit: { status: "partial" },
  });
  const s = f.score();
  assert.equal(s.composite, 1);
  assert.equal(s.cost, 3);
  assert.equal(s.costVerified, false);
});
