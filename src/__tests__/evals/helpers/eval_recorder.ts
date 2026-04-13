import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LanguageModelUsage } from "ai";

// Project-root `eval-results/` (never deleted, not tracked by git — see
// .gitignore). Layout:
//
//   eval-results/
//     <suite>/
//       <run-start-ts>__<model-label>/        (run folder)
//         <case-name>/                        (record folder)
//           record.json                       (full structured record)
//           record.txt                        (readable plaintext, every
//                                              tool call inline)
//           tool_calls/
//             01.txt                          (one file per tool call,
//             02.txt                           real newlines — not \n)
//             ...
//
// `<run-start-ts>` is captured once at module load so every case run in
// the same vitest process for the same model lands in one folder. The
// ISO-timestamp prefix makes `ls` return folders in chronological order.
const RESULTS_ROOT = resolve(__dirname, "../../../../eval-results");

// Captured once per module load. Shared by every `recordEvalRun` call
// from the same process so all cases from a single run cluster into
// one folder per model.
const RUN_START_TIMESTAMP = new Date().toISOString();

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMRequestRecord {
  stepIndex: number;
  timestamp: string;
  durationMs: number;
  usage: NormalizedUsage;
  finishReason: string | null;
}

export interface ToolCallRecord {
  timestamp: string;
  index: number;
  toolName: string;
  filePath: string;
  oldString: string;
  newString: string;
  fileBefore: string;
  fileAfter: string;
  // Unified diff from fileBefore → fileAfter for this single call.
  // Empty string when the call did not change the file.
  diff: string;
}

export interface JudgeRecord {
  label: string;
  provider: string;
  modelName: string;
  durationMs: number;
  usage: NormalizedUsage;
  pass: boolean;
  explanation: string;
}

