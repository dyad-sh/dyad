import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
const cli = fileURLToPath(new URL("./audit-accounting.mjs", import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "appbench-accounting-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cell = "gpt-6-sol-relay-crm",
    dir = path.join(root, "results/s-cell"),
    repo = path.join(dir, "checkouts", cell);
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(path.join(root, "proxy/logs"), { recursive: true });
  const git = (args) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-09-28T00:01:00Z",
        GIT_COMMITTER_DATE: "2026-09-28T00:01:00Z",
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
  git(["init"]);
  git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "checkpoint",
  ]);
  const sha = git(["rev-parse", "HEAD"]).trim();
  const summary = {
    cellId: cell,
    milestones: [{ m: 1, sha, estimatedUsd: 2.001 }],
  };
  const sum = path.join(dir, cell + ".summary.json");
  fs.writeFileSync(sum, JSON.stringify(summary));
  fs.writeFileSync(
    path.join(dir, cell + ".m1.messages.json"),
    JSON.stringify([
      { requestId: "turn-a", createdAt: "2026-09-28T00:00:00Z" },
    ]),
  );
  const row = {
    ts: "2026-09-28T00:00:01Z",
    dyadRequestId: "turn-a:attempt-1",
    path: "/responses",
    status: 200,
    model: "gpt-6-sol",
    requestBytes: 300,
    durationMs: 100,
    estimatedUsd: 2,
    usage: {
      promptTokens: 1000000,
      completionTokens: 0,
      cachedTokens: 0,
      raw: {
        input_tokens: 1000000,
        output_tokens: 0,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 500000 },
      },
    },
  };
  // Avoid the real long-context tier in this fixture: use multiple small requests.
  row.usage.promptTokens = 200000;
  row.usage.raw.input_tokens = 200000;
  row.usage.raw.input_tokens_details.cache_write_tokens = 100000;
  row.estimatedUsd = 0.4;
  const rows = Array.from({ length: 5 }, (_, i) => ({
    ...row,
    ts: `2026-09-28T00:00:0${i + 1}Z`,
    dyadRequestId: `turn-a:attempt-${i + 1}`,
  }));
  rows.push({
    ts: "2026-09-28T00:00:10Z",
    dyadRequestId: null,
    model: "gpt-5.6-luna",
    path: "/responses",
    status: 200,
    requestBytes: 80,
    durationMs: 10,
    estimatedUsd: 0.001,
    usage: { promptTokens: 5000, completionTokens: 0, cachedTokens: 0 },
  });
  rows.push({
    ...row,
    dyadRequestId: "another-run:attempt-1",
    estimatedUsd: 100,
  });
  const log = path.join(root, "proxy/logs/requests-shared.jsonl");
  const save = () =>
    fs.writeFileSync(log, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  save();
  const out = path.join(root, "audit");
  const run = (write = false) => {
    execFileSync(
      process.execPath,
      [cli, "--data", root, "--out", out, ...(write ? ["--write"] : [])],
      { stdio: "pipe" },
    );
    return JSON.parse(fs.readFileSync(path.join(out, "report.json"))).cells[0];
  };
  return { root, cell, sum, rows, save, run, out };
}

test("request-ID attribution excludes overlapping runs, includes side tasks, preserves backups and is idempotent", (t) => {
  const f = fixture(t),
    before = fs.readFileSync(f.sum, "utf8");
  const dry = f.run();
  assert.equal(dry.status, "verified");
  assert.equal(dry.corrected, 2.251);
  assert.equal(fs.readFileSync(f.sum, "utf8"), before);
  f.run(true);
  assert.equal(
    JSON.parse(fs.readFileSync(f.sum)).milestones[0].estimatedUsd,
    2.251,
  );
  assert.equal(
    fs.readFileSync(path.join(f.out, f.cell + ".summary.json.before"), "utf8"),
    before,
  );
  assert.equal(f.run(true).status, "verified");
  assert.equal(
    JSON.parse(fs.readFileSync(f.sum)).milestones[0].estimatedUsd,
    2.251,
  );
});

test("missing model usage is a labelled lower bound; tool requests are not token usage", (t) => {
  const f = fixture(t);
  f.rows.push({
    ...f.rows[0],
    dyadRequestId: "turn-a:attempt-99",
    usage: null,
    estimatedUsd: null,
  });
  f.rows.push({
    ts: "2026-09-28T00:00:10Z",
    dyadRequestId: "turn-a",
    path: "/tools/web-search",
    status: 200,
    usage: null,
  });
  f.save();
  assert.equal(f.run(true).status, "partial");
  const s = JSON.parse(fs.readFileSync(f.sum));
  assert.equal(s.milestones[0].estimatedUsd, 2.251);
  assert.equal(s.accountingAudit.status, "partial");
});

test("unknown model rates refuse correction rather than treating missing prices as zero", (t) => {
  const f = fixture(t);
  f.rows[0].model = "unpriced-model";
  f.save();
  assert.equal(f.run(true).status, "unverified");
  assert.equal(
    JSON.parse(fs.readFileSync(f.sum)).milestones[0].estimatedUsd,
    2.001,
  );
});
