// LLM-judge pipeline for the app-builder benchmark (DESIGN.md §2 "Judge").
//
// Usage:
//   node judge.mjs --cell <cellId> --milestone <m> [--judges id1,id2]
//
// Scores one checkpoint with the fixed single judge (gpt-5.6-sol; --judges
// overrides for testing). Writes results/judge/<cellId>-m<m>.json.
//
// Env: DYAD_PRO_KEY (or DYAD_PRO_API_KEY); DYAD_ENGINE_URL optional (defaults
// to the real engine — deliberately NOT the recording proxy, so judge tokens
// never pollute a cell's cost attribution).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(__dirname, "..");
const ENGINE =
  process.env.DYAD_ENGINE_URL?.replace(/\/$/, "") ??
  "https://engine.dyad.sh/v1";
const KEY = process.env.DYAD_PRO_API_KEY || process.env.DYAD_PRO_KEY;
if (!KEY) throw new Error("DYAD_PRO_KEY required");

const DIFF_CAP = 40_000;
const FILES_CAP = 20_000;
const TREE_CAP = 2_000;

const args = process.argv.slice(2);
const argOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const CELL = argOf("--cell");
const M = Number(argOf("--milestone"));
if (!CELL || !M) throw new Error("--cell and --milestone required");

// Single fixed judge for every candidate (user decision 2026-07-29,
// superseding the cross-vendor pair design). Same-vendor bias toward the
// gpt-5.6 candidates is a disclosed caveat in the report.
const DEFAULT_JUDGE = "gpt-5.6-sol";
function judgesFor(_cellId) {
  const override = argOf("--judges");
  if (override) return override.split(",");
  return [DEFAULT_JUDGE];
}

// ---- input assembly -------------------------------------------------------
const checkout = path.join(BENCH, "results", "s-cell", "checkouts", CELL);
if (!fs.existsSync(checkout)) throw new Error(`no checkout at ${checkout}`);
const git = (...a) =>
  execFileSync("git", ["-C", checkout, ...a], { encoding: "utf8" });

function baseRef() {
  if (M > 1) return `checkpoint-m${M - 1}`;
  const marker = git(
    "log",
    "--grep=^appbench: env + lockfile",
    "--format=%H",
    "-n",
    "1",
  ).trim();
  if (marker) return marker;
  return git("rev-list", "--max-parents=0", "HEAD").trim().split("\n")[0];
}
const BASE = baseRef();
const HEAD = `checkpoint-m${M}`;

const PRIORITY = [
  /^src\/app\/api\//,
  /^src\/db\//,
  /auth/i,
  /middleware/,
  /^src\/lib\//,
  /^src\/app\//,
];
const rank = (f) => {
  const i = PRIORITY.findIndex((re) => re.test(f));
  return i === -1 ? PRIORITY.length : i;
};

function cappedDiff() {
  const files = git("diff", "--name-only", `${BASE}..${HEAD}`)
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((f) => !/pnpm-lock|package-lock|\.png$|\.ico$|\.svg$/.test(f))
    .sort((a, b) => rank(a) - rank(b));
  let out = "";
  let dropped = 0;
  for (const f of files) {
    const d = git("diff", `${BASE}..${HEAD}`, "--", f);
    if (out.length + d.length > DIFF_CAP) {
      dropped++;
      continue;
    }
    out += d;
  }
  return { diff: out, filesInDiff: files.length, filesDropped: dropped };
}

function selectedSources() {
  const all = git("ls-tree", "-r", "--name-only", HEAD)
    .trim()
    .split("\n")
    .filter((f) => f.startsWith("src/") && /\.(ts|tsx|js|mjs)$/.test(f))
    .sort((a, b) => rank(a) - rank(b));
  let out = "";
  for (const f of all) {
    if (rank(f) >= PRIORITY.length) break;
    let body;
    try {
      body = git("show", `${HEAD}:${f}`);
    } catch {
      continue;
    }
    const block = `\n===== ${f} =====\n${body}`;
    if (out.length + block.length > FILES_CAP) continue;
    out += block;
  }
  return out;
}

function fileTree() {
  return git("ls-tree", "-r", "--name-only", HEAD)
    .trim()
    .split("\n")
    .filter((f) => f.startsWith("src/"))
    .join("\n")
    .slice(0, TREE_CAP);
}

function testResults() {
  const p = path.join(BENCH, "results", "s-score", `${CELL}-ckpt${M}-a1.json`);
  if (!fs.existsSync(p)) return null;
  const r = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    buildStatus: r.buildStatus,
    cujPassed: r.cujPassed,
    cujTotal: r.cujTotal,
    failures: r.failures,
  };
}

const prompt = fs.readFileSync(
  path.join(BENCH, "specs", "relay-crm", `m${M}.md`),
  "utf8",
);
const rubric = fs.readFileSync(path.join(__dirname, "rubric.md"), "utf8");
const { diff, filesInDiff, filesDropped } = cappedDiff();
const sources = selectedSources();
const tests = testResults();

