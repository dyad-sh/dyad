// Reconstruct historical costs from preserved raw usage and exact request IDs.
// Never infer milestone boundaries from pauses, or proportionally scale costs.
// node audit-accounting.mjs --data /path/to/app-builder --out /new/audit-dir [--write]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { normalizeRecordedUsage, priceOf } from "./proxy/accounting.mjs";
const here = path.dirname(fileURLToPath(import.meta.url)),
  args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i < 0 ? d : args[i + 1];
};
const data = path.resolve(arg("--data", here)),
  out = path.resolve(arg("--out", path.join(data, "results/accounting-audit"))),
  write = args.includes("--write");
fs.mkdirSync(out, { recursive: true });
const pricingText = fs.readFileSync(
    path.join(here, "pricing/pricing.json"),
    "utf8",
  ),
  pricing = JSON.parse(pricingText),
  pricingHash = createHash("sha256").update(pricingText).digest("hex");
const rows = [],
  byId = new Map();
for (const file of fs
  .readdirSync(path.join(data, "proxy/logs"))
  .filter((f) => f.endsWith(".jsonl"))) {
  const lines = fs
    .readFileSync(path.join(data, "proxy/logs", file), "utf8")
    .split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      throw Error(
        `Malformed ledger ${file}:${i + 1}; repair/archive it before auditing`,
      );
    }
    const r = { ...row, source: { file, line: i + 1 } };
    rows.push(r);
    if (r.dyadRequestId) {
      const id = r.dyadRequestId.split(":")[0];
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(r);
    }
  }
}
const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  pricingHash,
  method:
    "Request IDs plus timestamp-bounded side tasks; reconciled against recorded cell totals",
  cells: [],
};
for (const file of fs
  .readdirSync(path.join(data, "results/s-cell"))
  .filter((f) => f.endsWith(".summary.json"))
  .sort()) {
  const sumPath = path.join(data, "results/s-cell", file),
    summary = JSON.parse(fs.readFileSync(sumPath)),
    cell = summary.cellId;
  if (!/^[a-zA-Z0-9_.-]+$/.test(cell)) throw Error("Unsafe cell ID");
  const audit = { cell, status: "verified", milestones: [], issues: [] };
  let previous = new Set();
  const attributed = new Set();
  for (const m of summary.milestones) {
    const messagesPath = path.join(
      data,
      "results/s-cell",
      `${cell}.m${m.m}.messages.json`,
    );
    if (!fs.existsSync(messagesPath)) {
      audit.issues.push(`m${m.m}: missing message/request-ID archive`);
      continue;
    }
    const messages = JSON.parse(fs.readFileSync(messagesPath)),
      ids = new Set(
        messages
          .filter((x) => x.requestId && !previous.has(x.requestId))
          .map((x) => x.requestId),
      );
    previous = new Set(
      messages.filter((x) => x.requestId).map((x) => x.requestId),
    );
    const direct = [...ids].flatMap((id) => byId.get(id) ?? []);
    if (!direct.length) {
      audit.issues.push(`m${m.m}: no correlated requests`);
      continue;
    }
    const start = Math.min(
        ...messages
          .filter((x) => ids.has(x.requestId))
          .map((x) => Date.parse(x.createdAt)),
      ),
      files = new Set(direct.map((r) => r.source.file));
    let end;
    try {
      end =
        Number(
          execFileSync(
            "git",
            [
              "-C",
              path.join(data, "results/s-cell/checkouts", cell),
              "show",
              "-s",
              "--format=%ct",
              m.sha,
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
          ),
        ) *
          1000 +
        999;
    } catch {
      end = Math.max(
        ...direct.map((r) => Date.parse(r.ts) + (r.durationMs ?? 0)),
      );
    }
    // Files can contain multiple runs. Only correlated request IDs belong to
    // this milestone; unlabelled auxiliary calls must be inside its time window.
    const side = rows.filter(
      (r) =>
        !r.dyadRequestId &&
        files.has(r.source.file) &&
        Date.parse(r.ts) >= start &&
        Date.parse(r.ts) <= end,
    );
    const unique = [
      ...new Map(
        [...direct, ...side].map((r) => [
          [r.ts, r.dyadRequestId, r.model, r.requestBytes, r.durationMs].join(
            "|",
          ),
          r,
        ]),
      ).entries(),
    ];
    let ledger = 0,
      beforeNormalization = 0,
      corrected = 0;
    const evidence = [];
    for (const [key, r] of unique) {
      if (attributed.has(key)) {
        audit.issues.push(`m${m.m}: request assigned twice`);
        continue;
      }
      attributed.add(key);
      if (!r.usage) {
        if (
          r.status === 200 &&
          r.model &&
          /\/(responses|chat\/completions|messages)(?:\?|$)/.test(r.path ?? "")
        )
          audit.issues.push(
            `m${m.m}: successful request missing usage (${r.source.file}:${r.source.line})`,
          );
        continue;
      }
      // A lossy Anthropic message_stop summary cannot recover cache tokens.
      const raw = r.usage.raw;
      if (
        r.model?.includes("claude") &&
        raw?.input_tokens != null &&
        !raw.input_tokens_details &&
        raw.cache_read_input_tokens == null &&
        raw.cache_creation_input_tokens == null
      )
        audit.issues.push(`m${m.m}: unrecoverable Anthropic cache counts`);
      const normalized = normalizeRecordedUsage(r.usage),
        cost = priceOf(r.model, normalized, pricing),
        old = priceOf(r.model, r.usage, pricing);
      if (cost == null || old == null) {
        audit.issues.push(`m${m.m}: no pinned rate for ${r.model}`);
        continue;
      }
      ledger += r.estimatedUsd ?? 0;
      beforeNormalization += old;
      corrected += cost;
      evidence.push({
        ...r.source,
        requestId: r.dyadRequestId,
        model: r.model,
        usage: normalized,
        estimatedUsd: cost,
      });
    }
    audit.milestones.push({
      m: m.m,
      recorded: m.estimatedUsd,
      ledger,
      beforeNormalization,
      corrected,
      requests: evidence.length,
      evidence,
    });
  }
  const total = (k) => audit.milestones.reduce((t, m) => t + m[k], 0),
    recorded = summary.milestones.reduce(
      (t, m) => t + (m.estimatedUsd ?? 0),
      0,
    );
  // Earlier repricing scaled milestone shares. Verify the CELL total, then
  // replace those artificial shares with the actual per-milestone request sum.
  if (
    !["ledger", "beforeNormalization", "corrected"].some(
      (k) => Math.abs(total(k) - recorded) <= 0.001,
    )
  )
    audit.issues.push(
      `Ledger does not reconcile: recorded=${recorded}, original=${total("ledger")}, pinned=${total("beforeNormalization")}`,
    );
  Object.assign(audit, {
    recorded,
    corrected: total("corrected"),
    delta: total("corrected") - recorded,
    status: !audit.issues.length
      ? "verified"
      : audit.issues.every((x) =>
            x.includes("successful request missing usage"),
          )
        ? "partial"
        : "unverified",
  });
  if (write) {
    const backup = path.join(out, file + ".before");
    if (!fs.existsSync(backup))
      fs.copyFileSync(sumPath, backup, fs.constants.COPYFILE_EXCL);
    if (audit.status !== "unverified")
      for (const m of summary.milestones)
        m.estimatedUsd = +audit.milestones
          .find((x) => x.m === m.m)
          .corrected.toFixed(4);
    summary.accountingAudit = {
      version: 1,
      status: audit.status,
      pricingHash,
      issues: audit.issues,
      at: report.createdAt,
    };
    fs.writeFileSync(sumPath, JSON.stringify(summary, null, 2) + "\n");
  }
  fs.writeFileSync(
    path.join(out, cell + ".json"),
    JSON.stringify(audit, null, 2) + "\n",
  );
  report.cells.push({
    ...audit,
    milestones: audit.milestones.map(({ evidence: _evidence, ...m }) => m),
  });
  console.log(
    `${audit.status} ${cell}: ${recorded.toFixed(4)} -> ${audit.corrected.toFixed(4)}${audit.issues.length ? " " + audit.issues.join("; ") : ""}`,
  );
}
fs.writeFileSync(
  path.join(out, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    verified: report.cells.filter((c) => c.status === "verified").length,
    unverified: report.cells.filter((c) => c.status !== "verified").length,
    write,
  }),
);
