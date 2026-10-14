import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceHash } from "./evidence.mjs";

test("judge uses isolated repaired evidence and records its source hash without replacing old verdicts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-judge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cell = "model-relay-crm",
    repo = path.join(root, "results/s-cell/checkouts", cell),
    scores = path.join(root, "repaired"),
    out = path.join(root, "judged");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(scores);
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" })
      .toString()
      .trim();
  git("init", "--quiet");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(
    path.join(repo, "src/page.tsx"),
    "export default function Page(){return null}\n",
  );
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture");
  git("tag", "checkpoint-m1");
  const score = {
    buildStatus: "ok",
    cujPassed: 12,
    cujTotal: 12,
    failures: [],
  };
  fs.writeFileSync(
    path.join(scores, cell + "-ckpt1-a1.json"),
    JSON.stringify(score),
  );
  fs.mkdirSync(path.join(root, "results/judge"));
  fs.writeFileSync(
    path.join(root, "results/judge", cell + "-m1.json"),
    "original",
  );
  let prompt;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      prompt = JSON.parse(body);
      res.setHeader("content-type", "text/event-stream");
      res.end(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: JSON.stringify({
                    bugs: 9,
                    security: 8,
                    code_quality: 8,
                    schema_quality: 9,
                    rationale: "fixture",
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              prompt_tokens_details: { cached_tokens: 20 },
            },
          }) +
          "\n\ndata: [DONE]\n\n",
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const cli = fileURLToPath(new URL("./judge.mjs", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      cli,
      "--cell",
      cell,
      "--milestone",
      "1",
      "--data",
      root,
      "--scores",
      scores,
      "--out",
      out,
    ],
    {
      env: {
        ...process.env,
        DYAD_PRO_KEY: "local-test-placeholder",
        DYAD_PRO_API_KEY: "",
        DYAD_ENGINE_URL: "http://127.0.0.1:" + server.address().port,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (c) => (logs += c));
  child.stderr.on("data", (c) => (logs += c));
  const code = await new Promise((r) => child.once("exit", r));
  assert.equal(code, 0, logs);
  assert.match(prompt.messages[1].content, /"cujPassed": 12/);
  const verdict = JSON.parse(
    fs.readFileSync(path.join(out, cell + "-m1.json")),
  );
  assert.equal(verdict.judgeScore, 0.85);
  assert.equal(verdict.testResultsHash, evidenceHash(score));
  assert.equal(verdict.checkpointSha, git("rev-parse", "HEAD"));
  assert.equal(
    fs.readFileSync(
      path.join(root, "results/judge", cell + "-m1.json"),
      "utf8",
    ),
    "original",
  );
});
