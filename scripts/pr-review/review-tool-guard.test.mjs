import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { fileURLToPath } from "node:url";

const guardPath = fileURLToPath(
  new URL("./review-tool-guard.mjs", import.meta.url),
);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-tool-guard-"));
  fs.mkdirSync(path.join(root, "workspace"));
  const workspace = fs.realpathSync(path.join(root, "workspace"));
  const outside = path.join(root, "home", ".claude");
  const output = path.join(workspace, "tmp", "pr-review");
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(workspace, "src"));
  fs.mkdirSync(path.join(workspace, ".git"));
  fs.writeFileSync(
    path.join(workspace, "src", "example.ts"),
    "export const source = true;",
  );
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "Trusted instructions");
  fs.writeFileSync(path.join(workspace, ".git", "config"), "CANARY_CREDENTIAL");
  fs.writeFileSync(path.join(outside, "credentials.json"), "CANARY_CREDENTIAL");
  fs.writeFileSync(path.join(output, "claude-context.json"), "{}");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (tool, input) =>
    spawnSync(process.execPath, [guardPath, workspace], {
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: input,
      }),
      encoding: "utf8",
    });
  return { workspace, outside, output, run };
}

test("allows trusted source reads, scoped searches and both mandatory artifact writes", (t) => {
  const { workspace, output, run } = fixture(t);
  const requests = [
    ["Read", { file_path: path.join(workspace, "src", "example.ts") }],
    ["Read", { file_path: "AGENTS.md" }],
    ["Read", { file_path: path.join(output, "claude-context.json") }],
    ["Grep", { path: "src", pattern: "export" }],
    ["Glob", { path: "src", pattern: "**/*.ts" }],
    [
      "Write",
      { file_path: path.join(output, "claude-review.md"), content: "Review" },
    ],
    [
      "Write",
      { file_path: path.join(output, "claude-findings.json"), content: "{}" },
    ],
  ];
  for (const [tool, input] of requests) {
    const result = run(tool, input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  }
  fs.writeFileSync(path.join(output, "claude-review.md"), "Initial review");
  assert.equal(
    run("Edit", { file_path: path.join(output, "claude-review.md") }).status,
    0,
  );
});

test("blocks process, home, temp, Git metadata and traversal paths without exposing content", (t) => {
  const { workspace, outside, output, run } = fixture(t);
  const forbidden = [
    "/proc/self/environ",
    "/dev/fd/0",
    "/sys/kernel",
    outside,
    path.join(outside, "credentials.json"),
    path.join(workspace, ".git", "config"),
    path.join(workspace, "tmp", "settings.json"),
    path.join(output, "../settings.json"),
    path.join(workspace, "..", "home", ".claude", "credentials.json"),
  ];
  for (const filename of forbidden) {
    for (const tool of ["Read", "Grep", "Glob"]) {
      const input =
        tool === "Read"
          ? { file_path: filename }
          : { path: filename, pattern: "*" };
      const result = run(tool, input);
      assert.equal(result.status, 2, `${tool} ${filename}`);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("CANARY_CREDENTIAL"));
    }
  }
});

test("blocks implicit and explicit root-wide searches", (t) => {
  const { workspace, run } = fixture(t);
  for (const tool of ["Grep", "Glob"]) {
    for (const searchPath of [undefined, ".", workspace]) {
      assert.equal(run(tool, { path: searchPath, pattern: "*" }).status, 2);
    }
    for (const pattern of [
      "../../.git/config",
      "/proc/**",
      "C:\\secrets\\*",
      "**/../*",
    ]) {
      const input =
        tool === "Glob"
          ? { path: "src", pattern }
          : { path: "src", pattern: ".", glob: pattern };
      assert.equal(run(tool, input).status, 2);
    }
  }
});

