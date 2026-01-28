import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import {
  parseDslTestCases,
  isPassingTestCase,
  isFailingTestCase,
} from "@/pro/main/ipc/processors/search_replace_dsl_test_runner";

// Load test case files
const passesContent = readFileSync(
  join(__dirname, "search_replace_passes.txt"),
  "utf-8",
);
const failsContent = readFileSync(
  join(__dirname, "search_replace_fails.txt"),
  "utf-8",
);

const passingTestCases =
  parseDslTestCases(passesContent).filter(isPassingTestCase);
const failingTestCases =
  parseDslTestCases(failsContent).filter(isFailingTestCase);

describe("search_replace_processor - DSL passing tests", () => {
  it.each(passingTestCases.map((tc) => [tc.name, tc]))(
    "%s",
    (_name, testCase) => {
      if (!isPassingTestCase(testCase)) {
        throw new Error("Expected passing test case");
      }
      const { success, content, error } = applySearchReplace(
        testCase.original,
        testCase.diff,
      );
      expect(success).toBe(true);
      if (error) {
        throw new Error(`Unexpected error: ${error}`);
      }
      expect(content).toBe(testCase.expectedOutput);
    },
  );
});

describe("search_replace_processor - DSL failing tests", () => {
  it.each(failingTestCases.map((tc) => [tc.name, tc]))(
    "%s",
    (_name, testCase) => {
      if (!isFailingTestCase(testCase)) {
        throw new Error("Expected failing test case");
      }
      const { success, error } = applySearchReplace(
        testCase.original,
        testCase.diff,
      );
      expect(success).toBe(false);
      expect(error).toBeDefined();
      expect(error).toMatch(testCase.errorPattern);
    },
  );
});
