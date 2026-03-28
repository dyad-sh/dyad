/**
 * run_tests tool — Detect and run the project's test suite, returning structured results.
 */

import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";
import type { ToolDefinition, AgentContext } from "./types";
import type { TestResult, TestFailure } from "@/types/error_types";

const logger = log.scope("run_tests");

const runTestsSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      "Optional test name or file pattern to filter which tests to run (e.g. 'src/utils' or 'login').",
    ),
});

export const runTestsTool: ToolDefinition<z.infer<typeof runTestsSchema>> = {
  name: "run_tests",
  description: `Run the project's test suite and return structured results.
Automatically detects vitest, jest, or mocha from package.json.
Use after making changes to verify nothing is broken.
Optionally pass a filter to run a subset of tests.`,
  inputSchema: runTestsSchema,
  defaultConsent: "ask",

  getConsentPreview: (args) =>
    args.filter ? `Run tests matching: ${args.filter}` : "Run full test suite",

  buildXml: (args, isComplete) => {
    let xml = `<joy-output type="test-run"${args.filter ? ` filter="${args.filter}"` : ""}>`;
    if (isComplete) xml += "</joy-output>";
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const framework = await detectTestFramework(ctx.appPath);
    logger.info(
      `Detected test framework: ${framework} in ${ctx.appPath}`,
    );

    const { command, jsonOutputPath } = buildTestCommand(
      framework,
      ctx.appPath,
      args.filter,
    );

    logger.info(`Running tests: ${command}`);

    const rawOutput = await runCommand(command, ctx.appPath);
    const result = await parseTestOutput(
      framework,
      rawOutput,
      jsonOutputPath,
    );

    return formatResultForAgent(result);
  },
};

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

type Framework = "vitest" | "jest" | "mocha" | "unknown";

