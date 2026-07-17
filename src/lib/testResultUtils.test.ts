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

  it("does not use duplicate titles with different lines as coverage", () => {
    const duplicateKnownTests: TestCase[] = [
      { title: "saves settings", line: 10 },
      { title: "saves settings", line: 20 },
    ];

    const result = buildSingleTestFileResult({
      file,
      knownTests: duplicateKnownTests,
      previous: undefined,
      incoming: resultFor("saves settings", 10, "passed"),
    });

    expect(result.status).toBe("partial");
    expect(result.tests).toHaveLength(1);
  });

  it("replaces an unambiguous same-title result when its line moves", () => {
    const result = buildSingleTestFileResult({
      file,
      knownTests: [{ title: "signs in", line: 14 }],
      previous: resultFor("signs in", 10, "failed"),
      incoming: resultFor("signs in", 14, "passed"),
    });

    expect(result.status).toBe("passed");
    expect(result.tests).toEqual([
      expect.objectContaining({
        title: "signs in",
        line: 14,
        status: "passed",
      }),
    ]);
  });

  it("keeps duplicate titles distinct when one line changes", () => {
    const previous: TestResult = {
      file,
      status: "failed",
      tests: [
        { title: "saves settings", line: 10, status: "failed" },
        { title: "saves settings", line: 20, status: "passed" },
      ],
    };
    const result = buildSingleTestFileResult({
      file,
      knownTests: [
        { title: "saves settings", line: 12 },
        { title: "saves settings", line: 20 },
      ],
      previous,
      incoming: resultFor("saves settings", 12, "passed"),
    });

    expect(result.tests).toHaveLength(3);
    expect(result.tests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 10, status: "failed" }),
        expect.objectContaining({ line: 12, status: "passed" }),
        expect.objectContaining({ line: 20, status: "passed" }),
      ]),
    );
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
