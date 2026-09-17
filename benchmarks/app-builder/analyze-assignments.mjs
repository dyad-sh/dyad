// Assignment-content analysis for the delegation-prompt arms.
//
// Extracts every implementer assignment from a cell's message logs and
// measures, per assignment:
//   form     -- does it carry the V4 sections (GOAL / MUST HOLD / DONE WHEN)?
//   mustHold -- is MUST HOLD non-empty (or an explicit "none" with a reason)?
//   security -- does the assignment state an access/scoping rule at all?
//               (the metric that separated 89.4% from 57.4% in the V3 arm)
//
// This is the go/no-go gate for spending on scoring: a prompt change that does
// not move these counters cannot have moved quality, and two of three prompt
// changes so far moved nothing.
//
//   node analyze-assignments.mjs <cell> [<cell> ...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const R = (...p) => path.join(BENCH, "results", ...p);

const SECURITY =
  /tenan|authoriz|permission|\brole\b|\browner\b|\bmember\b|\bviewer\b|access control|RLS|workspace[_ ]?id|scoped? by|read.only|server.side.*(reject|enforc)|deny/i;

function assignments(cell) {
  const out = [];
  for (const m of [1, 2, 3]) {
    const f = R("s-cell", `${cell}.m${m}.messages.json`);
    if (!fs.existsSync(f)) continue;
    let msgs;
    try {
      msgs = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      const name = n.toolName ?? n.tool_name;
      const input = n.input ?? n.args;
      if (
        name === "spawn_agent" &&
        input &&
        typeof input === "object" &&
        (input.persona ?? input.agentType) === "implementer"
      ) {
        out.push({
          m,
          task: input.task_name ?? "",
          text: input.assignment ?? "",
        });
      }
      for (const v of Object.values(n)) walk(v);
    };
    walk(msgs);
  }
  return out;
}

for (const cell of process.argv.slice(2)) {
  const rows = assignments(cell);
  if (!rows.length) {
    console.log(`${cell}: no implementer assignments found`);
    continue;
  }
  console.log(`\n=== ${cell} — ${rows.length} implementer assignments ===`);
  console.log("| m | task | form | MUST HOLD | security rule |");
  console.log("|---|---|---|---|---|");
  let form = 0,
    mh = 0,
    sec = 0;
  for (const r of rows) {
    const hasForm =
      /GOAL\s*:/i.test(r.text) &&
      /MUST\s*HOLD\s*:/i.test(r.text) &&
      /DONE\s*WHEN\s*:/i.test(r.text);
    // MUST HOLD counts when the section exists and its body (up to the next
    // section header) has content beyond a bare "none".
    const mhMatch = r.text.match(
      /MUST\s*HOLD\s*:([\s\S]*?)(?:OUT OF SCOPE\s*:|DONE\s*WHEN\s*:|$)/i,
    );
    const mhBody = (mhMatch?.[1] ?? "").trim();
    const hasMh = mhBody.length > 0 && !/^none\.?$/i.test(mhBody);
    const hasSec = SECURITY.test(r.text);
    form += hasForm ? 1 : 0;
    mh += hasMh ? 1 : 0;
    sec += hasSec ? 1 : 0;
    console.log(
      `| ${r.m} | ${r.task.slice(0, 40)} | ${hasForm ? "yes" : "NO"} | ${
        hasMh ? "yes" : mhBody ? "none+reason" : "MISSING"
      } | ${hasSec ? "yes" : "no"} |`,
    );
  }
  const pct = (n) =>
    `${n}/${rows.length} (${Math.round((100 * n) / rows.length)}%)`;
  console.log(
    `form ${pct(form)}   non-empty MUST HOLD ${pct(mh)}   security rule stated ${pct(sec)}`,
  );
}
