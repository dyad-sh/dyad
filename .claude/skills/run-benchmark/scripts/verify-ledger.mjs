// Sanity-check a cell's request ledger BEFORE trusting its score: what model
// string, effort/thinking budget, max output tokens and HTTP status actually
// went over the wire, plus spend and the largest prompt.
//
//   node verify-ledger.mjs <cellId>... [--bench <dir>] [--expect-effort medium]
//                          [--expect-max 128000]
//
// Exit 1 when any row is non-200, maxTokens is missing on a run that should
// have one, or --expect-* does not match — those were the exact signatures of
// past silent failures (4096-token cap, unlabelled effort arm, upstream 429s).
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const opt = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const cells = args.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")),
);
const bench =
  opt("--bench") || path.resolve(process.cwd(), "benchmarks/app-builder");
const expectEffort = opt("--expect-effort"),
  expectMax = opt("--expect-max");
let bad = 0;
for (const cell of cells) {
  const f = path.join(bench, "proxy/logs", `requests-${cell}.jsonl`);
  if (!fs.existsSync(f)) {
    console.log(`${cell}: NO LEDGER at ${f}`);
    bad++;
    continue;
  }
  const rows = fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const tally = {};
  let usd = 0,
    maxPrompt = 0,
    reasoning = 0,
    out = 0,
    side = 0;
  for (const r of rows) {
    const k = `${r.path} ${r.model}@${r.effort ?? "none"}@max=${r.maxTokens ?? "-"}@${r.status}`;
    tally[k] = (tally[k] || 0) + 1;
    usd += r.estimatedUsd || 0;
    maxPrompt = Math.max(maxPrompt, r.usage?.promptTokens || 0);
    reasoning += r.usage?.reasoningTokens || 0;
    out += r.usage?.completionTokens || 0;
    if (/gpt-5\.6-luna/.test(r.model || "") && !/luna/.test(cell)) side++; // Dyad side tasks (titles etc.)
  }
  console.log(
    `\n${cell}: ${rows.length} requests, $${usd.toFixed(2)}, max prompt ${maxPrompt}, output ${out} (reasoning ${reasoning})${side ? `, ${side} luna side-task rows` : ""}`,
  );
  for (const [k, n] of Object.entries(tally).sort())
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  const main = rows.filter(
    (r) => !/gpt-5\.6-luna/.test(r.model || "") || /luna/.test(cell),
  );
  const non200 = main.filter((r) => r.status !== 200).length;
  const noMax = main.filter((r) => r.maxTokens == null).length;
  if (non200) {
    console.log(`  !! ${non200} non-200 responses`);
    bad++;
  }
  if (noMax === main.length && main.length)
    console.log(
      `  ?? no maxTokens on any request (OpenAI-compatible path may omit it; Anthropic path would cap at 4096 — check the catalog pin)`,
    );
  if (
    expectEffort &&
    main.some((r) => !String(r.effort ?? "").includes(expectEffort))
  ) {
    console.log(`  !! effort != ${expectEffort} on some rows`);
    bad++;
  }
  if (
    expectMax &&
    main.some((r) => String(r.maxTokens) !== String(expectMax))
  ) {
    console.log(`  !! maxTokens != ${expectMax} on some rows`);
    bad++;
  }
}
process.exit(bad ? 1 : 0);
