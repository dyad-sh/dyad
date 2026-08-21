/**
 * Newline probe for the search_replace tool.
 *
 * Question this answers: do real models send `new_string` (or `old_string`)
 * with a trailing newline, and when they do, does the current serialization
 * write a stray blank line into the file?
 *
 * Background: the tool builds its operations string by joining the raw args
 * with newline delimiters —
 *
 *     `<<<<<<< SEARCH\n${old}\n=======\n${new}\n>>>>>>> REPLACE`
 *
 * so a newline that merely *terminates* `new_string` becomes a trailing empty
 * line in the parsed replace block, and that empty line is written to the file.
 *
 * Rather than assert a guess about how often this happens, every search_replace
 * call is applied twice: once with the current serialization and once with a
 * candidate fix. Calls where the two disagree are exactly the calls the bug
 * fires on — and, equivalently, exactly the calls the fix would change. A run
 * with zero disagreements means the defect is unreachable for that model on
 * those cases AND that the fix is a no-op on real traffic.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { escapeSearchReplaceMarkers } from "@/pro/shared/search_replace_markers";
import { createUnifiedDiff } from "./unified_diff";

const RESULTS_ROOT = resolve(__dirname, "../../../../eval-results");

export interface NewlineProbeSample {
  suite: string;
  model: string;
  caseName: string;
  callIndex: number;
  filePath: string;
  oldEndsWithNewline: boolean;
  newEndsWithNewline: boolean;
  /** Blank lines in the file after the edit, minus blank lines before it. */
  blankLineDelta: number;
  /** True when current and fixed serialization produce different files. */
  differsUnderFix: boolean;
  /** True when the counterfactual could not be applied, so nothing is proven. */
  undetermined: boolean;
  /** Unified diff of current-vs-fixed output. Empty when identical. */
  currentVsFixedDiff: string;
  oldString: string;
  newString: string;
}

const samples: NewlineProbeSample[] = [];

/**
 * Calls that never applied (bad match, ambiguous search, wrong file). They
 * wrote nothing, so they cannot be corrupted — but they are counted so the
 * summary reconciles with the tool-call totals in the run log instead of
 * looking like the probe silently dropped data.
 */
const failures: Array<{ model: string; caseName: string; error: string }> = [];

export function recordFailedSearchReplaceCall(input: {
  model: string;
  caseName: string;
  error: string;
}): void {
  failures.push(input);
}

/** Current production serialization (search_replace.ts). */
export function serializeCurrent(oldString: string, newString: string): string {
  const escapedOld = escapeSearchReplaceMarkers(oldString);
  const escapedNew = escapeSearchReplaceMarkers(newString);
  return `<<<<<<< SEARCH\n${escapedOld}\n=======\n${escapedNew}\n>>>>>>> REPLACE`;
}

const trimOneNewline = (s: string) => s.replace(/\r?\n$/, "");

/**
 * Candidate fix, ASYMMETRIC case only: drop a newline that merely terminates
 * `new_string` when `old_string` is not itself newline-terminated. Matching
 * input is never modified.
 *
 * NOTE: by construction this leaves symmetric calls (both args terminated)
 * completely unchanged, so on its own it CANNOT detect the symmetric
 * corruption case. Use `serializeFixedFull` for detection; this is kept
 * because it is the exact shape of the tool-level fix.
 */
export function serializeFixed(oldString: string, newString: string): string {
  const normalizedNew = oldString.endsWith("\n")
    ? newString
    : trimOneNewline(newString);
  const escapedOld = escapeSearchReplaceMarkers(oldString);
  const escapedNew = escapeSearchReplaceMarkers(normalizedNew);
  return `<<<<<<< SEARCH\n${escapedOld}\n=======\n${escapedNew}\n>>>>>>> REPLACE`;
}

/**
 * Candidate fix covering BOTH corrupting shapes.
 *
 * - Asymmetric (`new_string` terminated, `old_string` not): drop the
 *   terminator from the replace side.
 * - Symmetric (both terminated): trim the terminator from both. When the file
 *   really does have a blank line there, this is a no-op — the current form
 *   consumes and re-emits it, this form never touches it, and both produce
 *   identical output. When the file does NOT, the current form emits a stray
 *   blank line (the processor's trimEmptyLines fallback rescues the search
 *   side but nothing trims the replace side) and the two diverge.
 *
 * This is the detector. It is deliberately more aggressive than the shipped
 * fix would be: trimming `old_string` can in principle turn a unique match
 * ambiguous, which is why a failure to apply is reported as *undetermined*
 * rather than silently counted as "not corrupted".
 */
export function serializeFixedFull(
  oldString: string,
  newString: string,
): string {
  const o = oldString.endsWith("\n") ? trimOneNewline(oldString) : oldString;
  const n = trimOneNewline(newString);
  const escapedOld = escapeSearchReplaceMarkers(o);
  const escapedNew = escapeSearchReplaceMarkers(n);
  return `<<<<<<< SEARCH\n${escapedOld}\n=======\n${escapedNew}\n>>>>>>> REPLACE`;
}

function countBlankLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim() === "").length;
}

/**
 * Record one search_replace call. Never throws — a probe failure must not fail
 * the eval it is observing.
 */
