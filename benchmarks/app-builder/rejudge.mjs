// Refresh judgments whose automated evidence changed; watch a running rescore.
// Run through the protected Gateway environment, not a detached credential copy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { evidenceHash } from "./judge/evidence.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2),
  arg = (k) => {
    const i = args.indexOf(k);
    if (i < 0 || !args[i + 1]) throw Error("Required " + k);
    return path.resolve(args[i + 1]);
  };
const data = arg("--data"),
  scores = arg("--scores"),
  out = arg("--out");
if (out === path.join(data, "results/judge"))
  throw Error("Use an isolated judge output directory");
fs.mkdirSync(out, { recursive: true });
const lock = path.join(out, "runner.lock");
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock));
  try {
    process.kill(pid, 0);
    throw Error("Judge runner already active");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
process.on("exit", () => {
  if (
    fs.existsSync(lock) &&
    fs.readFileSync(lock, "utf8") === String(process.pid)
  )
    fs.unlinkSync(lock);
});
const manifestPath = path.join(out, "manifest.json");
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath))
  : {
      version: 1,
      data,
      scores,
      startedAt: new Date().toISOString(),
      tasks: [],
    };
if (manifest.data !== data || manifest.scores !== scores)
  throw Error("Judge manifest sources differ");
const save = () => {
  fs.writeFileSync(
    manifestPath + ".tmp",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  fs.renameSync(manifestPath + ".tmp", manifestPath);
};
const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : null);
const valid = (j) =>
  Number.isFinite(j?.judgeScore) &&
  j.judgeScore >= 0 &&
  j.judgeScore <= 1 &&
  j.judgePanel === "full";
for (const t of manifest.tasks)
  if (t.status === "running" || t.status === "blocked") t.status = "pending";
let fatal = null;
const running = new Set();
async function evaluate(t) {
  t.status = "running";
  save();
  try {
    const name = `${t.cell}-m${t.m}.json`,
      dest = path.join(out, name),
      existing = read(dest);
    if (
      !valid(existing) ||
      existing.testResultsHash !== t.testResultsHash ||
      existing.checkpointSha !== t.sha
    ) {
      const fd = fs.openSync(path.join(out, `${t.cell}-m${t.m}.log`), "a");
      const code = await new Promise((resolve, reject) => {
        const p = spawn(
          process.execPath,
          [
            path.join(here, "judge/judge.mjs"),
            "--cell",
            t.cell,
            "--milestone",
            String(t.m),
            "--data",
            data,
            "--scores",
            scores,
            "--out",
            out,
          ],
          { env: process.env, stdio: ["ignore", fd, fd] },
        );
        p.once("error", reject);
        p.once("exit", resolve);
      }).finally(() => fs.closeSync(fd));
      if (code !== 0)
        throw Error(
          `Judge failed for ${t.cell} m${t.m}; inspect its local log before retrying`,
        );
    }
    const j = read(dest);
    if (
      !valid(j) ||
      j.testResultsHash !== t.testResultsHash ||
      j.checkpointSha !== t.sha
    )
      throw Error("Invalid judge provenance " + name);
    Object.assign(t, {
      status: "refreshed",
      judgeScore: j.judgeScore,
      finishedAt: new Date().toISOString(),
    });
    delete t.error;
    console.log(
      JSON.stringify({
        cell: t.cell,
        m: t.m,
        status: t.status,
        judgeScore: j.judgeScore,
      }),
    );
  } catch (e) {
    t.status = "blocked";
    t.error = String(e);
    fatal = e;
  }
  save();
}
while (!fatal) {
  const m = read(path.join(scores, "manifest.json"));
  if (!m) throw Error("No rescore manifest");
  for (const task of m.tasks.filter((t) => t.status === "complete")) {
    const known = manifest.tasks.find(
      (t) => t.cell === task.cell && t.m === task.m,
    );
    if (known) continue;
    const current = read(
      path.join(scores, `${task.cell}-ckpt${task.m}-a1.json`),
    );
    const t = {
      cell: task.cell,
      m: task.m,
      sha: task.sha,
      testResultsHash: evidenceHash(current),
      status: "pending",
    };
    if (current.buildStatus !== "ok") t.status = "not_required";
    else {
      const original = read(
        path.join(
          data,
          "results/s-score",
          `${task.cell}-ckpt${task.m}-a1.json`,
        ),
      );
      const judge = read(
        path.join(data, "results/judge", `${task.cell}-m${task.m}.json`),
      );
      if (
        valid(judge) &&
        evidenceHash(original) === t.testResultsHash &&
        (judge.testResultsHash === t.testResultsHash ||
          Date.parse(judge.judgedAt) >= Date.parse(original?.scoredAt))
      ) {
        t.status = "preserved";
        t.judgeScore = judge.judgeScore;
      }
    }
    manifest.tasks.push(t);
  }
  save();
  for (const t of manifest.tasks.filter((t) => t.status === "pending")) {
    if (running.size >= 3) break;
    const promise = evaluate(t).finally(() => running.delete(promise));
    running.add(promise);
  }
  if (running.size) {
    await Promise.race(running);
    continue;
  }
  if (!fs.existsSync(path.join(scores, "runner.lock"))) {
    if (m.tasks.some((t) => t.status !== "complete"))
      throw Error(
        "Rescore has unfinished tasks; repair it before completing judges",
      );
    break;
  }
  await new Promise((r) => setTimeout(r, 30000));
}
await Promise.allSettled(running);
if (fatal) throw fatal;
manifest.finishedAt = new Date().toISOString();
save();
console.log(
  JSON.stringify({
    done: true,
    counts: manifest.tasks.reduce(
      (a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a),
      {},
    ),
  }),
);
