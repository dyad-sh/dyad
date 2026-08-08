import { mkdir, writeFile } from "node:fs/promises";
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
  // Raw tool input arguments, keyed by the tool's parameter names
  // (e.g. `old_string`/`new_string` for search_replace, `content` for
  // write_file).
  args: Record<string, unknown>;
  fileBefore: string;
  fileAfter: string;
  // Unified diff from fileBefore → fileAfter for this single call.
  // Empty string when the call did not change the file.
  diff: string;
  // Whether the tool call completed successfully. Failed calls still get
  // recorded so the tool-call log reflects what the model actually tried,
  // not just what succeeded.
  succeeded: boolean;
  // Error message when succeeded=false; null otherwise.
  error: string | null;
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
  prompt: {
    system: string;
    // Plain edit instructions for the case, without the file content
    // spliced in. Handy for skimming what the model was asked to do.
    instructions: string;
    // Full user-message content actually sent to the model (typically
    // the file contents followed by the instructions).
    user: string;
  };
  file: {
    name: string;
    before: string;
    after: string;
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

function stringifyArg(value: unknown): { text: string; length: number } {
  if (typeof value === "string") {
    return { text: value, length: value.length };
  }
  const text = JSON.stringify(value, null, 2) ?? String(value);
  return { text, length: text.length };
}

function formatToolCall(tc: ToolCallRecord): string {
  const parts: string[] = [];
  parts.push(hr("-"));
  const status = tc.succeeded ? "" : " [FAILED]";
  parts.push(`Tool call #${tc.index + 1} (${tc.toolName})${status}`);
  parts.push(`Timestamp: ${tc.timestamp}`);
  parts.push(`File:      ${tc.filePath}`);
  if (!tc.succeeded && tc.error) {
    parts.push(`Error:     ${tc.error}`);
  }
  parts.push("");
  for (const [key, value] of Object.entries(tc.args)) {
    const { text, length } = stringifyArg(value);
    parts.push(`----- ${key.toUpperCase()} (${length} chars) -----`);
    parts.push(text);
  }
  parts.push(`----- FILE BEFORE (${tc.fileBefore.length} chars) -----`);
  parts.push(tc.fileBefore);
  parts.push(`----- FILE AFTER (${tc.fileAfter.length} chars) -----`);
  parts.push(tc.fileAfter);
  parts.push(`----- DIFF (before → after) -----`);
  parts.push(tc.diff || "(no change)");
  return parts.join("\n") + "\n";
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

  lines.push("System prompt");
  lines.push(hr("-"));
  lines.push(record.prompt.system);
  lines.push("");
  lines.push("Instructions");
  lines.push(hr("-"));
  lines.push(record.prompt.instructions);
  lines.push("");
  lines.push("User prompt (full)");
  lines.push(hr("-"));
  lines.push(record.prompt.user);
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

export function recordDirFor(
  suite: string,
  caseName: string,
  modelLabel: string,
): string {
  const runDirName = `${fsTimestamp(RUN_START_TIMESTAMP)}__${sanitize(modelLabel)}`;
  return resolve(RESULTS_ROOT, sanitize(suite), runDirName, sanitize(caseName));
}

export async function recordEvalRun(record: EvalRunRecord): Promise<void> {
  const recordDir = recordDirFor(
    record.suite,
    record.caseName,
    record.model.label,
  );
  await mkdir(recordDir, { recursive: true });

  const writes: Promise<void>[] = [
    writeFile(
      resolve(recordDir, "record.json"),
      JSON.stringify(record, null, 2) + "\n",
    ),
    writeFile(resolve(recordDir, "record.txt"), renderEvalRunAsText(record)),
    writeDetailsFolder(recordDir, record),
  ];

  if (record.toolCalls.length > 0) {
    writes.push(writeToolCallsFolder(recordDir, record));
  }

  await Promise.all(writes);
}

async function writeToolCallsFolder(
  recordDir: string,
  record: EvalRunRecord,
): Promise<void> {
  const toolCallsDir = resolve(recordDir, "tool_calls");
  await mkdir(toolCallsDir, { recursive: true });
  const padWidth = Math.max(2, String(record.toolCalls.length).length);

  await Promise.all(
    record.toolCalls.map(async (tc) => {
      const base = String(tc.index + 1).padStart(padWidth, "0");

      // Combined summary (easy to scan in one file).
      const summaryWrite = writeFile(
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
      await mkdir(splitDir, { recursive: true });
      const ext = extensionFor(tc.filePath);

      const argLengths: string[] = [];
      const argWrites: Promise<void>[] = [];
      // One file per argument. Strings use the target file's extension so
      // they open with matching syntax highlighting; non-strings become
      // JSON blobs.
      for (const [key, value] of Object.entries(tc.args)) {
        const { text, length } = stringifyArg(value);
        const argExt = typeof value === "string" ? ext : ".json";
        argWrites.push(writeFile(resolve(splitDir, `${key}${argExt}`), text));
        argLengths.push(`${key}: ${length} chars`);
      }

      await Promise.all([
        summaryWrite,
        writeFile(resolve(splitDir, `file_before${ext}`), tc.fileBefore),
        writeFile(resolve(splitDir, `file_after${ext}`), tc.fileAfter),
        writeFile(resolve(splitDir, "diff.patch"), tc.diff || ""),
        ...argWrites,
        writeFile(
          resolve(splitDir, "meta.txt"),
          `index:     ${tc.index + 1}\n` +
            `tool:      ${tc.toolName}\n` +
            `timestamp: ${tc.timestamp}\n` +
            `file_path: ${tc.filePath}\n` +
            `succeeded: ${tc.succeeded}\n` +
            (tc.succeeded ? "" : `error:     ${tc.error ?? ""}\n`) +
            argLengths.map((l) => `${l}\n`).join("") +
            `file_before: ${tc.fileBefore.length} chars\n` +
            `file_after: ${tc.fileAfter.length} chars\n`,
        ),
      ]);
    }),
  );
}

async function writeDetailsFolder(
  recordDir: string,
  record: EvalRunRecord,
): Promise<void> {
  const detailsDir = resolve(recordDir, "details");
  await mkdir(detailsDir, { recursive: true });
  const ext = extensionFor(record.file.name);

  // Metadata mirrors the main record but drops the large content blobs
  // that already have their own files (file_before, file_after, overall
  // diff) and the per-tool-call details (tool_calls/ folder has them).
  const metadata = {
    timestamp: record.timestamp,
    suite: record.suite,
    caseName: record.caseName,
    model: record.model,
    prompt: record.prompt,
    file: { name: record.file.name },
    llm: record.llm,
    toolCallCount: record.toolCalls.length,
    judge: record.judge,
    passed: record.passed,
    errorMessage: record.errorMessage,
  };

  await Promise.all([
    writeFile(resolve(detailsDir, `file_before${ext}`), record.file.before),
    writeFile(resolve(detailsDir, `file_after${ext}`), record.file.after),
    writeFile(resolve(detailsDir, "diff.patch"), record.diff || ""),
    writeFile(resolve(detailsDir, "system_prompt.txt"), record.prompt.system),
    writeFile(
      resolve(detailsDir, "instructions.txt"),
      record.prompt.instructions,
    ),
    writeFile(resolve(detailsDir, "user_prompt.txt"), record.prompt.user),
    writeFile(
      resolve(detailsDir, "metadata.json"),
      JSON.stringify(metadata, null, 2) + "\n",
    ),
    writeFile(
      resolve(detailsDir, "metadata.txt"),
      renderMetadataAsText(metadata),
    ),
  ]);
}

function renderMetadataAsText(m: {
  timestamp: string;
  suite: string;
  caseName: string;
  model: EvalRunRecord["model"];
  prompt: EvalRunRecord["prompt"];
  file: { name: string };
  llm: EvalRunRecord["llm"];
  toolCallCount: number;
  judge: JudgeRecord | null;
  passed: boolean;
  errorMessage: string | null;
}): string {
  const lines: string[] = [];
  lines.push(hr("="));
  lines.push(`Suite:     ${m.suite}`);
  lines.push(`Case:      ${m.caseName}`);
  lines.push(`File:      ${m.file.name}`);
  lines.push(
    `Model:     ${m.model.label} ` +
      `[${m.model.provider}/${m.model.modelName}]` +
      (m.model.responseModelId ? ` → ${m.model.responseModelId}` : ""),
  );
  lines.push(`Timestamp: ${m.timestamp}`);
  lines.push(`Passed:    ${m.passed}`);
  if (m.errorMessage) lines.push(`Error:     ${m.errorMessage}`);
  lines.push(hr("="));
  lines.push("");

  lines.push("LLM");
  lines.push(`  Total duration: ${m.llm.totalDurationMs}ms`);
  lines.push(`  Requests:       ${m.llm.requestCount}`);
  lines.push(`  Total tokens:   ${formatUsage(m.llm.totalUsage)}`);
  for (const req of m.llm.requests) {
    lines.push(
      `    step ${req.stepIndex}: ${req.durationMs}ms, ` +
        `${formatUsage(req.usage)}, finish=${req.finishReason ?? "?"}`,
    );
  }
  lines.push("");
  lines.push(`Tool call count: ${m.toolCallCount}`);
  lines.push("");

  lines.push("System prompt");
  lines.push(hr("-"));
  lines.push(m.prompt.system);
  lines.push("");
  lines.push("Instructions");
  lines.push(hr("-"));
  lines.push(m.prompt.instructions);
  lines.push("");

  if (m.judge) {
    lines.push(hr("="));
    lines.push("Judge");
    lines.push(`  Identity: ${m.judge.label} [${m.judge.modelName}]`);
    lines.push(`  Provider: ${m.judge.provider}`);
    lines.push(`  Duration: ${m.judge.durationMs}ms`);
    lines.push(`  Tokens:   ${formatUsage(m.judge.usage)}`);
    lines.push(`  Verdict:  ${m.judge.pass ? "PASS" : "FAIL"}`);
    lines.push(`  Explanation:`);
    for (const line of m.judge.explanation.split("\n")) {
      lines.push(`    ${line}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function extensionFor(filePath: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(filePath);
  return match ? match[0] : ".txt";
}
