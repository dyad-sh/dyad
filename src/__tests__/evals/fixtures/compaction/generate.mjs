#!/usr/bin/env node
/**
 * Compaction-benchmark fixture generator.
 *
 * Reads a scenario spec (see AUTHORING.md), has gpt-5.6-sol author the
 * session narrative phase-by-phase, materializes a Dyad-format message list
 * (full <dyad-write> contents, MCP tool tags), amplifies to the target
 * transcript size with deterministic bulk-asset/filler turns, validates that
 * every manifest evidence string landed, and writes <name>.json + stats.
 *
 * Usage:
 *   node generate.mjs --spec specs/<name>.spec.json [--target 180000] [--force]
 *
 * Env: DYAD_PRO_KEY or DYAD_PRO_API_KEY (required), DYAD_ENGINE_URL (optional),
 *      CMPGEN_MODEL (default gpt-5.6-sol).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI + config
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const SPEC_PATH = argValue("--spec", null);
const TARGET_TOKENS = Number(argValue("--target", "180000"));
const MIN_TOKENS = Number(argValue("--min", "165000"));
const MAX_TOKENS = Number(argValue("--max", "210000"));
const FORCE = argv.includes("--force");

const API_KEY = process.env.DYAD_PRO_API_KEY || process.env.DYAD_PRO_KEY;
const ENGINE_URL = process.env.DYAD_ENGINE_URL || "https://engine.dyad.sh/v1";
const MODEL = process.env.CMPGEN_MODEL || "gpt-5.6-sol";

if (!SPEC_PATH) fail("Missing --spec <path>");
if (!API_KEY) fail("Missing DYAD_PRO_KEY / DYAD_PRO_API_KEY in env");

function fail(msg) {
  console.error(`[generate] FATAL: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Transcript sizing — mirrors src/ipc/handlers/compaction/compaction_storage.ts
// (formatAsTranscript + transformToolTags) and token_utils.estimateTokens
// (4 chars/token). The eval harness uses the real production functions; this
// mirror exists only so the generator can size the fixture without importing
// TS from an .mjs script.
// ---------------------------------------------------------------------------
const TOOL_RESULT_TRUNCATION_LIMIT = 1000;

function transformToolTags(content) {
  let result = content.replace(
    /<dyad-mcp-tool-call\b[^>]*?\bserver="([^"]*)"[^>]*?\btool="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/dyad-mcp-tool-call>/g,
    '<tool-use name="$2" server="$1">\n$3\n</tool-use>',
  );
  result = result.replace(
    /<dyad-mcp-tool-result\b[^>]*?\bserver="([^"]*)"[^>]*?\btool="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/dyad-mcp-tool-result>/g,
    (_m, server, tool, rc) => {
      const truncated = rc.length > TOOL_RESULT_TRUNCATION_LIMIT;
      const body = truncated
        ? rc.slice(0, TOOL_RESULT_TRUNCATION_LIMIT) + "\n..."
        : rc;
      return `<tool-result name="${tool}" server="${server}" chars="${rc.length}"${truncated ? ' truncated="true"' : ""}>\n${body}\n</tool-result>`;
    },
  );
  return result;
}

function formatAsTranscriptMirror(messages) {
  const body = messages
    .map(
      (m) => `<msg role="${m.role}">\n${transformToolTags(m.content)}\n</msg>`,
    )
    .join("\n\n");
  return `<transcript>\n\n${body}\n\n</transcript>`;
}

const estTokens = (s) => Math.ceil(s.length / 4);

// ---------------------------------------------------------------------------
// Engine client (SSE, retry w/ backoff on 429/5xx)
// ---------------------------------------------------------------------------
async function generateWithSol({ system, user, maxTokens = 30000 }) {
  const body = JSON.stringify({
    model: MODEL,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
  });

  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${ENGINE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < 5) {
          const delay = 5000 * 2 ** (attempt - 1) * (1 + Math.random());
          console.error(
            `[generate] engine ${res.status}, retry ${attempt}/5 in ${Math.round(delay / 1000)}s`,
          );
          await sleep(delay);
          continue;
        }
        throw new Error(`engine ${res.status}: ${text.slice(0, 500)}`);
      }
      const raw = await res.text();
      let content = "";
      let finish = null;
      let usage = null;
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (chunk.error)
          throw new Error(
            `engine SSE error: ${JSON.stringify(chunk.error).slice(0, 500)}`,
          );
        if (chunk.usage) usage = chunk.usage;
        for (const c of chunk.choices ?? []) {
          if (c.delta?.content) content += c.delta.content;
          if (c.finish_reason) finish = c.finish_reason;
        }
      }
      if (finish === "length")
        throw new Error("generation hit max_tokens (finish_reason=length)");
      return { content, usage };
    } catch (e) {
      lastErr = e;
      if (
        attempt < 5 &&
        /fetch failed|ECONNRESET|ETIMEDOUT|max_tokens/i.test(String(e))
      ) {
        const delay = 5000 * 2 ** (attempt - 1);
        console.error(
          `[generate] ${e}. retry ${attempt}/5 in ${Math.round(delay / 1000)}s`,
        );
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJsonLoose(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start > 0) t = t.slice(start);
  const end = t.lastIndexOf("}");
  if (end >= 0) t = t.slice(0, end + 1);
  return JSON.parse(t);
}

// ---------------------------------------------------------------------------
// Bulk asset synthesizers — deterministic, seeded by path so re-runs and
// "expand" filler produce stable-but-growing content.
// ---------------------------------------------------------------------------
function seededRand(seedStr) {
  let h = 2166136261;
  for (const ch of seedStr) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const WORDS =
  "amber basil cedar delta ember fjord garnet harbor indigo juniper krypton lumen maple nectar onyx pluto quartz raven sable topaz umber violet willow xenon yarrow zephyr".split(
    " ",
  );

function synthSeedData(pathStr, kind, count) {
  const rand = seededRand(pathStr + kind);
  const word = () => WORDS[Math.floor(rand() * WORDS.length)];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const name = `${word()}-${word()}-${i}`;
    if (kind === "products") {
      rows.push(
        `  { id: "prd_${String(i).padStart(4, "0")}", name: "${name}", sku: "${word().toUpperCase()}-${1000 + i}", priceCents: ${Math.floor(rand() * 20000) + 199}, stock: ${Math.floor(rand() * 500)}, category: "${word()}", tags: ["${word()}", "${word()}"], active: ${rand() > 0.1} },`,
      );
    } else if (kind === "users") {
      rows.push(
        `  { id: "usr_${String(i).padStart(4, "0")}", handle: "${name}", email: "${name}@example.com", role: "${rand() > 0.85 ? "admin" : "member"}", createdAt: "2025-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}" },`,
      );
    } else {
      rows.push(
        `  { id: "evt_${String(i).padStart(4, "0")}", type: "${word()}.${word()}", payload: { ref: "${word()}-${i}", value: ${Math.floor(rand() * 10000)} }, ts: ${1735689600 + i * 3600} },`,
      );
    }
  }
  const exportName = kind.toUpperCase() + "_SEED";
  return `// Auto-generated seed data. Do not edit by hand — regenerate via scripts/seed.\nexport const ${exportName} = [\n${rows.join("\n")}\n];\n`;
}

function synthLocaleJson(pathStr, count) {
  const rand = seededRand(pathStr);
  const word = () => WORDS[Math.floor(rand() * WORDS.length)];
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push(
      `  "${word()}.${word()}.${i}": "${word()} ${word()} ${word()} ${word()}"`,
    );
  }
  return `{\n${entries.join(",\n")}\n}\n`;
}

function synthLongCss(pathStr, count) {
  const rand = seededRand(pathStr);
  const word = () => WORDS[Math.floor(rand() * WORDS.length)];
  const rules = [];
  for (let i = 0; i < count; i++) {
    rules.push(
      `.${word()}-${word()}-${i} {\n  display: flex;\n  gap: ${Math.floor(rand() * 24)}px;\n  padding: ${Math.floor(rand() * 32)}px ${Math.floor(rand() * 32)}px;\n  color: hsl(${Math.floor(rand() * 360)} ${Math.floor(rand() * 100)}% ${Math.floor(rand() * 100)}%);\n  border-radius: ${Math.floor(rand() * 16)}px;\n}`,
    );
  }
  return `/* Generated utility styles — see tooling/styles.md */\n${rules.join("\n\n")}\n`;
}

function synthAsset(bulk, scale = 1) {
  const count = Math.max(10, Math.round(bulk.count * scale));
  if (bulk.asset === "seed-data")
    return synthSeedData(bulk.path, bulk.kind ?? "products", count);
  if (bulk.asset === "locale-json") return synthLocaleJson(bulk.path, count);
  if (bulk.asset === "long-css") return synthLongCss(bulk.path, count);
  throw new Error(`unknown bulk asset type: ${bulk.asset}`);
}

// ---------------------------------------------------------------------------
// Materialization helpers
// ---------------------------------------------------------------------------
function toolCallXml(tool, args, result) {
  return (
    `<dyad-mcp-tool-call server="dyad" tool="${tool}">\n${JSON.stringify(args)}\n</dyad-mcp-tool-call>\n` +
    `<dyad-mcp-tool-result server="dyad" tool="${tool}">\n${result}\n</dyad-mcp-tool-result>`
  );
}

function dyadWriteXml(p, description, content) {
  return `<dyad-write path="${p}" description="${description}">\n${content}\n</dyad-write>`;
}

// ---------------------------------------------------------------------------
// Phase authoring
// ---------------------------------------------------------------------------
const AUTHOR_SYSTEM = `You are authoring one phase of a realistic, long AI-pair-programming session transcript for Dyad (an AI app builder). The session is between a USER (a real developer: terse, sometimes changes their mind, pastes errors) and an ASSISTANT (a coding agent that narrates briefly, calls tools, and writes full files).

