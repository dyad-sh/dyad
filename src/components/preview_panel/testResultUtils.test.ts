import { describe, expect, it } from "vitest";
import type { TestCase, TestResult } from "@/ipc/types";
import {
  buildSingleTestFileResult,
  reconcileResultFile,
} from "./testResultUtils";

const file = "tests/auth.spec.ts";
const knownTests: TestCase[] = [
  { title: "signs in", line: 10 },
  { title: "signs out", line: 20 },
];

function resultFor(
  title: string,
  line: number,
  status: TestResult["status"],
): TestResult {
  return {
    file,
    status,
    tests: [{ title, line, status }],
  };
}

describe("buildSingleTestFileResult", () => {
  it("marks first-time passing single-test runs as partial", () => {
    const result = buildSingleTestFileResult({
      file,
      knownTests,
      previous: undefined,
      incoming: resultFor("signs in", 10, "passed"),
    });

    expect(result.status).toBe("partial");
    expect(result.tests).toHaveLength(1);
  });

  it("keeps a failing single-test run visible at the file level", () => {
    const result = buildSingleTestFileResult({
      file,
      knownTests,
      previous: undefined,
      incoming: resultFor("signs in", 10, "failed"),
    });

    expect(result.status).toBe("failed");
  });

  it("promotes partial results to passed once every known case has passed", () => {
    const first = buildSingleTestFileResult({
      file,
      knownTests,
      previous: undefined,
      incoming: resultFor("signs in", 10, "passed"),
    });

    const second = buildSingleTestFileResult({
      file,
      knownTests,
      previous: first,
      incoming: resultFor("signs out", 20, "passed"),
    });

    expect(second.status).toBe("passed");
    expect(second.tests).toHaveLength(2);
  });
});

describe("reconcileResultFile", () => {
  it("does not suffix-match substring file names", () => {
    expect(
      reconcileResultFile("auth.spec.ts", [
        "tests/auth.spec.ts",
        "tests/google-auth.spec.ts",
      ]),
    ).toBe("tests/auth.spec.ts");
  });
});
