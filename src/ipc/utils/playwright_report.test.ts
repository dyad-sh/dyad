import { describe, expect, it } from "vitest";
import {
  classifyErrorText,
  parsePlaywrightReport,
  type PwReport,
} from "./playwright_report";

describe("classifyErrorText", () => {
  it("classifies timeouts / selector failures as infra", () => {
    expect(
      classifyErrorText("Timed out 5000ms waiting for locator('text=Hi')"),
    ).toBe("infra");
    expect(classifyErrorText("strict mode violation: 2 elements")).toBe(
      "infra",
    );
    expect(
      classifyErrorText("browserType.launch: Executable doesn't exist"),
    ).toBe("infra");
    expect(classifyErrorText("net::ERR_CONNECTION_REFUSED")).toBe("infra");
  });

  it("classifies assertion failures as assertion", () => {
    expect(
      classifyErrorText("expect(received).toBe(expected)\n\nExpected: 5"),
    ).toBe("assertion");
  });

  it("defaults to assertion when no error text", () => {
    expect(classifyErrorText(undefined)).toBe("assertion");
  });
});

function specResult(
  file: string,
  status: string,
  errorMessage?: string,
): PwReport["suites"] {
  return [
    {
      file,
      specs: [
        {
          file,
          title: "a test",
          line: 3,
          tests: [
            {
              results: [
                {
                  status,
                  duration: 1000,
                  error: errorMessage ? { message: errorMessage } : undefined,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

describe("parsePlaywrightReport", () => {
  const appPath = "/apps/my-app";

  it("maps passing specs to passed", () => {
    const report: PwReport = {
      suites: specResult("tests/a.spec.ts", "passed"),
    };
    const results = parsePlaywrightReport(report, appPath);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      file: "tests/a.spec.ts",
      status: "passed",
      durationMs: 1000,
    });
    // Per-test detail is preserved alongside the file-level rollup.
    expect(results[0].tests).toEqual([
      { title: "a test", line: 3, status: "passed", durationMs: 1000 },
    ]);
  });

  it("maps assertion failures to failed (red)", () => {
    const report: PwReport = {
      suites: specResult(
        "tests/a.spec.ts",
        "failed",
        "expect(received).toBe(expected)",
      ),
    };
    const [result] = parsePlaywrightReport(report, appPath);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("expect(");
  });

  it("maps selector/timeout failures to inconclusive (amber)", () => {
    const report: PwReport = {
      suites: specResult(
        "tests/a.spec.ts",
        "failed",
        "Timed out 5000ms waiting for locator",
      ),
    };
    const [result] = parsePlaywrightReport(report, appPath);
    expect(result.status).toBe("inconclusive");
  });

  it("inherits the file from the suite when the spec omits it", () => {
    const report: PwReport = {
      suites: [
        {
          // File only on the suite; nested specs don't repeat it.
          file: "tests/a.spec.ts",
          specs: [
            {
              title: "a test",
              tests: [{ results: [{ status: "passed", duration: 5 }] }],
            },
          ],
        },
      ],
    };
    const results = parsePlaywrightReport(report, appPath);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      file: "tests/a.spec.ts",
      status: "passed",
    });
  });

  it("normalizes absolute spec paths to app-relative", () => {
    const report: PwReport = {
      suites: specResult("/apps/my-app/tests/a.spec.ts", "passed"),
    };
    const [result] = parsePlaywrightReport(report, appPath);
    expect(result.file).toBe("tests/a.spec.ts");
  });

  it("aggregates a file with both assertion and infra failures as failed", () => {
    const report: PwReport = {
      suites: [
        {
          file: "tests/a.spec.ts",
          specs: [
            {
              file: "tests/a.spec.ts",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      duration: 10,
                      error: { message: "Timed out waiting for locator" },
                    },
                  ],
                },
                {
                  results: [
                    {
                      status: "failed",
                      duration: 20,
                      error: { message: "expect(x).toBe(y)" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const [result] = parsePlaywrightReport(report, appPath);
    // assertion presence wins over infra so it doesn't read as "just flaky".
    expect(result.status).toBe("failed");
    expect(result.durationMs).toBe(30);
  });

  it("breaks a multi-test file into per-test results sorted by line", () => {
    const report: PwReport = {
      suites: [
        {
          file: "tests/a.spec.ts",
          specs: [
            {
              file: "tests/a.spec.ts",
              title: "second",
              line: 20,
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      duration: 7,
                      error: { message: "expect(x).toBe(y)" },
                    },
                  ],
                },
              ],
            },
            {
              file: "tests/a.spec.ts",
              title: "first",
              line: 5,
              tests: [{ results: [{ status: "passed", duration: 3 }] }],
            },
          ],
        },
      ],
    };
    const [result] = parsePlaywrightReport(report, appPath);
    expect(result.status).toBe("failed");
    expect(result.tests).toEqual([
      { title: "first", line: 5, status: "passed", durationMs: 3 },
      {
        title: "second",
        line: 20,
        status: "failed",
        durationMs: 7,
        error: "expect(x).toBe(y)",
      },
    ]);
  });
});