const userContent = [
  `# Milestone ${M} prompt\n\n${prompt}`,
  `# Automated test results\n\n${tests ? JSON.stringify(tests, null, 1) : "(not available — judge from code alone)"}`,
  `# File tree (src/)\n\n${fileTree()}`,
  `# Milestone diff (${filesInDiff} files, ${filesDropped} dropped by the ${DIFF_CAP}-char cap)\n\n${diff}`,
  `# Selected source files at checkpoint\n${sources}`,
].join("\n\n---\n\n");

// ---- engine call ----------------------------------------------------------
async function callJudge(model, extraNudge = "") {
  const body = JSON.stringify({
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 1500,
    messages: [
      { role: "system", content: rubric + extraNudge },
      { role: "user", content: userContent },
    ],
  });
  const res = await fetch(`${ENGINE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
    },
    body,
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok)
    throw new Error(`${model}: HTTP ${res.status} ${await res.text()}`);
  let text = "";
  let usage = null;
  const raw = await res.text();
  for (const line of raw.split("\n")) {
    const payload = line.startsWith("data:") ? line.slice(5).trim() : null;
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      text += obj.choices?.[0]?.delta?.content ?? "";
      if (obj.usage) usage = obj.usage;
    } catch {
      /* keepalive fragments */
    }
  }
  return { text, usage };
}

function parseVerdict(text) {
  const stripped = text.replace(/```(?:json)?/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  let candidate = stripped.slice(start, end + 1);
  // Tolerate common model-JSON defects: trailing commas and literal newlines
  // inside the rationale string.
  candidate = candidate.replace(/,\s*([}\]])/g, "$1");
  let v;
  try {
    v = JSON.parse(candidate);
  } catch {
    try {
      v = JSON.parse(candidate.replace(/\n/g, " "));
    } catch {
      return null;
    }
  }
  for (const k of ["bugs", "security", "code_quality", "schema_quality"]) {
    const n = Number(v[k]);
    if (!Number.isFinite(n) || n < 0 || n > 10) return null;
    v[k] = n;
  }
  return v;
}

const pricing = JSON.parse(
  fs.readFileSync(path.join(BENCH, "pricing", "pricing.json"), "utf8"),
);
function costOf(model, usage) {
  if (!usage) return null;
  const key = Object.keys(pricing.models).find((k) => model.includes(k));
  if (!key) return null;
  const p = pricing.models[key];
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, (usage.prompt_tokens ?? 0) - cached);
  return (
    (uncached * p.input +
      cached * p.cachedInput +
      (usage.completion_tokens ?? 0) * p.output) /
    1e6
  );
}

const judges = judgesFor(CELL);
const perJudge = [];
for (const model of judges) {
  let verdict = null;
  let usage = null;
  let error = null;
  for (let attempt = 1; attempt <= 2 && !verdict; attempt++) {
    try {
      const nudge =
        attempt === 2
          ? "\n\nYour previous reply was not valid strict JSON. Reply with ONLY the JSON object."
          : "";
      const r = await callJudge(model, nudge);
      usage = r.usage ?? usage;
      verdict = parseVerdict(r.text);
      if (!verdict) {
        const dbg = path.join(
          BENCH,
          "results",
          "judge",
          `debug-${CELL}-m${M}-${model.replace(/[^a-z0-9.-]/gi, "_")}-a${attempt}.txt`,
        );
        fs.mkdirSync(path.dirname(dbg), { recursive: true });
        fs.writeFileSync(dbg, r.text);
        if (attempt === 2) error = `invalid JSON after re-prompt (raw: ${dbg})`;
      }
    } catch (e) {
      error = String(e);
    }
  }
  perJudge.push({
    model,
    verdict,
    usage,
    estimatedUsd: costOf(model, usage),
    error,
  });
  console.log(
    `[judge] ${model}: ${verdict ? JSON.stringify({ b: verdict.bugs, s: verdict.security, c: verdict.code_quality, q: verdict.schema_quality }) : `FAILED (${error})`}`,
  );
}

const ok = perJudge.filter((j) => j.verdict);
if (ok.length === 0) throw new Error("all judge calls failed");
const dims = ["bugs", "security", "code_quality", "schema_quality"];
const averaged = Object.fromEntries(
  dims.map((d) => [
    d,
    +(ok.reduce((a, j) => a + j.verdict[d], 0) / ok.length).toFixed(2),
  ]),
);
const judgeScore = +(
  dims.reduce((a, d) => a + averaged[d], 0) /
  dims.length /
  10
).toFixed(4);

const out = {
  cellId: CELL,
  milestone: M,
  judges,
  judgePanel: ok.length === judges.length ? "full" : "partial",
  perJudge,
  averaged,
  judgeScore,
  inputChars: userContent.length,
  base: BASE,
  head: HEAD,
  judgedAt: new Date().toISOString(),
};
const outPath = path.join(BENCH, "results", "judge", `${CELL}-m${M}.json`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
  `[judge] ${CELL} m${M}: score=${judgeScore} panel=${out.judgePanel} -> ${outPath}`,
);
