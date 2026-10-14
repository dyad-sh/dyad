// Rescore immutable saved checkpoints, never regenerate model output or judges.
// node rescore.mjs --data /path/to/app-builder --out /new/audit/directory --jobs 3
// Resume the same command after interruption. A changed suite requires a new out.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i < 0 ? d : args[i + 1];
};
const data = path.resolve(arg("--data", here)),
  out = path.resolve(arg("--out", ""));
if (
  !args.includes("--out") ||
  out === data ||
  out === path.join(data, "results/s-score")
)
  throw Error("Specify a separate audit output directory");
const jobs = Number(arg("--jobs", "1"));
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 6)
  throw Error("--jobs must be 1..6");
const apps = [
  "relay-crm",
  "deskhero",
  "portalis",
  "ledgerly",
  "slotline",
  "curbside",
];
const infra = new Set([
  "harness_error",
  "server_not_ready",
  "cuj_runner_failed",
  "install_failed",
]);
function sourceFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      ["node_modules", "results", "test-results", "harness"].includes(e.name)
        ? []
        : e.isDirectory()
          ? sourceFiles(path.join(dir, e.name))
          : /\.(ts|mjs|sh)$/.test(e.name)
            ? [path.join(dir, e.name)]
            : [],
    );
}
const hash = createHash("sha256");
for (const f of sourceFiles(path.join(here, "cuj-tests")).sort()) {
  hash.update(path.relative(here, f));
  hash.update(fs.readFileSync(f));
}
const suiteHash = hash.digest("hex");
fs.mkdirSync(out, { recursive: true });
const lockPath = path.join(out, "runner.lock");
if (fs.existsSync(lockPath)) {
  const owner = Number(fs.readFileSync(lockPath, "utf8"));
  let alive = false;
  try {
    process.kill(owner, 0);
    alive = true;
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  if (alive) throw Error("Another runner owns this output directory");
  fs.unlinkSync(lockPath);
}
fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
process.on("exit", () => {
  if (
    fs.existsSync(lockPath) &&
    fs.readFileSync(lockPath, "utf8") === String(process.pid)
  )
    fs.unlinkSync(lockPath);
});
const manifestPath = path.join(out, "manifest.json");
let manifest;
if (fs.existsSync(manifestPath)) {
  manifest = JSON.parse(fs.readFileSync(manifestPath));
  if (manifest.suiteHash !== suiteHash || manifest.data !== data)
    throw Error("Suite or data changed; use a new audit directory");
} else {
  if (fs.readdirSync(out).some((name) => name !== "runner.lock"))
    throw Error("New audit output directory must be empty");
  const dbs = new Set(
    execFileSync(
      "psql",
      ["-d", "postgres", "-Atc", "SELECT datname FROM pg_database"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n"),
  );
  manifest = {
    version: 1,
    startedAt: new Date().toISOString(),
    data,
    suiteHash,
    judges: "handled separately by rejudge.mjs",
    tasks: [],
    unavailable: [],
  };
  for (const f of fs
    .readdirSync(path.join(data, "results/s-cell"))
    .filter((f) => f.endsWith(".summary.json"))
    .sort()) {
    const summary = JSON.parse(
        fs.readFileSync(path.join(data, "results/s-cell", f)),
      ),
      cell = summary.cellId;
    if (!/^[a-zA-Z0-9_.-]+$/.test(cell)) throw Error("Unsafe cell ID");
    const app = apps.find((a) => cell.includes(a)),
      checkout = path.join(data, "results/s-cell/checkouts", cell);
    for (const m of summary.milestones) {
      if (![1, 2, 3].includes(m.m)) throw Error("Invalid milestone number");
      let reason;
      if (!app) reason = "unknown app";
      else if (!m.snapshotDb) reason = "no snapshot";
      else if (!dbs.has(m.snapshotDb)) reason = "snapshot database missing";
      else if (!fs.existsSync(path.join(checkout, ".git")))
        reason = "archived checkout missing";
      let sha;
      if (!reason) {
        try {
          sha = execFileSync(
            "git",
            ["-C", checkout, "rev-parse", `checkpoint-m${m.m}^{commit}`],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
          ).trim();
          if (sha !== m.sha) reason = "checkpoint tag differs from summary SHA";
        } catch {
          reason = "checkpoint tag missing";
        }
      }
      if (reason) {
        manifest.unavailable.push({ cell, m: m.m, reason });
        continue;
      }
      manifest.tasks.push({
        cell,
        app,
        m: m.m,
        sha,
        snapshotDb: m.snapshotDb,
        status: "pending",
      });
    }
  }
  // Put the latest regression reproductions first, then retain deterministic order.
  manifest.tasks.sort(
    (a, b) =>
      Number(b.cell.startsWith("gpt-6.1-sol")) -
        Number(a.cell.startsWith("gpt-6.1-sol")) ||
      a.cell.localeCompare(b.cell) ||
      a.m - b.m,
  );
}
const save = () => {
  fs.writeFileSync(
    manifestPath + ".tmp",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  fs.renameSync(manifestPath + ".tmp", manifestPath);
};
save();
const run = (cmd, argv, cwd, env, log) =>
  new Promise((resolve, reject) => {
    const fd = fs.openSync(log, "a");
    const p = spawn(cmd, argv, { cwd, env, stdio: ["ignore", fd, fd] });
    p.once("error", (e) => {
      fs.closeSync(fd);
      reject(e);
    });
    p.once("exit", (code, signal) => {
      fs.closeSync(fd);
      resolve({ code, signal });
    });
  });
async function sim(action, body) {
  const r = await fetch("http://127.0.0.1:7788/__sim/" + action, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Error(`${action}: ${await r.text()}`);
  return r.json();
}
const queue = manifest.tasks.filter((t) => t.status !== "complete");
let index = 0;
console.log(
  JSON.stringify({
    total: manifest.tasks.length,
    pending: queue.length,
    unavailable: manifest.unavailable.length,
    suiteHash,
  }),
);
await Promise.all(
  Array.from({ length: jobs }, (_, worker) =>
    (async () => {
      while (index < queue.length) {
        const t = queue[index++],
          key = `${t.cell}-ckpt${t.m}-a1`,
          score = path.join(out, key + ".json"),
          dir = path.join(out, "work-" + worker),
          label =
            "sim_audit_" +
            createHash("sha256")
              .update(out + key)
              .digest("hex")
              .slice(0, 24);
        t.status = "running";
        save();
        try {
          for (let attempt = 1; attempt <= 2; attempt++) {
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true }); // only this runner's disposable work directory
            // A prior interrupted attempt may have left its disposable clone behind.
            await sim("release", { label });
            const clone = await sim("clone", { snapshot: t.snapshotDb, label });
            try {
              execFileSync("git", [
                "clone",
                "--quiet",
                path.join(data, "results/s-cell/checkouts", t.cell),
                dir,
              ]);
              execFileSync("git", ["-C", dir, "checkout", "--quiet", t.sha]);
              if (fs.existsSync(score)) {
                for (const prefix of ["", "cuj-", "build-"]) {
                  const p = path.join(
                    out,
                    prefix + key + (prefix === "build-" ? ".log" : ".json"),
                  );
                  if (fs.existsSync(p))
                    fs.renameSync(
                      p,
                      p + ".attempt-" + (attempt - 1) + "-" + Date.now(),
                    );
                }
              }
              const env = {
                ...process.env,
                PLAYWRIGHT_SKIP_BROWSER_GC: "1",
                APP_DIR: dir,
                SCORE_OUT: score,
                SPEC: t.app + `/checkpoint-${t.m}.spec.ts`,
                APP_PORT: String(3400 + worker),
                DATABASE_URL: clone.connection_uri,
                NEON_AUTH_BASE_URL: clone.auth_base_url,
                NEON_AUTH_COOKIE_SECRET:
                  "local-audit-" +
                  createHash("sha256").update(key).digest("hex"),
                NODE_EXTRA_CA_CERTS:
                  process.env.APPBENCH_CA_BUNDLE ||
                  path.join(data, "neon-sim/certs/ca.pem"),
              };
              const processResult = await run(
                "bash",
                [path.join(here, "cuj-tests/score-checkpoint.sh")],
                here,
                env,
                path.join(out, "worker-" + worker + ".log"),
              );
              if (processResult.code !== 0 || !fs.existsSync(score))
                throw Error("Scorer failed: " + JSON.stringify(processResult));
              const result = JSON.parse(fs.readFileSync(score));
              if (infra.has(result.buildStatus)) {
                if (attempt === 1) continue;
                throw Error("Infrastructure failure: " + result.buildStatus);
              }
              if (
                result.buildStatus === "ok" &&
                (!result.cujTotal || result.cujRan !== result.cujTotal)
              )
                throw Error("Incomplete test coverage");
              Object.assign(result, {
                suiteHash,
                checkpointSha: t.sha,
                snapshotDb: t.snapshotDb,
              });
              fs.writeFileSync(score, JSON.stringify(result, null, 2) + "\n");
              Object.assign(t, {
                status: "complete",
                result: {
                  buildStatus: result.buildStatus,
                  passed: result.cujPassed,
                  total: result.cujTotal,
                },
                finishedAt: new Date().toISOString(),
              });
              delete t.error;
              delete t.unchangedTestsFromSuite;
              break;
            } finally {
              await sim("release", { label });
              if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
            }
          }
        } catch (e) {
          t.status = "blocked";
          t.error = String(e);
        }
        save();
        console.log(
          JSON.stringify({
            done: manifest.tasks.filter((t) => t.status === "complete").length,
            total: manifest.tasks.length,
            cell: t.cell,
            m: t.m,
            status: t.status,
            result: t.result,
            error: t.error,
          }),
        );
      }
    })(),
  ),
);
manifest.finishedAt = new Date().toISOString();
save();
process.exitCode = manifest.tasks.every((t) => t.status === "complete") ? 0 : 1;