export function recordSearchReplaceCall(input: {
  suite: string;
  model: string;
  caseName: string;
  callIndex: number;
  filePath: string;
  oldString: string;
  newString: string;
  fileBefore: string;
  fileAfter: string;
}): void {
  try {
    const fixed = applySearchReplace(
      input.fileBefore,
      serializeFixedFull(input.oldString, input.newString),
    );
    const fixedContent = fixed.success ? (fixed.content ?? null) : null;
    // A counterfactual that fails to apply proves nothing either way; count it
    // as undetermined rather than folding it into the clean bucket.
    const undetermined = fixedContent === null;
    const differsUnderFix = !undetermined && fixedContent !== input.fileAfter;

    samples.push({
      suite: input.suite,
      model: input.model,
      caseName: input.caseName,
      callIndex: input.callIndex,
      filePath: input.filePath,
      oldEndsWithNewline: input.oldString.endsWith("\n"),
      newEndsWithNewline: input.newString.endsWith("\n"),
      blankLineDelta:
        countBlankLines(input.fileAfter) - countBlankLines(input.fileBefore),
      undetermined,
      differsUnderFix,
      currentVsFixedDiff: differsUnderFix
        ? createUnifiedDiff(input.fileAfter, fixedContent!, {
            oldLabel: "current",
            newLabel: "fixed",
          })
        : "",
      oldString: input.oldString,
      newString: input.newString,
    });
  } catch {
    // Probe is observational only.
  }
}

export function getNewlineProbeSamples(): NewlineProbeSample[] {
  return samples;
}

export function renderNewlineProbeSummary(): string {
  if (samples.length === 0) {
    return "Newline probe: no search_replace calls recorded.";
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("=".repeat(72));
  lines.push("NEWLINE PROBE — search_replace trailing-newline behavior");
  lines.push("=".repeat(72));

  const byModel = new Map<string, NewlineProbeSample[]>();
  for (const s of samples) {
    const list = byModel.get(s.model) ?? [];
    list.push(s);
    byModel.set(s.model, list);
  }

  for (const [model, list] of byModel) {
    const newTrailing = list.filter((s) => s.newEndsWithNewline);
    const oldTrailing = list.filter((s) => s.oldEndsWithNewline);
    const differing = list.filter((s) => s.differsUnderFix);

    const failedForModel = failures.filter((f) => f.model === model);

    lines.push("");
    lines.push(
      `${model} — ${list.length} applied search_replace calls` +
        (failedForModel.length > 0
          ? `, plus ${failedForModel.length} that never applied (not analyzable)`
          : ""),
    );
    const symmetric = list.filter(
      (s) => s.oldEndsWithNewline && s.newEndsWithNewline,
    );
    const newOnly = list.filter(
      (s) => s.newEndsWithNewline && !s.oldEndsWithNewline,
    );
    const undet = list.filter((s) => s.undetermined);

    lines.push(
      `  new_string ends with newline: ${newTrailing.length} (${pct(newTrailing.length, list.length)})`,
    );
    lines.push(
      `  old_string ends with newline: ${oldTrailing.length} (${pct(oldTrailing.length, list.length)})`,
    );
    lines.push(
      `    of which symmetric (both):  ${symmetric.length}   new-only: ${newOnly.length}`,
    );
    lines.push(
      `  CORRUPTED (current output != fixed output): ${differing.length} (${pct(differing.length, list.length)})`,
    );
    lines.push(
      `    corrupted symmetric: ${differing.filter((s) => s.oldEndsWithNewline).length}` +
        `   corrupted new-only: ${differing.filter((s) => !s.oldEndsWithNewline).length}`,
    );
    if (undet.length > 0) {
      lines.push(
        `  UNDETERMINED (counterfactual would not apply): ${undet.length}`,
      );
    }

    for (const s of differing) {
      lines.push("");
      lines.push(`  --- ${s.caseName} / ${s.suite} / call #${s.callIndex + 1}`);
      lines.push(
        `      old ends with \\n: ${s.oldEndsWithNewline}   new ends with \\n: ${s.newEndsWithNewline}`,
      );
      lines.push(
        s.currentVsFixedDiff
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    }
  }

  const totalDiffering = samples.filter((s) => s.differsUnderFix).length;
  lines.push("");
  lines.push("-".repeat(72));
  lines.push(
    totalDiffering === 0
      ? "VERDICT: no divergence. Either the triggering arg shape did not occur " +
          "on this traffic, or the shipped processor already handles it - which " +
          "is the expected result now that the fallback trims the replace side. " +
          "A non-zero count on a later run means that handling regressed."
      : `VERDICT: ${totalDiffering} of ${samples.length} calls diverge from the ` +
          `counterfactual. Each diff above is a stray blank line reaching a real file.`,
  );
  lines.push("-".repeat(72));
  lines.push("");
  return lines.join("\n");
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

export async function writeNewlineProbeReport(): Promise<string | null> {
  if (samples.length === 0) return null;
  const dir = resolve(RESULTS_ROOT, "newline_probe");
  await mkdir(dir, { recursive: true });

  // Accumulate across runs. Each `npm run eval` is a fresh process, so without
  // merging, a second run silently discards the first run's evidence — and
  // this defect needs a sample built up over several runs to say anything.
  const samplesPath = resolve(dir, "samples.json");
  let previous: NewlineProbeSample[] = [];
  try {
    previous = JSON.parse(await readFile(samplesPath, "utf8"));
    if (!Array.isArray(previous)) previous = [];
  } catch {
    previous = [];
  }

  await writeFile(
    samplesPath,
    JSON.stringify([...previous, ...samples], null, 2),
  );
  await writeFile(resolve(dir, "summary.txt"), renderNewlineProbeSummary());
  return dir;
}
