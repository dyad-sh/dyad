import { describe, expect, it } from "vitest";
import {
  createTestOutputRedactor,
  redactTestRunArtifacts,
} from "./test_output_redaction";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parsePlaywrightReport } from "./playwright_report";

describe("test runner output redaction", () => {
  const secret = "sb_secret_fixture-test-key";

  it.each([
    { withCredentials: true, useErrorsArray: false },
    { withCredentials: true, useErrorsArray: true },
    { withCredentials: false, useErrorsArray: false },
  ])(
    "keeps screenshot references consistent with retained artifacts ($withCredentials, errors array: $useErrorsArray)",
    async ({ withCredentials, useErrorsArray }) => {
      const run = await fs.mkdtemp(
        path.join(os.tmpdir(), "dyad-screenshot-redaction-"),
      );
      const screenshot = path.join(run, "test-failed.png");
      const context = path.join(run, "error-context.md");
      const reportPath = path.join(run, "results.json");
      const error = "Expected welcome heading to be visible";
      try {
        await fs.writeFile(screenshot, "opaque screenshot data");
        await fs.writeFile(context, error);
        await fs.writeFile(
          reportPath,
          JSON.stringify({
            suites: [
              {
                file: "e2e-tests/signup.spec.ts",
                suites: [
                  {
                    specs: [
                      {
                        title: "signup",
                        tests: [
                          {
                            results: [
                              {
                                status: "failed",
                                ...(useErrorsArray
                                  ? { errors: [{ message: error }] }
                                  : { error: { message: error } }),
                                attachments: [
                                  { name: "screenshot", path: screenshot },
                                  { name: "error-context", path: context },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        );
        await redactTestRunArtifacts(run, withCredentials ? [secret] : []);
        // Cleanup can be repeated during run teardown; don't duplicate notices.
        await redactTestRunArtifacts(run, withCredentials ? [secret] : []);
        const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
        const [result] = parsePlaywrightReport(report, run);
        expect(result.status).toBe("failed");
        expect(result.screenshotPath).toBe(
          withCredentials ? undefined : screenshot,
        );
        expect(result.tests?.[0].screenshotPath).toBe(
          withCredentials ? undefined : screenshot,
        );
        expect(result.error).toBe(
          withCredentials
            ? `${error}${useErrorsArray ? "\n" : "\n\n"}Failure screenshot removed to protect credentials supplied to the test runner.`
            : error,
        );
        const attachments =
          report.suites[0].suites[0].specs[0].tests[0].results[0].attachments;
        expect(attachments).toEqual(
          withCredentials
            ? [{ name: "error-context", path: context }]
            : [
                { name: "screenshot", path: screenshot },
                { name: "error-context", path: context },
              ],
        );
        if (withCredentials) {
          await expect(fs.stat(screenshot)).rejects.toMatchObject({
            code: "ENOENT",
          });
        } else {
          expect(await fs.readFile(screenshot, "utf8")).toBe(
            "opaque screenshot data",
          );
        }
      } finally {
        await fs.rm(run, { recursive: true, force: true });
      }
    },
  );

  it("sanitizes reports and nested context, removes opaque attachments, and leaves other runs alone", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-artifact-redaction-"),
    );
    const run = path.join(root, "run");
    const escapedSecret = 'password"with\nnewlines';
    try {
      await fs.mkdir(path.join(run, "artifacts"), { recursive: true });
      await fs.writeFile(path.join(root, "other-run.json"), secret);
      await fs.writeFile(
        path.join(run, "results.json"),
        JSON.stringify({ stdout: secret, error: escapedSecret }),
      );
      await fs.writeFile(
        path.join(run, "partial.json"),
        `{"error":${JSON.stringify(escapedSecret)}`,
      );
      await fs.writeFile(
        path.join(run, "artifacts/error-context.md"),
        `Received: ${secret}`,
      );
      await fs.writeFile(path.join(run, "artifacts/trace.zip"), secret);
      await redactTestRunArtifacts(run, [secret, escapedSecret]);
      expect(
        JSON.parse(await fs.readFile(path.join(run, "results.json"), "utf8")),
      ).toEqual({ stdout: "[redacted]", error: "[redacted]" });
      expect(await fs.readFile(path.join(run, "partial.json"), "utf8")).toBe(
        '{"error":"[redacted]"',
      );
      expect(
        await fs.readFile(path.join(run, "artifacts/error-context.md"), "utf8"),
      ).toBe("Received: [redacted]");
      await expect(
        fs.stat(path.join(run, "artifacts/trace.zip")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(path.join(root, "other-run.json"), "utf8")).toBe(
        secret,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("redacts credentials at every possible chunk boundary", () => {
    for (let split = 0; split <= secret.length; split++) {
      const chunks: string[] = [];
      const stream = createTestOutputRedactor([secret]).stream((chunk) =>
        chunks.push(chunk),
      );
      stream.push(`stdout: ${secret.slice(0, split)}`);
      stream.push(`${secret.slice(split)}\nstderr: ${secret}\n`);
      stream.flush();
      expect(chunks.join("")).toBe("stdout: [redacted]\nstderr: [redacted]\n");
    }
  });

  it("withholds partial credentials when a run ends early", () => {
    const chunks: string[] = [];
    const stream = createTestOutputRedactor([secret]).stream((chunk) =>
      chunks.push(chunk),
    );
    stream.push("error: sb_secret_fixture");
    stream.flush();
    expect(chunks.join("")).toBe("error: [redacted]");
  });

  it("redacts secrets interrupted by ANSI highlighting and split escape codes", () => {
    const colored = `sb_secret_\x1b[7mfixture-test\x1b[27m-key`;
    const redactor = createTestOutputRedactor([secret]);
    expect(redactor.result({ error: colored })).toEqual({
      error: "[redacted]",
    });
    const chunks: string[] = [];
    const stream = redactor.stream((chunk) => chunks.push(chunk));
    for (const character of colored) stream.push(character);
    stream.flush();
    expect(chunks.join("")).toBe("[redacted]");
  });

  it("sanitizes nested failures with escaped credentials and preserves values", () => {
    const password = 'password"with\nnewlines';
    const redactor = createTestOutputRedactor([secret, password, ""]);
    expect(
      redactor.result({
        results: [{ error: `Received: ${secret}`, attempts: 2 }],
        infraError: { message: password },
        installed: false,
      }),
    ).toEqual({
      results: [{ error: "Received: [redacted]", attempts: 2 }],
      infraError: { message: "[redacted]" },
      installed: false,
    });
  });
});