async function detectTestFramework(appPath: string): Promise<Framework> {
  try {
    const pkgJson = JSON.parse(
      await readFile(path.join(appPath, "package.json"), "utf-8"),
    );
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
    };

    if (allDeps.vitest) return "vitest";
    if (allDeps.jest) return "jest";
    if (allDeps.mocha) return "mocha";

    // Check scripts
    const scripts = pkgJson.scripts ?? {};
    const testScript = scripts.test ?? "";
    if (testScript.includes("vitest")) return "vitest";
    if (testScript.includes("jest")) return "jest";
    if (testScript.includes("mocha")) return "mocha";
  } catch {
    // no package.json
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Command building
// ---------------------------------------------------------------------------

function buildTestCommand(
  framework: Framework,
  appPath: string,
  filter?: string,
): { command: string; jsonOutputPath?: string } {
  const f = filter ? ` ${filter}` : "";

  switch (framework) {
    case "vitest": {
      const jsonPath = path.join(appPath, ".joy-test-results.json");
      return {
        command: `npx vitest run --reporter=json --outputFile="${jsonPath}"${f} 2>&1`,
        jsonOutputPath: jsonPath,
      };
    }
    case "jest": {
      const jsonPath = path.join(appPath, ".joy-test-results.json");
      return {
        command: `npx jest --json --outputFile="${jsonPath}"${f} 2>&1`,
        jsonOutputPath: jsonPath,
      };
    }
    case "mocha":
      return {
        command: `npx mocha --reporter json${f} 2>&1`,
      };
    default:
      return {
        command: `npm test 2>&1`,
      };
  }
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

function runCommand(command: string, cwd: string): Promise<string> {
  return new Promise<string>((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
      },
      (_error, stdout, stderr) => {
        let output = "";
        if (stdout?.trim()) output += stdout.trim();
        if (stderr?.trim()) output += (output ? "\n" : "") + stderr.trim();
        if (!output) output = "No test output captured.";
        resolve(output);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

async function parseTestOutput(
  framework: Framework,
  rawOutput: string,
  jsonOutputPath?: string,
): Promise<TestResult> {
  // Try reading JSON output file first (vitest/jest)
  if (jsonOutputPath) {
    try {
      const json = JSON.parse(
        await readFile(jsonOutputPath, "utf-8"),
      );
      if (framework === "vitest") return parseVitestJson(json, rawOutput);
      if (framework === "jest") return parseJestJson(json, rawOutput);
    } catch {
      logger.info("JSON output file not available, falling back to raw parse");
    }
  }

  // Mocha: JSON is in stdout
  if (framework === "mocha") {
    try {
      const json = JSON.parse(rawOutput);
      return parseMochaJson(json, rawOutput);
    } catch {
      // fall through
    }
  }

  return parseFallback(framework, rawOutput);
}

function parseVitestJson(json: Record<string, unknown>, raw: string): TestResult {
  const suites = (json.testResults ?? []) as Array<{
    name: string;
    assertionResults: Array<{
      fullName: string;
      ancestorTitles: string[];
      status: string;
      failureMessages: string[];
    }>;
  }>;

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: TestFailure[] = [];

  for (const suite of suites) {
    for (const test of suite.assertionResults ?? []) {
      if (test.status === "passed") passed++;
      else if (test.status === "failed") {
        failed++;
        failures.push({
          testName: test.fullName,
          suiteName: test.ancestorTitles?.join(" > "),
          file: suite.name,
          message: (test.failureMessages ?? []).join("\n"),
        });
      } else {
        skipped++;
      }
    }
  }

  return {
    framework: "vitest",
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    failures,
    durationMs: (json.time as number) ?? 0,
    rawOutput: raw,
  };
}

function parseJestJson(json: Record<string, unknown>, raw: string): TestResult {
  const numPassed = (json.numPassedTests ?? 0) as number;
  const numFailed = (json.numFailedTests ?? 0) as number;
  const numPending = (json.numPendingTests ?? 0) as number;

  const failures: TestFailure[] = [];
  const suites = (json.testResults ?? []) as Array<{
    name: string;
    assertionResults: Array<{
      fullName: string;
      ancestorTitles: string[];
      status: string;
      failureMessages: string[];
    }>;
  }>;

  for (const suite of suites) {
    for (const test of suite.assertionResults ?? []) {
      if (test.status === "failed") {
        failures.push({
          testName: test.fullName,
          suiteName: test.ancestorTitles?.join(" > "),
          file: suite.name,
          message: (test.failureMessages ?? []).join("\n"),
        });
      }
    }
  }

  return {
    framework: "jest",
    passed: numPassed,
    failed: numFailed,
    skipped: numPending,
    total: numPassed + numFailed + numPending,
    failures,
    durationMs: 0,
    rawOutput: raw,
  };
}

function parseMochaJson(json: Record<string, unknown>, raw: string): TestResult {
  const stats = (json.stats ?? {}) as Record<string, number>;
  const failuresArr = (json.failures ?? []) as Array<{
    fullTitle: string;
    file: string;
    err: { message: string; stack?: string; expected?: string; actual?: string };
  }>;

  return {
    framework: "mocha",
    passed: stats.passes ?? 0,
    failed: stats.failures ?? 0,
    skipped: stats.pending ?? 0,
    total: stats.tests ?? 0,
    failures: failuresArr.map((f) => ({
      testName: f.fullTitle,
      file: f.file,
      message: f.err?.message ?? "Unknown failure",
      stack: f.err?.stack,
      expected: f.err?.expected != null ? String(f.err.expected) : undefined,
      actual: f.err?.actual != null ? String(f.err.actual) : undefined,
    })),
    durationMs: stats.duration ?? 0,
    rawOutput: raw,
  };
}

function parseFallback(framework: Framework, raw: string): TestResult {
  // Best-effort extraction from raw output
  const passMatch = raw.match(/(\d+)\s+pass(?:ed|ing)?/i);
  const failMatch = raw.match(/(\d+)\s+fail(?:ed|ing|ure)?/i);

  const passed = passMatch ? Number.parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? Number.parseInt(failMatch[1], 10) : 0;

  return {
    framework: framework === "unknown" ? "unknown" : framework,
    passed,
    failed,
    skipped: 0,
    total: passed + failed,
    failures: failed > 0
      ? [{ testName: "(raw output)", message: raw.slice(0, 2000) }]
      : [],
    durationMs: 0,
    rawOutput: raw,
  };
}

// ---------------------------------------------------------------------------
// Agent-facing output
// ---------------------------------------------------------------------------

function formatResultForAgent(result: TestResult): string {
  const statusIcon = result.failed === 0 ? "PASS" : "FAIL";
  let out = `Test Results [${statusIcon}] (${result.framework})\n`;
  out += `Passed: ${result.passed} | Failed: ${result.failed} | Skipped: ${result.skipped} | Total: ${result.total}\n`;

  if (result.failures.length > 0) {
    out += "\nFailures:\n";
    for (const f of result.failures.slice(0, 10)) {
      out += `\n- ${f.testName}`;
      if (f.file) out += ` (${f.file})`;
      out += `\n  ${f.message.slice(0, 500)}`;
      if (f.expected && f.actual) {
        out += `\n  Expected: ${f.expected}\n  Actual: ${f.actual}`;
      }
      out += "\n";
    }
    if (result.failures.length > 10) {
      out += `\n... and ${result.failures.length - 10} more failures.\n`;
    }
  }

  return out;
}