test("blocks symlink reads and recursive searches that could cross the boundary", (t) => {
  const { workspace, outside, run } = fixture(t);
  const alias = path.join(workspace, "src", "linked");
  fs.symlinkSync(
    outside,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    run("Read", { file_path: path.join(alias, "credentials.json") }).status,
    2,
  );
  assert.equal(run("Grep", { path: "src", pattern: "CANARY" }).status, 2);
  assert.equal(run("Glob", { path: "src", pattern: "**/*" }).status, 2);
  assert.equal(run("Grep", { path: alias, pattern: "CANARY" }).status, 2);
});

test("blocks arbitrary edits, context changes, unknown tools and artifact symlinks", (t) => {
  const { workspace, outside, output, run } = fixture(t);
  for (const file_path of [
    "AGENTS.md",
    path.join(output, "claude-context.json"),
    path.join(outside, "credentials.json"),
  ]) {
    for (const tool of ["Edit", "Write"]) {
      assert.equal(run(tool, { file_path, content: "malicious" }).status, 2);
    }
  }
  for (const tool of ["Bash", "WebFetch", "mcp__github__get_file_contents"]) {
    assert.equal(run(tool, { path: "src" }).status, 2);
  }
  // A directory junction works on Windows without requiring symlink privileges.
  fs.rmSync(output, { recursive: true });
  fs.symlinkSync(
    outside,
    output,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    run("Write", { file_path: path.join(output, "claude-review.md") }).status,
    2,
  );
  fs.unlinkSync(output);
  fs.mkdirSync(output);
  if (process.platform !== "win32") {
    fs.symlinkSync(
      path.join(outside, "credentials.json"),
      path.join(output, "claude-review.md"),
    );
    assert.equal(
      run("Write", { file_path: path.join(output, "claude-review.md") }).status,
      2,
    );
  }
  assert.equal(
    fs.readFileSync(path.join(workspace, "AGENTS.md"), "utf8"),
    "Trusted instructions",
  );
});

test("rejects malformed input without echoing it", (t) => {
  const { workspace } = fixture(t);
  const result = spawnSync(process.execPath, [guardPath, workspace], {
    input: "CANARY_CREDENTIAL",
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.ok(!result.stderr.includes("CANARY_CREDENTIAL"));
});

// Exercise the exact command configured in the workflow, including its
// fail-closed shell fallback when Node cannot load the guard at all.
test(
  "configured hook blocks forbidden reads and missing guards",
  { skip: process.platform === "win32" },
  (t) => {
    const { workspace, outside } = fixture(t);
    const workflow = parse(
      fs.readFileSync(".github/workflows/claude-pr-review.yml", "utf8"),
    );
    const execution = parse(
      fs.readFileSync(workflow.jobs["run-review"].uses, "utf8"),
    );
    const agent = execution.jobs["claude-review"].steps.find(
      (step) => step.name === "PR Review",
    );
    const settings = JSON.parse(agent.with.settings);
    const command = settings.hooks.PreToolUse[0].hooks[0].command.replaceAll(
      "${{ github.workspace }}",
      workspace,
    );
    const installedGuard = path.join(
      workspace,
      "scripts",
      "pr-review",
      "review-tool-guard.mjs",
    );
    fs.mkdirSync(path.dirname(installedGuard), { recursive: true });
    fs.copyFileSync(guardPath, installedGuard);
    const request = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: path.join(outside, "credentials.json") },
    });
    const run = (input = request) =>
      spawnSync("bash", ["-c", command], { input, encoding: "utf8" });
    const allowedRequest = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: path.join(workspace, "src", "example.ts") },
    });
    const allowed = run(allowedRequest);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(run().status, 2);
    fs.unlinkSync(installedGuard);
    // The same allowed operation is blocked when the guard cannot load.
    assert.equal(run(allowedRequest).status, 2);
  },
);

test(
  "denies dangling artifact symlinks and directory reads",
  { skip: process.platform === "win32" },
  (t) => {
    const { workspace, output, outside, run } = fixture(t);
    fs.symlinkSync(
      path.join(outside, "missing.json"),
      path.join(output, "claude-findings.json"),
    );
    assert.equal(
      run("Write", { file_path: path.join(output, "claude-findings.json") })
        .status,
      2,
    );
    assert.equal(run("Read", { file_path: workspace }).status, 2);
  },
);
