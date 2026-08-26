/**
 * Replays real search_replace tool calls recorded from eval runs.
 *
 * The calls in `recorded_calls/<model>/` are the operations strings the tool
 * builds from the model's raw arguments, captured verbatim. Each case starts
 * from a fixture that already lives in `fixtures/`, so replaying the calls in
 * order reconstructs the edit session without needing an API key or the
 * (gitignored) eval-results directory.
 *
 * Every applied call should produce exactly what replacing the first verbatim
 * occurrence of old_string with new_string produces. That is the whole contract
 * of the tool, and it is what a trailing newline in the model's arguments used
 * to break: the phantom empty line showed up in the file as a stray blank line,
 * so the output no longer matched a plain text replacement.
 *
 * Both the current processor and the frozen pre-fix copy are replayed, which
 * pins the measurement in CI rather than leaving it as a claim. Set
 * SEARCH_REPLACE_IMPL=current or =legacy to replay only one of them.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { applySearchReplace as legacyApplySearchReplace } from "./helpers/legacy_search_replace";
import { parseSearchReplaceBlocks } from "@/pro/shared/search_replace_parser";

const CALLS_DIR = resolve(__dirname, "recorded_calls");
const FIXTURES_DIR = resolve(__dirname, "fixtures");

function normalizeNewlines(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function readRecordedText(path: string): string {
  return normalizeNewlines(readFileSync(path, "utf8"));
}

interface RecordedCase {
  case: string;
  fixture: string;
  calls: string[];
}

interface RecordedModel {
  label: string;
  cases: RecordedCase[];
}

const manifest: Record<string, RecordedModel> = JSON.parse(
  readFileSync(resolve(CALLS_DIR, "manifest.json"), "utf8"),
);

/** Replace the first verbatim occurrence, or null if old_string is not present. */
function literalReplace(
  content: string,
  oldString: string,
  newString: string,
): string | null {
  const index = content.indexOf(oldString);
  if (index < 0) return null;
  return (
    content.slice(0, index) +
    newString +
    content.slice(index + oldString.length)
  );
}

interface ReplayTotals {
  applied: number;
  didNotMatch: number;
  strayBlankLines: number;
  newlineTerminated: number;
}

function replayModel(
  modelDir: string,
  apply: typeof applySearchReplace,
  onApplied?: (label: string, actual: string, expected: string | null) => void,
): ReplayTotals {
  const totals: ReplayTotals = {
    applied: 0,
    didNotMatch: 0,
    strayBlankLines: 0,
    newlineTerminated: 0,
  };

  for (const entry of manifest[modelDir].cases) {
    let content = readRecordedText(resolve(FIXTURES_DIR, entry.fixture));

    for (const callFile of entry.calls) {
      const operations = readRecordedText(
        resolve(CALLS_DIR, modelDir, entry.case, callFile),
      );
      const [block] = parseSearchReplaceBlocks(operations);
      expect(block, `${callFile} should parse into one block`).toBeDefined();

      const result = apply(content, operations);
      if (!result.success || typeof result.content !== "string") {
        // The model retried these; they change nothing, so the replay moves on.
        totals.didNotMatch++;
        continue;
      }

      totals.applied++;
      if (block.searchContent.endsWith("\n")) totals.newlineTerminated++;

      const expected = literalReplace(
        content,
        block.searchContent,
        block.replaceContent,
      );
      if (expected !== null && result.content !== expected) {
        totals.strayBlankLines++;
      }
      onApplied?.(
        `${modelDir}/${entry.case}/${callFile}`,
        result.content,
        expected,
      );

      content = result.content;
    }
  }

  return totals;
}

/**
 * Totals each model's recordings produce. The legacy column is what the
 * recordings originally caught; the current column is what the fix leaves.
 * The applied count rises under the fix because some calls could not match
 * while a stray blank line from an earlier call was shifting their context.
 */
const EXPECTED = {
  sol: {
    current: { applied: 11, didNotMatch: 5, strayBlankLines: 0 },
    legacy: { applied: 9, didNotMatch: 7, strayBlankLines: 7 },
    minNewlineTerminated: 7,
  },
  luna: {
    current: { applied: 5, didNotMatch: 0, strayBlankLines: 0 },
    legacy: { applied: 5, didNotMatch: 0, strayBlankLines: 2 },
    minNewlineTerminated: 3,
  },
};

const only = process.env.SEARCH_REPLACE_IMPL;
const runCurrent = only !== "legacy";
const runLegacy = only !== "current";

describe("recorded search_replace calls", () => {
  it("normalizes platform line endings before replay", () => {
    expect(normalizeNewlines("first\nsecond\n")).toBe("first\nsecond\n");
    expect(normalizeNewlines("first\r\nsecond\r\n")).toBe("first\nsecond\n");
  });

  for (const [modelDir, expected] of Object.entries(EXPECTED)) {
    const label = manifest[modelDir].label;

    describe(label, () => {
      it.runIf(runCurrent)(
        "current processor matches a plain text replacement",
        () => {
          const totals = replayModel(
            modelDir,
            applySearchReplace,
            (name, actual, expectedContent) => {
              expect(
                expectedContent,
                `${name}: old_string should appear verbatim`,
              ).not.toBeNull();
              expect(
                actual,
                `${name} should match a plain text replacement`,
              ).toBe(expectedContent);
            },
          );

          expect(totals.applied).toBe(expected.current.applied);
          expect(totals.didNotMatch).toBe(expected.current.didNotMatch);
          expect(totals.strayBlankLines).toBe(expected.current.strayBlankLines);
        },
      );

      it.runIf(runLegacy)("pre-fix processor wrote stray blank lines", () => {
        const totals = replayModel(modelDir, legacyApplySearchReplace);

        expect(totals.applied).toBe(expected.legacy.applied);
        expect(totals.didNotMatch).toBe(expected.legacy.didNotMatch);
        expect(totals.strayBlankLines).toBe(expected.legacy.strayBlankLines);
      });

      it("recordings still carry newline-terminated arguments", () => {
        // Guards the fixtures: if a future edit strips the trailing newlines
        // out of these recordings they stop covering the case they exist for,
        // and the assertions above would pass without testing anything.
        const totals = replayModel(modelDir, applySearchReplace);
        expect(totals.newlineTerminated).toBeGreaterThanOrEqual(
          expected.minNewlineTerminated,
        );
      });
    });
  }
});
