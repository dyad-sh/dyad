#!/usr/bin/env node
// Verify that each design doc's "Prompt (verbatim):" blockquotes are byte-identical
// extracts of the matching specs/<app>/m<N>.md, which is what the runner actually feeds
// the model. Read-only. Exits non-zero on any mismatch.
//
//   node benchmarks/app-builder/verify-prompt-extracts.mjs [app ...]

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MARK = "**Prompt (verbatim):**\n\n";
const END = "\n\n**CUJ suite";

// design doc -> specs directory
const APPS = {
  "app-1-relay-crm": "relay-crm",
  "app-2-deskhero": "deskhero",
  "app-3-portalis": "portalis",
  "app-4-ledgerly": "ledgerly",
  "app-5-slotline": "slotline",
  "app-6-curbside": "curbside",
};

const only = process.argv.slice(2);
let failures = 0;
let skipped = [];

for (const [doc, spec] of Object.entries(APPS)) {
  if (only.length && !only.includes(spec) && !only.includes(doc)) continue;
  const docPath = join(ROOT, "design", `${doc}.md`);
  if (!existsSync(docPath)) continue;
  const text = readFileSync(docPath, "utf8");
  if (!text.includes(MARK)) {
    skipped.push(`${doc} (no verbatim markers)`);
    continue;
  }

  let cursor = 0;
  for (const m of [1, 2, 3]) {
    const specPath = join(ROOT, "specs", spec, `m${m}.md`);
    if (!existsSync(specPath)) continue;
    const start = text.indexOf(MARK, cursor);
    if (start < 0) {
      console.log(`FAIL ${spec}/m${m}: no "Prompt (verbatim):" block found`);
      failures++;
      continue;
    }
    const bodyStart = start + MARK.length;
    const end = text.indexOf(END, bodyStart);
    if (end < 0) {
      console.log(
        `FAIL ${spec}/m${m}: prompt block is not terminated by a CUJ suite header`,
      );
      failures++;
      continue;
    }
    cursor = end;

    let unquoted;
    try {
      unquoted =
        text
          .slice(bodyStart, end)
          .split("\n")
          .map((line) => {
            if (line === ">") return "";
            if (line.startsWith("> ")) return line.slice(2);
            throw new Error(
              `line is not blockquoted: ${JSON.stringify(line.slice(0, 80))}`,
            );
          })
          .join("\n") + "\n";
    } catch (err) {
      console.log(`FAIL ${spec}/m${m}: ${err.message}`);
      failures++;
      continue;
    }

    const onDisk = readFileSync(specPath, "utf8");
    if (unquoted === onDisk) {
      const n = onDisk.split(/\s+/).filter(Boolean).length;
      console.log(`ok   ${spec}/m${m}  ${onDisk.length} bytes, ${n} words`);
      continue;
    }
    failures++;
    console.log(`FAIL ${spec}/m${m}: design doc and spec differ`);
    const a = unquoted.split("\n");
    const b = onDisk.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`       first difference at line ${i + 1}`);
        console.log(
          `       design: ${JSON.stringify((a[i] ?? "<missing>").slice(0, 100))}`,
        );
        console.log(
          `       spec  : ${JSON.stringify((b[i] ?? "<missing>").slice(0, 100))}`,
        );
        break;
      }
    }
  }
}

for (const s of skipped) console.log(`skip ${s}`);
if (failures) {
  console.log(`\n${failures} mismatch(es).`);
  process.exit(1);
}
console.log(
  "\nAll prompt blocks are byte-identical extracts of their spec files.",
);
