import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./symbolicate-dump.mjs", import.meta.url),
);

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "symbolicate-dump-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preload = path.join(root, "mock-stackwalk.cjs");
  // Keep the real CLI argument parsing and file handling; replace only the
  // external stackwalker so tests need neither native tools nor symbol downloads.
  fs.writeFileSync(
    preload,
    `const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
require("node:os").homedir = () => process.env.XDG_CACHE_HOME;
childProcess.spawnSync = (binary, args, options) => {
  if (args[0] === "--version") return { status: 0 };
  if (args.length === 2 && args[0] === "--json") {
    return { status: 0, stdout: '{"modules":[]}' };
  }
  if (args.includes("--dump-file")) throw new Error("flag leaked to stackwalk");
  const dump = path.basename(args.at(-1));
  const output = "Stack for " + dump + "\\n";
  fs.writeSync(options.stdio === "inherit" ? 1 : options.stdio[1], output);
  fs.writeSync(2, "stackwalk diagnostic\\n");
  return { status: dump === "failed.dmp" ? 2 : 0 };
};
require("node:module").syncBuiltinESMExports();
`,
  );
  return {
    root,
    dump(name) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "fake dump");
      return file;
    },
    run(args) {
      return spawnSync(
        process.execPath,
        ["--require", preload, script, ...args],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            LOCALAPPDATA: root,
            XDG_CACHE_HOME: root,
          },
        },
      );
    },
  };
}

test("--dump-file writes each report beside its dump and overwrites old output", (t) => {
  const fixture = setup(t);
  const first = fixture.dump("directory with spaces/first.dmp");
  const second = fixture.dump("second.dmp");
  const report = first.replace(/\.dmp$/, ".txt");
  fs.writeFileSync(report, "old output that should be replaced completely");
  const result = fixture.run(["--dump-file", first, second]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(report, "utf8"), "Stack for first.dmp\n");
  assert.equal(
    fs.readFileSync(second.replace(/\.dmp$/, ".txt"), "utf8"),
    "Stack for second.dmp\n",
  );
  assert.match(result.stderr, /Saved symbolicated dump to/);
  assert.match(result.stderr, /stackwalk diagnostic/);
  assert.doesNotMatch(result.stdout, /Stack for/);
});

test("without --dump-file the report stays on stdout", (t) => {
  const fixture = setup(t);
  const dump = fixture.dump("crash.dmp");
  const result = fixture.run([dump]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Stack for crash.dmp\n");
  assert.equal(fs.existsSync(path.join(fixture.root, "crash.txt")), false);
});

test("--dump-file works with an automatically selected dev dump", (t) => {
  const fixture = setup(t);
  const dump = fixture.dump("userData/dyad-crash-reports/auto.dmp");
  const result = fixture.run(["--dump-file"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(dump.replace(/\.dmp$/, ".txt"), "utf8"),
    "Stack for auto.dmp\n",
  );
});

test("--dump-file preserves failure status and continues processing dumps", (t) => {
  const fixture = setup(t);
  const result = fixture.run([
    "--dump-file",
    fixture.dump("failed.dmp"),
    fixture.dump("success.dmp"),
  ]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "success.txt"), "utf8"),
    "Stack for success.dmp\n",
  );
  assert.doesNotMatch(result.stderr, /Saved symbolicated dump to .*failed.txt/);
});

test("an unwritable report path fails and later dumps still run", (t) => {
  const fixture = setup(t);
  fs.mkdirSync(path.join(fixture.root, "blocked.txt"));
  const result = fixture.run([
    "--dump-file",
    fixture.dump("blocked.dmp"),
    fixture.dump("success.dmp"),
  ]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Cannot write output/);
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "success.txt"), "utf8"),
    "Stack for success.dmp\n",
  );
});