You will receive: the app domain, a recap of the session so far, the current contents of the files this phase works on, this phase's goal, REQUIRED evidence strings, and how many turns to produce.

Rules:
1. Produce EXACTLY the requested number of turns. A turn = one user message + one assistant reply.
2. Every REQUIRED evidence string must appear VERBATIM (character-for-character, same casing/punctuation) inside user or assistant text of this phase, placed where it reads naturally.
3. Assistant replies are structured as: prose (brief narration), then actions, then closing (short wrap-up / next step).
4. Actions available:
   - {"type":"tool","tool":"read_file","args":{"path":"..."}}  (no result needed; the harness inlines the real file)
   - {"type":"tool","tool":"run_terminal","args":{"command":"..."},"result":"realistic stdout/stderr, <=1500 chars"}
   - {"type":"tool","tool":"grep_search","args":{"query":"..."},"result":"realistic matches, <=1200 chars"}
   - {"type":"write","path":"...","description":"one-line change summary","content":"FULL new file content"}
   - {"type":"bulk","ref":"<path>"} — placeholder for a large generated asset write (seed data/locales/styles). Use each provided bulk ref exactly once, in a turn where it makes narrative sense.
5. "write" content must be the COMPLETE file (not a fragment), consistent with the current contents you were given and with the session so far. Realistic working code; 60–220 lines per file. When revising a file, carry unchanged parts forward faithfully.
6. Realism: occasional failing builds/tests with concrete error text that a later turn fixes; the user occasionally redirects; do not summarize the session inside the session.
7. Output STRICT JSON, no markdown fences, matching:
{"recap":"3-5 sentence factual recap of the session INCLUDING this phase (for the next phase's author)","turns":[{"user":"...","assistant":{"prose":"...","actions":[...],"closing":"..."}}]}
`;

function phaseUserPrompt(spec, phase, recap, fileState, required) {
  const activeFiles = Object.entries(fileState)
    .filter(([p]) => (phase.activeFiles ?? []).includes(p))
    .map(([p, c]) => `--- ${p} (current) ---\n${c}`)
    .join("\n\n");
  const newFiles = (phase.activeFiles ?? []).filter((p) => !(p in fileState));
  return [
    `APP DOMAIN: ${spec.domain}`,
    `SESSION RECAP SO FAR: ${recap || "(session start — no prior context)"}`,
    `PHASE GOAL: ${phase.goal}`,
    `TURNS TO PRODUCE: ${phase.turns}`,
    `ACTIVE FILES THIS PHASE: ${(phase.activeFiles ?? []).join(", ") || "(author's choice)"}`,
    newFiles.length
      ? `FILES THAT DO NOT EXIST YET (create with "write"): ${newFiles.join(", ")}`
      : "",
    (phase.bulk ?? []).length
      ? `BULK ASSET REFS to place (one {"type":"bulk","ref":...} action each): ${(phase.bulk ?? []).map((b) => b.path).join(", ")} — narrative reason: generated data/assets the user asked to scaffold.`
      : "",
    required.length
      ? `REQUIRED EVIDENCE STRINGS (each must appear VERBATIM in this phase's user/assistant text):\n${required.map((r) => `  - ${JSON.stringify(r)}`).join("\n")}`
      : "",
    activeFiles ? `CURRENT FILE CONTENTS:\n\n${activeFiles}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function requiredStringsForPhase(spec, phase) {
  const req = [];
  for (const f of spec.facts ?? [])
    if ((phase.factIds ?? []).includes(f.id)) req.push(f.evidence);
  for (const t of spec.traps ?? []) {
    if (t.oldPhase === phase.id) req.push(t.supersededEvidence);
    if (t.newPhase === phase.id) req.push(t.currentEvidence);
  }
  return req;
}

function materializeTurns(turns, fileState, bulkByPath) {
  const messages = [];
  for (const turn of turns) {
    messages.push({ role: "user", content: String(turn.user ?? "") });
    const a = turn.assistant ?? {};
    const parts = [a.prose ?? ""];
    for (const action of a.actions ?? []) {
      if (action.type === "tool") {
        let result = action.result ?? "";
        if (action.tool === "read_file") {
          const p = action.args?.path;
          result = fileState[p] ?? `Error: file not found: ${p}`;
        }
        parts.push(toolCallXml(action.tool, action.args ?? {}, result));
      } else if (action.type === "write") {
        fileState[action.path] = action.content;
        parts.push(
          dyadWriteXml(
            action.path,
            action.description ?? "Update file",
            action.content,
          ),
        );
      } else if (action.type === "bulk") {
        const bulk = bulkByPath.get(action.ref);
        if (!bulk) throw new Error(`unknown bulk ref: ${action.ref}`);
        const content = synthAsset(bulk, 1);
        fileState[bulk.path] = content;
        parts.push(
          dyadWriteXml(
            bulk.path,
            `Generate ${bulk.asset} (${bulk.count} entries)`,
            content,
          ),
        );
        bulkByPath.delete(action.ref);
      } else {
        throw new Error(`unknown action type: ${action.type}`);
      }
    }
    if (a.closing) parts.push(a.closing);
    messages.push({
      role: "assistant",
      content: parts.filter(Boolean).join("\n\n"),
    });
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Filler (amplification) — inserted BEFORE the final phase so the tail of the
// transcript stays the authored in-flight task. Cycles: expand a bulk asset,
// hit a transient build error, fix it. Deliberately low-signal.
// ---------------------------------------------------------------------------
function fillerCycle(spec, fileState, cycleIdx) {
  const bulks = (spec.phases ?? []).flatMap((p) => p.bulk ?? []);
  const bulk = bulks[cycleIdx % bulks.length];
  if (!bulk) return [];
  const scale = 1 + 0.35 * (cycleIdx + 1);
  const content = synthAsset(bulk, scale);
  fileState[bulk.path] = content;
  const n = Math.round(bulk.count * scale);
  const kindLabel =
    bulk.asset === "seed-data" ? (bulk.kind ?? "records") : bulk.asset;
  return [
    {
      role: "user",
      content: `we need more ${kindLabel} coverage for testing — bump ${bulk.path} to ~${n} entries`,
    },
    {
      role: "assistant",
      content: [
        `Regenerating ${bulk.path} with ${n} entries.`,
        dyadWriteXml(
          bulk.path,
          `Expand generated ${kindLabel} to ${n} entries`,
          content,
        ),
        toolCallXml(
          "run_terminal",
          { command: "npm run typecheck" },
          cycleIdx % 3 === 1
            ? `src/lib/validate.ts: error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'string'. (stale cache)\n$ npm run typecheck -- --force\nDone in 8.${cycleIdx}s — 0 errors.`
            : `Done in 6.${cycleIdx}s — 0 errors.`,
        ),
        `Typecheck passes. Nothing else touched.`,
      ].join("\n\n"),
    },
  ];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validate(spec, transcript) {
  const missing = [];
  const check = (label, s) => {
    if (!transcript.includes(s)) missing.push({ label, evidence: s });
  };
  for (const f of spec.facts ?? []) check(f.id, f.evidence);
  for (const t of spec.traps ?? []) {
    check(`${t.id}.superseded`, t.supersededEvidence);
    check(`${t.id}.current`, t.currentEvidence);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const specAbs = path.resolve(process.cwd(), SPEC_PATH);
  const spec = JSON.parse(fs.readFileSync(specAbs, "utf8"));
  const outPath = path.join(__dirname, `${spec.name}.json`);
  const statsPath = path.join(__dirname, `${spec.name}.stats.json`);
  if (fs.existsSync(outPath) && !FORCE)
    fail(`${outPath} exists (use --force to overwrite)`);

  // Basic spec sanity
  for (const key of ["name", "domain", "phases", "facts", "traps", "probes"])
    if (!(key in spec)) fail(`spec missing "${key}"`);
  const plantedFactIds = new Set(spec.phases.flatMap((p) => p.factIds ?? []));
  for (const f of spec.facts)
    if (!plantedFactIds.has(f.id))
      fail(`fact ${f.id} not assigned to any phase`);
  for (const t of spec.traps)
    if (!t.oldPhase || !t.newPhase)
      fail(`trap ${t.id} missing oldPhase/newPhase`);

  const fileState = {};
  let recap = "";
  const phaseMessages = [];
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0 };

  for (const phase of spec.phases) {
    const required = requiredStringsForPhase(spec, phase);
    const bulkByPath = new Map((phase.bulk ?? []).map((b) => [b.path, b]));
    console.error(
      `[generate] ${spec.name}: authoring phase ${phase.id} (${phase.turns} turns)...`,
    );

    let seg = null;
    let lastProblem = "";
    for (let attempt = 1; attempt <= 3 && !seg; attempt++) {
      const { content, usage } = await generateWithSol({
        system: AUTHOR_SYSTEM,
        user:
          phaseUserPrompt(spec, phase, recap, fileState, required) +
          (lastProblem
            ? `\n\nPREVIOUS ATTEMPT REJECTED: ${lastProblem}. Fix this.`
            : ""),
      });
      if (usage) {
        totalUsage.prompt_tokens += usage.prompt_tokens ?? 0;
        totalUsage.completion_tokens += usage.completion_tokens ?? 0;
      }
      let parsed;
      try {
        parsed = parseJsonLoose(content);
      } catch (e) {
        lastProblem = `output was not valid JSON (${e})`;
        console.error(`[generate]   attempt ${attempt}: ${lastProblem}`);
        continue;
      }
      const turns = parsed.turns ?? [];
      const probeState = { ...fileState };
      let msgs;
      try {
        msgs = materializeTurns(turns, probeState, new Map(bulkByPath));
      } catch (e) {
        lastProblem = String(e.message ?? e);
        console.error(`[generate]   attempt ${attempt}: ${lastProblem}`);
        continue;
      }
      const segText = msgs.map((m) => m.content).join("\n");
      const missing = required.filter((r) => !segText.includes(r));
      const unusedBulk = [...bulkByPath.keys()].filter((p) =>
        turns.every((t) =>
          (t.assistant?.actions ?? []).every(
            (a) => !(a.type === "bulk" && a.ref === p),
          ),
        ),
      );
      if (missing.length) {
        lastProblem = `missing verbatim evidence strings: ${missing.map((s) => JSON.stringify(s)).join("; ")}`;
        console.error(`[generate]   attempt ${attempt}: ${lastProblem}`);
        continue;
      }
      if (unusedBulk.length) {
        lastProblem = `bulk refs never used: ${unusedBulk.join(", ")}`;
        console.error(`[generate]   attempt ${attempt}: ${lastProblem}`);
        continue;
      }
      seg = { msgs, recap: parsed.recap ?? recap, fileStateAfter: probeState };
    }
    if (!seg)
      fail(`phase ${phase.id}: 3 authoring attempts failed (${lastProblem})`);
    Object.assign(fileState, seg.fileStateAfter);
    recap = seg.recap;
    phaseMessages.push(seg.msgs);
  }

  // Assemble with filler before the final phase until in the target band.
  const head = phaseMessages.slice(0, -1).flat();
  const tail = phaseMessages[phaseMessages.length - 1];
  let filler = [];
  let cycle = 0;
  const assemble = () => [...head, ...filler, ...tail];
  let tokens = estTokens(formatAsTranscriptMirror(assemble()));
  console.error(
    `[generate] ${spec.name}: authored core = ~${tokens} est tokens`,
  );
  while (tokens < TARGET_TOKENS && cycle < 400) {
    const more = fillerCycle(spec, { ...fileState }, cycle++);
    if (!more.length) break;
    filler.push(...more);
    tokens = estTokens(formatAsTranscriptMirror(assemble()));
  }
  // Trim overshoot from the filler side only.
  while (tokens > MAX_TOKENS && filler.length >= 2) {
    filler = filler.slice(0, -2);
    tokens = estTokens(formatAsTranscriptMirror(assemble()));
  }

  const messages = assemble();
  const transcript = formatAsTranscriptMirror(messages);
  const missing = validate(spec, transcript);
  const stats = {
    name: spec.name,
    model: MODEL,
    estTokens: tokens,
    chars: transcript.length,
    messageCount: messages.length,
    fillerMessages: filler.length,
    authoringUsage: totalUsage,
    missingEvidence: missing,
    withinBand: tokens >= MIN_TOKENS && tokens <= MAX_TOKENS,
  };
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));

  if (missing.length)
    fail(
      `evidence missing from final transcript: ${missing.map((m) => m.label).join(", ")} (stats written)`,
    );
  if (!stats.withinBand)
    fail(
      `est tokens ${tokens} outside [${MIN_TOKENS}, ${MAX_TOKENS}] (stats written)`,
    );

  const fixture = {
    name: spec.name,
    domain: spec.domain,
    facts: spec.facts,
    traps: spec.traps,
    probes: spec.probes,
    messages,
  };
  fs.writeFileSync(outPath, JSON.stringify(fixture, null, 1));
  console.error(
    `[generate] ${spec.name}: OK — ${messages.length} messages, ~${tokens} est tokens -> ${path.basename(outPath)}`,
  );
  console.log(JSON.stringify(stats));
}

main().catch((e) => fail(e.stack ?? String(e)));