export interface EvalRunRecord {
  timestamp: string;
  suite: string;
  caseName: string;
  model: {
    label: string;
    provider: string;
    modelName: string;
    responseModelId: string | null;
  };
  llm: {
    totalDurationMs: number;
    totalUsage: NormalizedUsage;
    requestCount: number;
    requests: LLMRequestRecord[];
  };
  toolCalls: ToolCallRecord[];
  // Unified diff between the original file (pre-first-tool-call) and
  // the final file (post-last-tool-call). Empty string when no change.
  diff: string;
  judge: JudgeRecord | null;
  passed: boolean;
  errorMessage: string | null;
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function fsTimestamp(iso: string): string {
  // Colons/periods are legal on Linux but ugly and fragile across
  // filesystems. Replace so `2026-04-10T14:23:01.123Z` becomes
  // `2026-04-10T14-23-01-123Z`.
  return iso.replace(/[:.]/g, "-");
}

export function normalizeUsage(
  u: LanguageModelUsage | undefined,
): NormalizedUsage {
  const input = u?.inputTokens ?? 0;
  const output = u?.outputTokens ?? 0;
  const total = u?.totalTokens ?? input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function formatUsage(u: NormalizedUsage): string {
  return `input=${u.inputTokens} output=${u.outputTokens} total=${u.totalTokens}`;
}

function hr(char = "=", n = 72): string {
  return char.repeat(n);
}

function formatToolCall(tc: ToolCallRecord): string {
  return (
    `${hr("-")}\n` +
    `Tool call #${tc.index + 1} (${tc.toolName})\n` +
    `Timestamp: ${tc.timestamp}\n` +
    `File:      ${tc.filePath}\n` +
    `\n` +
    `----- OLD_STRING (${tc.oldString.length} chars) -----\n` +
    `${tc.oldString}\n` +
    `----- NEW_STRING (${tc.newString.length} chars) -----\n` +
    `${tc.newString}\n` +
    `----- FILE BEFORE (${tc.fileBefore.length} chars) -----\n` +
    `${tc.fileBefore}\n` +
    `----- FILE AFTER (${tc.fileAfter.length} chars) -----\n` +
    `${tc.fileAfter}\n` +
    `----- DIFF (before → after) -----\n` +
    `${tc.diff || "(no change)\n"}`
  );
}

export function renderToolCallAsText(
  tc: ToolCallRecord,
  context: { suite: string; caseName: string; modelLabel: string },
): string {
  return (
    `${hr("=")}\n` +
    `Suite:     ${context.suite}\n` +
    `Case:      ${context.caseName}\n` +
    `Model:     ${context.modelLabel}\n` +
    `${hr("=")}\n` +
    `\n` +
    formatToolCall(tc)
  );
}

export function renderEvalRunAsText(record: EvalRunRecord): string {
  const lines: string[] = [];
  lines.push(hr("="));
  lines.push(`Suite:     ${record.suite}`);
  lines.push(`Case:      ${record.caseName}`);
  lines.push(
    `Model:     ${record.model.label} ` +
      `[${record.model.provider}/${record.model.modelName}]` +
      (record.model.responseModelId
        ? ` → ${record.model.responseModelId}`
        : ""),
  );
  lines.push(`Timestamp: ${record.timestamp}`);
  lines.push(`Passed:    ${record.passed}`);
  if (record.errorMessage) {
    lines.push(`Error:     ${record.errorMessage}`);
  }
  lines.push(hr("="));
  lines.push("");

  lines.push("LLM");
  lines.push(`  Total duration: ${record.llm.totalDurationMs}ms`);
  lines.push(`  Requests:       ${record.llm.requestCount}`);
  lines.push(`  Total tokens:   ${formatUsage(record.llm.totalUsage)}`);
  for (const req of record.llm.requests) {
    lines.push(
      `    step ${req.stepIndex}: ${req.durationMs}ms, ` +
        `${formatUsage(req.usage)}, finish=${req.finishReason ?? "?"}`,
    );
  }
  lines.push("");

  lines.push(`Tool calls (${record.toolCalls.length})`);
  lines.push("");
  for (const tc of record.toolCalls) {
    lines.push(formatToolCall(tc));
  }

  lines.push(hr("="));
  lines.push("Diff (original → final)");
  lines.push(hr("="));
  if (record.diff) {
    lines.push(record.diff);
  } else {
    lines.push("(no change)");
    lines.push("");
  }

  if (record.judge) {
    lines.push(hr("="));
    lines.push("Judge");
    lines.push(`  Identity: ${record.judge.label} [${record.judge.modelName}]`);
    lines.push(`  Duration: ${record.judge.durationMs}ms`);
    lines.push(`  Tokens:   ${formatUsage(record.judge.usage)}`);
    lines.push(`  Verdict:  ${record.judge.pass ? "PASS" : "FAIL"}`);
    lines.push(`  Explanation:`);
    for (const line of record.judge.explanation.split("\n")) {
      lines.push(`    ${line}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function recordEvalRun(record: EvalRunRecord): void {
  const runDirName =
    `${fsTimestamp(RUN_START_TIMESTAMP)}__${sanitize(record.model.label)}`;
  const recordDir = resolve(
    RESULTS_ROOT,
    sanitize(record.suite),
    runDirName,
    sanitize(record.caseName),
  );
  mkdirSync(recordDir, { recursive: true });

  writeFileSync(
    resolve(recordDir, "record.json"),
    JSON.stringify(record, null, 2) + "\n",
  );

  writeFileSync(
    resolve(recordDir, "record.txt"),
    renderEvalRunAsText(record),
  );

  if (record.toolCalls.length > 0) {
    const toolCallsDir = resolve(recordDir, "tool_calls");
    mkdirSync(toolCallsDir, { recursive: true });
    const padWidth = Math.max(2, String(record.toolCalls.length).length);
    for (const tc of record.toolCalls) {
      const base = String(tc.index + 1).padStart(padWidth, "0");

      // Combined summary (easy to scan in one file).
      writeFileSync(
        resolve(toolCallsDir, `${base}.txt`),
        renderToolCallAsText(tc, {
          suite: record.suite,
          caseName: record.caseName,
          modelLabel: record.model.label,
        }),
      );

      // Split views for easy per-piece inspection. Each file contains
      // the raw content — no headers — so it can be opened in an editor
      // with syntax highlighting matching the source file's extension.
      const splitDir = resolve(toolCallsDir, base);
      mkdirSync(splitDir, { recursive: true });
      const ext = extensionFor(tc.filePath);
      writeFileSync(resolve(splitDir, `old_string${ext}`), tc.oldString);
      writeFileSync(resolve(splitDir, `new_string${ext}`), tc.newString);
      writeFileSync(resolve(splitDir, `file_before${ext}`), tc.fileBefore);
      writeFileSync(resolve(splitDir, `file_after${ext}`), tc.fileAfter);
      writeFileSync(resolve(splitDir, "diff.patch"), tc.diff || "");
      writeFileSync(
        resolve(splitDir, "meta.txt"),
        `index:     ${tc.index + 1}\n` +
          `tool:      ${tc.toolName}\n` +
          `timestamp: ${tc.timestamp}\n` +
          `file_path: ${tc.filePath}\n` +
          `old_string: ${tc.oldString.length} chars\n` +
          `new_string: ${tc.newString.length} chars\n` +
          `file_before: ${tc.fileBefore.length} chars\n` +
          `file_after: ${tc.fileAfter.length} chars\n`,
      );
    }
  }
}

function extensionFor(filePath: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(filePath);
  return match ? match[0] : ".txt";
}
