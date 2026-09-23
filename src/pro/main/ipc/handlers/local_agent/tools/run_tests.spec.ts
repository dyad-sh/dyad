import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { AgentContext } from "./types";
import type { RunAppTestsResult } from "@/ipc/types/tests";

vi.mock("@/ipc/handlers/tests_handlers", () => ({
  runAppTestsWithIsolation: vi.fn(),
  getRunningTestBaseUrl: vi.fn(),
  normalizeRunTestFile: vi.fn(),
  listSpecFiles: vi.fn(),
  readSpecTestCases: vi.fn(),
}));
vi.mock("@/ipc/utils/test_screenshot", () => ({
  readTestScreenshotDataUrl: vi.fn(),
  readTestErrorContext: vi.fn(),
}));
vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({})),
}));

import {
  runAppTestsWithIsolation,
  getRunningTestBaseUrl,
  listSpecFiles,
  readSpecTestCases,
  normalizeRunTestFile,
} from "@/ipc/handlers/tests_handlers";
import {
  readTestErrorContext,
  readTestScreenshotDataUrl,
} from "@/ipc/utils/test_screenshot";
import { readSettings } from "@/main/settings";
import { runTestsTool } from "./run_tests";

const runner = vi.mocked(runAppTestsWithIsolation);
const baseUrl = vi.mocked(getRunningTestBaseUrl);
const screenshot = vi.mocked(readTestScreenshotDataUrl);
const errorContext = vi.mocked(readTestErrorContext);
const specLister = vi.mocked(listSpecFiles);
const caseLister = vi.mocked(readSpecTestCases);
const settingsReader = vi.mocked(readSettings);

function makeCtx(): AgentContext {
  return {
    appId: 1,
    appPath: "/app",
    event: { sender: {} },
    fileEditTracker: Object.create(null),
    testingEnabled: true,
    testRunAttempts: new Map(),
    abortSignal: undefined,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    appendUserMessage: vi.fn(),
  } as unknown as AgentContext;
}

/** All user-facing XML the tool emitted (dyad-status/dyad-output titles + bodies). */
function emittedXml(ctx: AgentContext): string {
  return [
    ...vi.mocked(ctx.onXmlStream).mock.calls,
    ...vi.mocked(ctx.onXmlComplete).mock.calls,
  ]
    .map((c) => String(c[0]))
    .join("\n");
}

const passedResult: RunAppTestsResult = {
  appId: 1,
  results: [{ file: "e2e-tests/a.spec.ts", status: "passed" }],
  isolation: { mode: "neon-branch" },
};

function failResult(error: string, screenshotPath?: string): RunAppTestsResult {
  return {
    appId: 1,
    results: [
      {
        file: "e2e-tests/a.spec.ts",
        status: "failed",
        error,
        tests: [
          { title: "does a thing", status: "failed", error, screenshotPath },
        ],
      },
    ],
    isolation: { mode: "neon-branch" },
  };
}

const infraResult: RunAppTestsResult = {
  appId: 1,
  results: [],
  infraError: { message: "Playwright bootstrap failed" },
};

/** A selector/timeout failure Playwright's heuristic labels "inconclusive". */
function inconclusiveResult(error: string): RunAppTestsResult {
  return {
    appId: 1,
    results: [
      {
        file: "e2e-tests/a.spec.ts",
        status: "inconclusive",
        error,
        tests: [{ title: "does a thing", status: "inconclusive", error }],
      },
    ],
    isolation: { mode: "neon-branch" },
  };
}

/** Bump the mutation count so the require-a-change guard sees a new change. */
function addEdit(ctx: AgentContext, _file: string) {
  ctx.mutationCount = (ctx.mutationCount ?? 0) + 1;
}

describe("runTestsTool", () => {
  beforeEach(() => {
    runner.mockReset();
    baseUrl.mockReset();
    screenshot.mockReset();
    specLister.mockReset();
    caseLister.mockReset();
    vi.mocked(normalizeRunTestFile)
      .mockReset()
      .mockImplementation((file) =>
        path.posix.normalize(file.replace(/\\/g, "/")),
      );
    errorContext.mockReset();
    baseUrl.mockReturnValue("http://localhost:3000");
    screenshot.mockResolvedValue(null);
    errorContext.mockResolvedValue(null);
    // The spec the tests target exists on disk, so pre-flight resolution lets
    // the run proceed. Individual tests override this to exercise mismatches.
    specLister.mockResolvedValue(["e2e-tests/a.spec.ts"]);
    caseLister.mockResolvedValue([{ title: "does a thing", line: 3 }]);
    // Default: headless + serial + full speed (the Tests panel's unset
    // defaults).
    settingsReader.mockReturnValue({} as ReturnType<typeof readSettings>);
  });

  it("is gated on testingEnabled", () => {
    expect(
      runTestsTool.isEnabled?.({ testingEnabled: true } as AgentContext),
    ).toBe(true);
    expect(
      runTestsTool.isEnabled?.({ testingEnabled: false } as AgentContext),
    ).toBe(false);
  });

  describe("batches", () => {
    const a = "e2e-tests/a.spec.ts";
    const b = "e2e-tests/b.spec.ts";
    const c = "e2e-tests/c.spec.ts";
    const d = "e2e-tests/d.spec.ts";

    beforeEach(() => {
      specLister.mockResolvedValue([a, b]);
      runner.mockResolvedValue({
        appId: 1,
        results: [a, b].map((file) => ({ file, status: "passed" })),
      });
    });

    it.each([{}, { testFiles: [a, b] }])(
      "runs one batch for %j",
      async (args) => {
        const ctx = makeCtx();
        const out = await runTestsTool.execute(args, ctx);
        expect(runner).toHaveBeenCalledTimes(1);
        expect(runner).toHaveBeenCalledWith(
          expect.objectContaining({ testFiles: [a, b], timeoutMs: 600_000 }),
        );
        expect(ctx.testRunCount).toBe(1);
        expect(ctx.testRunAttempts.get(a)?.passedAtEditCount?.[""]).toBe(0);
        expect(ctx.testRunAttempts.get(b)?.passedAtEditCount?.[""]).toBe(0);
        expect(out).toContain(`${a}: passed`);
        expect(out).toContain(`${b}: passed`);
        expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
      },
    );

    it.each([undefined, ".*", "does a thing"])(
      "shows each passing file once and keeps rerun guidance in the tool response (grep: %s)",
      async (grep) => {
        runner.mockResolvedValue({
          appId: 1,
          results: [
            {
              file: a,
              status: "passed",
              tests: [
                { title: "does a thing", status: "passed" },
                { title: "disabled", status: "inconclusive" },
              ],
            },
            { file: b, status: "passed" },
          ],
          isolation: { mode: "neon-branch" },
        });
        const ctx = makeCtx();
        const out = await runTestsTool.execute(
          { testFiles: [a, b], grep },
          ctx,
        );
        const scope = grep ? ` (matching /${grep}/ only)` : "";
        const summary = `${a}: passed — 1 passed, 1 skipped${scope}\n${b}: passed — 1 passed, 0 skipped${scope}`;
        const isolation =
          "Tests ran against a temporary copy of the database — your real data was not touched.";

        expect(ctx.onXmlComplete).toHaveBeenCalledExactlyOnceWith(
          `<dyad-status title="${grep ? "Matching tests passed" : "Tests passed"}">\n${summary}\n\n${isolation}\n</dyad-status>`,
        );
        expect(emittedXml(ctx)).not.toContain("do NOT run");
        expect(out).toContain(summary);
        expect(out).toContain(isolation);
        for (const file of [a, b]) {
          expect(out).toContain(
            grep
              ? `${file}: The tests matching /${grep}/ passed`
              : `${file}: All runnable tests passed`,
          );
        }
        expect(out).toContain("do NOT run");
        expect(runner).toHaveBeenCalledTimes(1);
      },
    );

    it("normalizes and deduplicates the selection before running", async () => {
      const ctx = makeCtx();
      await runTestsTool.execute(
        { testFiles: [a, `./${a}`, "e2e-tests\\a.spec.ts", b] },
        ctx,
      );
      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({ testFiles: [a, b] }),
      );
      expect(ctx.testRunAttempts.size).toBe(2);
    });

    it.each([
      { testFiles: [] },
      { testFiles: [""] },
      { testFile: a },
      { testFile: a, testFiles: [b] },
    ])("rejects invalid/legacy arguments without running: %j", async (args) => {
      expect(runTestsTool.inputSchema.safeParse(args).success).toBe(false);
      const ctx = makeCtx();
      // Exercise the direct-call guard as well as the model schema.
      const out = await runTestsTool.execute(
        args as Parameters<typeof runTestsTool.execute>[0],
        ctx,
      );
      expect(out).toContain("Invalid run_tests arguments");
      expect(runner).not.toHaveBeenCalled();
      expect(ctx.testRunCount).toBeUndefined();
    });

    it("rejects the entire batch and lists all missing paths", async () => {
      const ctx = makeCtx();
      const out = await runTestsTool.execute({ testFiles: [a, c, d] }, ctx);
      expect(out).toContain(c);
      expect(out).toContain(d);
      expect(out).toContain("No part of the batch ran");
      expect(runner).not.toHaveBeenCalled();
      expect(ctx.testRunAttempts.size).toBe(0);
    });

    it("does not start isolation for an empty suite", async () => {
      specLister.mockResolvedValue([]);
      const out = await runTestsTool.execute({}, makeCtx());
      expect(out).toContain("There are no specs to run");
      expect(runner).not.toHaveBeenCalled();
    });

    it.each(["whole suite", "explicit selection", "only unsupported"])(
      "handles unsupported discovered paths for %s",
      async (selection) => {
        const unsupported = "e2e-tests/checkout:mobile.spec.ts";
        vi.mocked(normalizeRunTestFile).mockImplementation((file) =>
          file === unsupported ? null : file,
        );
        specLister.mockResolvedValue(
          selection === "only unsupported" ? [unsupported] : [a, unsupported],
        );
        const ctx = makeCtx();
        const out = await runTestsTool.execute(
          selection === "explicit selection"
            ? { testFiles: [a, unsupported] }
            : {},
          ctx,
        );
        expect(out).toContain(unsupported);
        expect(out).toContain("Rename these files");
        expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
        expect(vi.mocked(ctx.onXmlComplete).mock.calls[0][0]).toContain(
          unsupported,
        );
        if (selection === "whole suite") {
          expect(out).toContain("Unsupported spec paths skipped");
          expect(out).toContain(`${a}: passed`);
          expect(runner).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ testFiles: [a] }),
          );
        } else {
          expect(runner).not.toHaveBeenCalled();
          expect(ctx.testRunCount).toBeUndefined();
          expect(ctx.testRunAttempts.size).toBe(0);
          expect(out).not.toContain(`- ${unsupported}`);
        }
      },
    );

    it.each(["valid", "missing", "unsupported"])(
      "does not warn about unrelated unsupported paths in an explicit %s selection",
      async (selection) => {
        const unrelated = "e2e-tests/unrelated:mobile.spec.ts";
        const requested = "e2e-tests/selected:mobile.spec.ts";
        vi.mocked(normalizeRunTestFile).mockImplementation((file) =>
          file.includes(":") ? null : file,
        );
        specLister.mockResolvedValue([a, unrelated, requested]);
        const ctx = makeCtx();
        const out = await runTestsTool.execute(
          {
            testFiles: [
              selection === "valid"
                ? a
                : selection === "missing"
                  ? c
                  : requested,
            ],
          },
          ctx,
        );

        expect(out).not.toContain(unrelated);
        expect(emittedXml(ctx)).not.toContain(unrelated);
        expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
        if (selection === "unsupported") {
          expect(out).toContain(`Unsupported spec paths: ${requested}`);
        } else {
          expect(out).not.toContain("Unsupported spec paths");
          expect(emittedXml(ctx)).not.toContain("Unsupported spec paths");
        }
        if (selection === "valid") {
          expect(runner).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ testFiles: [a] }),
          );
        } else {
          expect(runner).not.toHaveBeenCalled();
        }
      },
    );

    it.each([
      ["passed", "Tests passed"],
      ["failed", "Tests failed"],
      ["empty", "some files not verified"],
      ["infra", "Test run couldn't complete"],
      ["throw", "Test run couldn't complete"],
      ["cancel", "Test run couldn't complete"],
      ["invalid grep", "Invalid grep pattern"],
      ["attempt limit", "Test batch blocked"],
      ["turn limit", "Test run limit reached"],
      ["stopped server", "App isn't running"],
    ])(
      "includes a suite selection warning in one final card when %s",
      async (outcome, title) => {
        const unsupported = "e2e-tests/checkout:mobile.spec.ts";
        vi.mocked(normalizeRunTestFile).mockImplementation((file) =>
          file === unsupported ? null : file,
        );
        specLister.mockResolvedValue([a, unsupported]);
        const ctx = makeCtx();
        switch (outcome) {
          case "failed":
            runner.mockResolvedValue(failResult("checkout broke"));
            break;
          case "empty":
            runner.mockResolvedValue({ appId: 1, results: [] });
            break;
          case "infra":
            runner.mockResolvedValue(infraResult);
            break;
          case "throw":
            runner.mockRejectedValue(new Error("runner unavailable"));
            break;
          case "cancel":
            ctx.abortSignal = AbortSignal.abort();
            break;
          case "attempt limit":
            ctx.testRunAttempts.set(a, { attempts: 4 });
            break;
          case "turn limit":
            ctx.testRunCount = 10;
            break;
          case "stopped server":
            settingsReader.mockReturnValue({
              disableSandboxedE2eTests: true,
            } as ReturnType<typeof readSettings>);
            baseUrl.mockReturnValue(null);
            break;
        }
        const out = await runTestsTool.execute(
          outcome === "invalid grep" ? { grep: "(" } : {},
          ctx,
        );

        expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
        const xml = vi.mocked(ctx.onXmlComplete).mock.calls[0][0];
        expect(xml).toContain(title);
        const note = `Unsupported spec paths skipped: ${unsupported}`;
        expect(xml).toContain(note);
        expect(out).toContain(note);
        expect(xml.match(/Unsupported spec paths/g)).toHaveLength(1);
        expect(out.match(/Unsupported spec paths/g)).toHaveLength(1);
      },
    );

    it("accounts for passing, failing, skipped, and empty files independently", async () => {
      specLister.mockResolvedValue([a, b, c, d]);
      runner.mockResolvedValue({
        appId: 1,
        results: [
          { file: "a.spec.ts", status: "passed" },
          { ...failResult("checkout broke").results[0], file: b },
          {
            file: c,
            status: "inconclusive",
            tests: [{ title: "disabled", status: "inconclusive" }],
          },
        ],
      });
      const ctx = makeCtx();
      ctx.testRunAttempts.set(a, { attempts: 2 });
      ctx.testRunAttempts.set(b, { attempts: 1 });
      const out = await runTestsTool.execute({}, ctx);
      expect(ctx.testRunAttempts.get(a)?.attempts).toBe(0);
      expect(ctx.testRunAttempts.get(b)?.attempts).toBe(2);
      expect(ctx.testRunAttempts.get(c)).toEqual({ attempts: 0 });
      expect(ctx.testRunAttempts.get(d)).toEqual({ attempts: 0 });
      expect(out).toContain(`${a}: passed`);
      expect(out).toContain(`${b}: failed`);
      expect(out).toContain(`${c}: no runnable tests — not verified`);
      expect(out).toContain(`${d}: no runnable tests — not verified`);
      expect(out).toContain("2 attempt(s) remain");
      expect(out).toContain("checkout broke");
      expect(ctx.onXmlComplete).toHaveBeenCalledExactlyOnceWith(
        `<dyad-status title="Tests failed in 1 file(s)">\n${a}: passed — 1 passed, 0 skipped\n${b}: failed — 0 passed, 1 failed, 0 skipped\n${c}: no runnable tests — not verified\n${d}: no runnable tests — not verified\n\nTests ran against the app's current database.\n</dyad-status>`,
      );
      expect(emittedXml(ctx)).not.toContain("do NOT run");
      expect(emittedXml(ctx)).not.toContain("call run_tests again");
    });

    it("keeps no-tests retry guidance out of the visible warning", async () => {
      runner.mockResolvedValue({ appId: 1, results: [] });
      const ctx = makeCtx();
      const out = await runTestsTool.execute({}, ctx);

      expect(ctx.onXmlComplete).toHaveBeenCalledExactlyOnceWith(
        `<dyad-output type="warning" message="Test batch finished — some files not verified">\n${a}: no runnable tests — not verified\n${b}: no runnable tests — not verified\n\nTests ran against the app's current database.\n</dyad-output>`,
      );
      expect(emittedXml(ctx)).not.toContain("Un-skip");
      expect(out).toContain(
        "Un-skip it (or add a real `test()`), then run again.",
      );
    });

    it("rejects all files when one is blocked without spending other files' flake allowance", async () => {
      const ctx = makeCtx();
      ctx.testRunAttempts.set(b, { attempts: 4 });
      const out = await runTestsTool.execute(
        { testFiles: [a, b], flakeCheck: true },
        ctx,
      );
      expect(out).toContain(`${b}: Attempt limit reached`);
      expect(runner).not.toHaveBeenCalled();
      expect(ctx.testRunAttempts.get(a)?.flakeCheckUsed).toBeUndefined();
      expect(ctx.testRunCount).toBeUndefined();
    });

    it("rejects a whole-suite request containing an unchanged passing file", async () => {
      const ctx = makeCtx();
      ctx.testRunAttempts.set(b, { attempts: 0, passedAtEditCount: { "": 0 } });
      const out = await runTestsTool.execute({}, ctx);
      expect(out).toContain(`${b}: The whole spec already passed`);
      expect(runner).not.toHaveBeenCalled();
    });

    it.each(["server down", "turn limit"])(
      "reports the spec attempt cap before %s without consuming allowances",
      async (blocker) => {
        const ctx = makeCtx();
        ctx.testRunAttempts.set(b, { attempts: 4 });
        if (blocker === "server down") baseUrl.mockReturnValue(null);
        else ctx.testRunCount = 10;
        const out = await runTestsTool.execute({ flakeCheck: true }, ctx);
        expect(out).toContain(`${b}: Attempt limit reached`);
        expect(out).not.toContain("dev server isn't running");
        expect(out).not.toContain("Turn-level test run limit reached");
        expect(runner).not.toHaveBeenCalled();
        expect(ctx.testRunAttempts.get(a)).toBeUndefined();
        expect(ctx.testRunAttempts.get(b)).toEqual({ attempts: 4 });
      },
    );

    it.each([false, true])(
      "filters across files without resetting budgets (whole suite: %s)",
      async (wholeSuite) => {
        runner.mockResolvedValue({
          appId: 1,
          results: [passedResult.results[0]],
        });
        const ctx = makeCtx();
        ctx.testRunAttempts.set(a, { attempts: 2 });
        ctx.testRunAttempts.set(b, { attempts: 1 });
        const out = await runTestsTool.execute(
          {
            ...(wholeSuite ? {} : { testFiles: [a, b] }),
            grep: "does a thing",
          },
          ctx,
        );
        expect(runner).toHaveBeenCalledWith(
          expect.objectContaining({
            testFiles: [a, b],
            grep: "does a thing",
            parallel: false,
          }),
        );
        expect(ctx.testRunAttempts.get(a)?.attempts).toBe(2);
        expect(
          ctx.testRunAttempts.get(a)?.passedAtEditCount?.[""],
        ).toBeUndefined();
        expect(ctx.testRunAttempts.get(b)).toEqual({ attempts: 1 });
        expect(out).toContain("matching /does a thing/ only");
        expect(out).toContain(`${b}: no runnable tests — not verified`);
      },
    );

    it("reports errors and artifacts from every failing file separately", async () => {
      runner.mockResolvedValue({
        appId: 1,
        results: [
          ...failResult("first failure", "test-results/a/test-failed.png")
            .results,
          {
            ...failResult("second failure", "test-results/b/test-failed.png")
              .results[0],
            file: b,
          },
        ],
      });
      const out = await runTestsTool.execute({}, makeCtx());
      expect(out).toContain("first failure");
      expect(out).toContain("second failure");
      expect(out).toContain("test-results/a/error-context.md");
      expect(out).toContain("test-results/b/error-context.md");
    });

    it.each([false, true])(
      "bounds expanded failure diagnostics and images across a large batch (sandbox: %s)",
      async (sandboxed) => {
        const files = Array.from(
          { length: 12 },
          (_, index) => `e2e-tests/spec-${index}.spec.ts`,
        );
        specLister.mockResolvedValue(files);
        screenshot.mockResolvedValue("data:image/png;base64,ABC");
        errorContext.mockResolvedValue("Retained page snapshot");
        const prefix = sandboxed ? "/retained/artifacts/" : "";
        runner.mockResolvedValue({
          appId: 1,
          results: files.map((file, index) => ({
            ...failResult(
              `ERROR-${index}: ${"x".repeat(8000)}`,
              `${prefix}test-results/spec-${index}/test-failed.png`,
            ).results[0],
            file,
          })),
        });
        const ctx = makeCtx();
        const out = String(await runTestsTool.execute({}, ctx));
        expect(ctx.appendUserMessage).toHaveBeenCalledTimes(2);
        expect(screenshot).toHaveBeenCalledTimes(2);
        expect(errorContext).toHaveBeenCalledTimes(sandboxed ? 2 : 0);
        expect(out.match(/Error \(truncated/g)).toHaveLength(2);
        expect(out.match(/x{4000}/g)).toHaveLength(2);
        expect(out).not.toContain("x".repeat(4001));
        for (const [index, file] of files.entries()) {
          expect(out).toContain(`${file}: failed`);
          if (sandboxed && index < 2) {
            expect(out).toContain("Retained page snapshot");
          } else {
            expect(out).toContain(
              `${prefix}test-results/spec-${index}/error-context.md`,
            );
          }
          expect(ctx.testRunAttempts.get(file)?.attempts).toBe(1);
        }
      },
    );

    it.each(["infra", "cancel", "incomplete"])(
      "reports observed per-file results without verification or attempts after %s",
      async (reason) => {
        specLister.mockResolvedValue([a, b, c, d]);
        const controller = new AbortController();
        const ctx = makeCtx();
        ctx.abortSignal = controller.signal;
        runner.mockImplementation(async () => {
          if (reason === "cancel") controller.abort();
          return {
            appId: 1,
            results: [
              { file: "a.spec.ts", status: "passed" },
              { file: b, status: "passed", incomplete: true },
              { file: c, status: "failed", error: "assertion failed" },
            ],
            ...(reason === "infra"
              ? { infraError: { message: "deadline exceeded" } }
              : {}),
          };
        });
        const out = await runTestsTool.execute({ flakeCheck: true }, ctx);
        expect(out).toContain(
          `${a}: observed 1 passed, 0 failed, 0 skipped — not verified`,
        );
        expect(out).toContain(
          `${b}: observed 1 passed, 0 failed, 0 skipped (file incomplete) — not verified`,
        );
        expect(out).toContain(
          `${c}: observed 0 passed, 1 failed, 0 skipped — not verified`,
        );
        expect(out).toContain(`${d}: no results returned — not verified`);
        expect(out).toContain("select a smaller batch");
        for (const file of [a, b, c, d])
          expect(ctx.testRunAttempts.get(file)).toEqual({
            attempts: 0,
            flakeCheckUsed: false,
          });
        expect(ctx.testRunCount).toBe(1);
      },
    );

    it.each(["infra", "throw", "cancel"])(
      "refunds all flake allowances and never verifies partial results after %s",
      async (kind) => {
        const ctx = makeCtx();
        ctx.testRunAttempts.set(a, { attempts: 1 });
        ctx.testRunAttempts.set(b, { attempts: 2 });
        const controller = new AbortController();
        ctx.abortSignal = controller.signal;
        if (kind === "throw")
          runner.mockRejectedValue(new Error("setup failed"));
        else
          runner.mockImplementation(async () => {
            if (kind === "cancel") controller.abort();
            return {
              ...passedResult,
              ...(kind === "infra"
                ? { infraError: { message: "deadline exceeded" } }
                : {}),
            };
          });
        await runTestsTool.execute({ flakeCheck: true }, ctx);
        expect(ctx.testRunCount).toBe(1);
        expect(ctx.testRunAttempts.get(a)).toEqual({
          attempts: 1,
          flakeCheckUsed: false,
        });
        expect(ctx.testRunAttempts.get(b)).toEqual({
          attempts: 2,
          flakeCheckUsed: false,
        });
      },
    );

    it("refunds a no-tests file's flake allowance without refunding executed files", async () => {
      runner.mockResolvedValue(failResult("failed"));
      const ctx = makeCtx();
      await runTestsTool.execute({ flakeCheck: true }, ctx);
      expect(ctx.testRunAttempts.get(a)).toMatchObject({
        attempts: 0,
        flakeCheckUsed: true,
      });
      expect(ctx.testRunAttempts.get(b)).toEqual({
        attempts: 0,
        flakeCheckUsed: false,
      });
    });

    it("counts an infrastructure batch once and refuses the eleventh run", async () => {
      runner.mockResolvedValue(infraResult);
      const ctx = makeCtx();
      ctx.testRunCount = 9;
      await runTestsTool.execute({}, ctx);
      const out = await runTestsTool.execute({}, ctx);
      expect(ctx.testRunCount).toBe(10);
      expect(runner).toHaveBeenCalledTimes(1);
      expect(out).toContain("Turn-level test run limit reached");
    });

    it("reserves the final run slot before another batch finishes preflight", async () => {
      const ctx = makeCtx();
      ctx.testRunCount = 9;
      const results = await Promise.all([
        runTestsTool.execute({ testFiles: [a], grep: "does a thing" }, ctx),
        runTestsTool.execute({ testFiles: [b], grep: "does a thing" }, ctx),
      ]);
      expect(runner).toHaveBeenCalledTimes(1);
      expect(ctx.testRunCount).toBe(10);
      expect(
        results.some((result) =>
          String(result).includes("Turn-level test run limit reached"),
        ),
      ).toBe(true);
    });

    it("gives the whole slow-motion batch one twenty-minute deadline", async () => {
      settingsReader.mockReturnValue({ testSlowMo: true } as ReturnType<
        typeof readSettings
      >);
      await runTestsTool.execute({}, makeCtx());
      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({ testFiles: [a, b], timeoutMs: 1_200_000 }),
      );
    });
  });

  it("defaults to headless + serial + full speed when no Tests-panel mode is set", async () => {
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      makeCtx(),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        headed: false,
        parallel: false,
        slowMo: false,
        preview: false,
      }),
    );
  });

  it("forwards the Tests-panel headed/parallel/slow-motion modes to the runner", async () => {
    settingsReader.mockReturnValue({
      testHeaded: true,
      testParallel: true,
      testSlowMo: true,
    } as ReturnType<typeof readSettings>);
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      makeCtx(),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        headed: true,
        parallel: true,
        slowMo: true,
        preview: false,
      }),
    );
  });

  it("keeps slow motion on for a grep-narrowed run (unlike parallel)", async () => {
    // Narrowing forces serial, but pace is independent of how the run is
    // sliced — a user watching a single test still wants to follow it.
    settingsReader.mockReturnValue({
      testSlowMo: true,
      testParallel: true,
    } as ReturnType<typeof readSettings>);
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does a thing" },
      makeCtx(),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ slowMo: true, parallel: false }),
    );
  });

  it("runs headed tests in the preview when the experiment is enabled", async () => {
    settingsReader.mockReturnValue({
      enableTestRunInPreview: true,
      testHeaded: true,
    } as ReturnType<typeof readSettings>);
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      makeCtx(),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ headed: true, parallel: false, preview: true }),
    );
  });

  it("keeps headless tests out of the preview when the experiment is enabled", async () => {
    settingsReader.mockReturnValue({
      enableTestRunInPreview: true,
      testHeaded: false,
    } as ReturnType<typeof readSettings>);
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      makeCtx(),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ headed: false, preview: false }),
    );
  });

  it("never parallelizes a grep-narrowed run even when parallel is on", async () => {
    settingsReader.mockReturnValue({
      testParallel: true,
    } as ReturnType<typeof readSettings>);
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does a thing" },
      makeCtx(),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ parallel: false }),
    );
  });

  it("returns an infra message (uncounted) when the dev server isn't running", async () => {
    // Only the non-sandboxed path needs the preview; a sandboxed run serves the
    // app itself (covered separately below).
    baseUrl.mockReturnValue(null);
    settingsReader.mockReturnValue({
      disableSandboxedE2eTests: true,
    } as ReturnType<typeof readSettings>);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("dev server isn't running");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("reports success and resets the fix budget", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
    addEdit(ctx, "e2e-tests/a.spec.ts");
    runner.mockResolvedValue(passedResult);
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("All runnable tests passed");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(0);
  });

  it("refuses an unchanged rerun after a whole-file pass (targeted or not)", async () => {
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    runner.mockClear();
    const wholeAgain = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    const targeted = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does a thing" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(wholeAgain).toContain("already passed");
    expect(wholeAgain).toContain("Do NOT run it again");
    expect(targeted).toContain("already passed");
  });

  it("refuses to loop over already-passed targets, but still allows the whole-file run", async () => {
    // The alternating loop: test A passes, test B passes, then the model tries
    // A again, then B again — with no edits in between. Both reruns must be
    // refused. The whole-file run isn't required, but is still allowed if the
    // agent chooses to re-verify the rest of the spec.
    caseLister.mockResolvedValue([
      { title: "test A", line: 3 },
      { title: "test B", line: 12 },
    ]);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "test A" },
      ctx,
    );
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "test B" },
      ctx,
    );
    runner.mockClear();
    const rerunA = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "test A" },
      ctx,
    );
    const rerunB = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "test B" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(rerunA).toContain("/test A/ already passed");
    expect(rerunB).toContain("/test B/ already passed");
    expect(rerunA).toContain("Do NOT run it again");
    // A targeted pass no longer requires re-running the whole file, but it's
    // still allowed if the agent wants to verify the rest of the spec.
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("refuses differently-spelled grep patterns that target the same passed test", async () => {
    caseLister.mockResolvedValue([{ title: "does a thing", line: 3 }]);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does.*thing" },
      ctx,
    );
    runner.mockClear();

    const rerun = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does a thing" },
      ctx,
    );

    expect(runner).not.toHaveBeenCalled();
    expect(rerun).toContain("/does a thing/ already passed");
  });

  it("allows rerunning a passed target after a file edit or with flakeCheck", async () => {
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    runner.mockClear();
    const flake = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    expect(flake).toContain("All runnable tests passed");
    addEdit(ctx, "e2e-tests/a.spec.ts");
    const afterEdit = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(afterEdit).toContain("All runnable tests passed");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("counts a failure and attaches the screenshot", async () => {
    runner.mockResolvedValue(
      failResult("boom", "/app/test-results/a/test-failed-1.png"),
    );
    screenshot.mockResolvedValue("data:image/png;base64,ABC");
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("Test run FAILED (attempt 1 of 4");
    expect(out).toContain("test-results/a/error-context.md");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
    expect(ctx.appendUserMessage).toHaveBeenCalledTimes(1);
    const parts = vi.mocked(ctx.appendUserMessage).mock.calls[0][0];
    expect(parts).toContainEqual({
      type: "image-url",
      url: "data:image/png;base64,ABC",
    });
  });

  it("inlines the page snapshot when the artifacts live outside the app", async () => {
    // A sandboxed run retains artifacts under <userData>/test-artifacts.
    // read_file goes through safeJoin and rejects anything escaping the app, so
    // a `../../..` path would guarantee the agent's first step fails.
    const artifact =
      "/home/u/.config/dyad/test-artifacts/1-2-3/test-results/a/test-failed-1.png";
    runner.mockResolvedValue(failResult("boom", artifact));
    screenshot.mockResolvedValue("data:image/png;base64,ABC");
    errorContext.mockResolvedValue("- button 'Submit'\n- text 'Oops'");
    const ctx = makeCtx();

    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );

    expect(out).toContain("- button 'Submit'");
    // The path itself, not just its shape: an absolute artifact path is
    // unreadable for the agent, so naming it sends it somewhere it can only
    // fail. Both negative assertions below pass on output that still leaks it.
    expect(out).not.toContain(artifact);
    expect(out).not.toContain("test-artifacts");
    // No traversal path, and no instruction to open one.
    expect(out).not.toContain("..");
    expect(out).not.toContain("read this first with read_file");
  });

  it("says the snapshot is unavailable rather than naming an unreadable path", async () => {
    runner.mockResolvedValue(
      failResult(
        "boom",
        "/home/u/.config/dyad/test-artifacts/1-2-3/test-results/a/test-failed-1.png",
      ),
    );
    screenshot.mockResolvedValue(null);
    errorContext.mockResolvedValue(null);
    const ctx = makeCtx();

    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );

    expect(out).toContain("Page snapshot: unavailable for this run.");
    expect(out).not.toContain("rely on the page snapshot instead");
    expect(out).not.toContain("error-context.md");
  });

  it("does not require the dev server for a sandboxed run", async () => {
    baseUrl.mockReturnValue(null);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();

    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );

    expect(out).toContain("All runnable tests passed");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("adds a no-progress note when the failure signature is unchanged", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    addEdit(ctx, "e2e-tests/a.spec.ts"); // pass the require-a-change guard
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("did NOT alter the failure");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(2);
  });

  it("refuses to rerun when no files changed since the last run", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("haven't made any changes");
    // Still only the one counted attempt.
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("allows one free flakeCheck rerun without a change and without counting", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(out).toContain("Test run FAILED");
    // Free flake run does not increment the counter.
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("refuses a second flakeCheck rerun of a green spec", async () => {
    // Passes reset the attempt counter, so without this guard a model could
    // loop full isolated runs of an already-passing spec forever by re-sending
    // flakeCheck: true.
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("already passed");
    expect(out).toContain("already used this spec's one flakeCheck rerun");
  });

  it("refuses a second flakeCheck without changes on a failing spec", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("haven't made any changes");
    expect(out).toContain("already used this spec's one flakeCheck rerun");
    // Only the first (non-flake) failure counted.
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("refuses without running once the attempt cap is reached", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    for (let i = 0; i < 4; i++) {
      addEdit(ctx, "e2e-tests/a.spec.ts");
      await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    }
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(4);
    runner.mockClear();
    addEdit(ctx, "e2e-tests/a.spec.ts");
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("Attempt limit reached");
  });

  it("refuses without running once the turn-level run cap is reached", async () => {
    const ctx = makeCtx();
    ctx.testRunCount = 10;
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("Turn-level test run limit reached");
  });

  it("treats a whole-run infra error (no report) as uncounted", async () => {
    runner.mockResolvedValue(infraResult);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("pre-flights a guessed path: doesn't run, returns the real spec list", async () => {
    // The agent guessed a spec that doesn't exist. Rather than spin up the
    // isolated test environment and hit Playwright's opaque "No tests found",
    // the tool short-circuits with the specs that DO exist so it can retry —
    // and never frames it as an unfixable infrastructure problem.
    specLister.mockResolvedValue([
      "e2e-tests/auth-entry.spec.ts",
      "e2e-tests/home.spec.ts",
    ]);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/authentication.spec.ts"] },
      ctx,
    );
    // Never started a run.
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("No spec matches");
    expect(out).toContain("e2e-tests/auth-entry.spec.ts");
    expect(out).toContain("e2e-tests/home.spec.ts");
    expect(out).not.toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    // The specific reason is surfaced to the USER as the warning title.
    expect(emittedXml(ctx)).toContain(
      "No test file matches &quot;e2e-tests/authentication.spec.ts&quot;",
    );
    expect(
      ctx.testRunAttempts.get("e2e-tests/authentication.spec.ts")?.attempts ??
        0,
    ).toBe(0);
  });

  it("never auto-runs a near-miss: suggests the closest match, doesn't execute", async () => {
    // The agent has the right filename but a wrong path (here: no `e2e-tests/`
    // prefix). We do NOT silently run a spec the agent didn't name — we point
    // at the closest match as a suggestion and let it retry with the exact path.
    specLister.mockResolvedValue(["e2e-tests/auth-entry.spec.ts"]);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["auth-entry.spec.ts"] },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("Closest match");
    expect(out).toContain("e2e-tests/auth-entry.spec.ts");
    expect(emittedXml(ctx)).toContain(
      "No test file matches &quot;auth-entry.spec.ts&quot;",
    );
  });

  it("always runs the whole file (never passes a line target)", async () => {
    specLister.mockResolvedValue(["e2e-tests/auth-entry.spec.ts"]);
    runner.mockResolvedValue({
      appId: 1,
      results: [{ file: "e2e-tests/auth-entry.spec.ts", status: "passed" }],
      isolation: { mode: "neon-branch" },
    });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/auth-entry.spec.ts"] },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toMatchObject({
      testFiles: ["e2e-tests/auth-entry.spec.ts"],
    });
    expect(runner.mock.calls[0][0].testLine).toBeUndefined();
    expect(out).toContain("All runnable tests passed");
  });

  it("narrows the run to a subset via grep (never a line target)", async () => {
    caseLister.mockResolvedValue([
      { title: "does a thing", line: 3 },
      { title: "does another thing", line: 12 },
    ]);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does another thing" },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toMatchObject({
      testFiles: ["e2e-tests/a.spec.ts"],
      grep: "does another thing",
    });
    // The agent targets by pattern, never by line.
    expect(runner.mock.calls[0][0].testLine).toBeUndefined();
    // A narrowed pass must not read as a whole-file pass.
    expect(out).toContain("matching /does another thing/ passed");
    expect(out).toContain("Only that subset ran");
  });

  it("allows a grep that matches several tests", async () => {
    // Unlike exact-title targeting, a pattern is meant to match a group — a
    // multi-match run is legitimate, not ambiguous.
    caseLister.mockResolvedValue([
      { title: "user can sign up", line: 3 },
      { title: "user can log in", line: 12 },
      { title: "guest sees a paywall", line: 20 },
    ]);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "user can" },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toMatchObject({ grep: "user can" });
    expect(out).toContain("matching /user can/ passed");
  });

  it("lets Playwright handle grep patterns that don't match parsed leaf titles", async () => {
    caseLister.mockResolvedValue([
      { title: "does a thing", line: 3 },
      { title: "user can sign up", line: 12 },
    ]);
    runner.mockResolvedValue({ appId: 1, results: [] });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "user signs up" },
      ctx,
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ grep: "user signs up" }),
    );
    expect(out).toContain("executed nothing");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("refuses an invalid grep regex without running", async () => {
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "user can (sign up" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("isn't a valid regular expression");
    expect(out).toContain("did NOT count");
    expect(emittedXml(ctx)).toContain("Invalid grep pattern");
  });

  it("accepts grep patterns containing percent signs on Windows", async () => {
    // The spawn uses `node.exe` with `shell: false` (no cmd.exe), so `%` in a
    // grep pattern is plain argv to Playwright. The old `npx.cmd` → cmd.exe
    // path that justified rejecting `%` is gone; a regression test in
    // tests_handlers.preview.test.ts pins `command: "node.exe"` on win32.
    const platformSpy = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("win32");
    caseLister.mockResolvedValue([{ title: "100% complete", line: 3 }]);
    runner.mockResolvedValue(passedResult);
    try {
      const ctx = makeCtx();
      const out = await runTestsTool.execute(
        { testFiles: ["e2e-tests/a.spec.ts"], grep: "100% complete" },
        ctx,
      );
      expect(runner).toHaveBeenCalledTimes(1);
      expect(runner.mock.calls[0][0]).toMatchObject({
        testFiles: ["e2e-tests/a.spec.ts"],
        grep: "100% complete",
      });
      expect(out).toContain("matching /100% complete/ passed");
      expect(out).not.toContain("cmd.exe");
      expect(out).not.toContain("did NOT count");
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("accepts grep patterns containing newlines on Windows", async () => {
    // Same rationale as `%`: `node.exe` (shell: false) takes the value as a
    // single argv element, so CR/LF no longer act as cmd.exe separators.
    const platformSpy = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("win32");
    runner.mockResolvedValue(passedResult);
    try {
      const ctx = makeCtx();
      const out = await runTestsTool.execute(
        { testFiles: ["e2e-tests/a.spec.ts"], grep: "first\r\nsecond" },
        ctx,
      );
      expect(runner).toHaveBeenCalledTimes(1);
      expect(runner.mock.calls[0][0]).toMatchObject({
        grep: "first\r\nsecond",
      });
      expect(out).not.toContain("cmd.exe");
      expect(out).not.toContain("did NOT count");
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("lets a target change bypass the require-a-change guard", async () => {
    // Whole-file run fails; without any edit, narrowing to a subset with grep is
    // a different run and must not be blocked as a pointless rerun.
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does a thing" },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(out).toContain("Test run FAILED");
    // But rerunning the SAME target without an edit is still blocked.
    runner.mockClear();
    const blocked = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does a thing" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(blocked).toContain("haven't made any changes");
  });

  it("explains a grep-narrowed run that executed nothing as skipped (uncounted)", async () => {
    // The pattern matched a test (so it exists) but Playwright ran nothing —
    // the test is test.skip/test.fixme.
    runner.mockResolvedValue({ appId: 1, results: [] });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does a thing" },
      ctx,
    );
    expect(out).toContain("executed nothing");
    expect(out).toContain("test.skip");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("explains a spec that ran but has no runnable tests (uncounted, not infra)", async () => {
    // The spec exists (pre-flight resolved it) but Playwright ran nothing —
    // empty file or every test skipped. Actionable, not an infra dead-end.
    specLister.mockResolvedValue(["e2e-tests/a.spec.ts"]);
    runner.mockResolvedValue({ appId: 1, results: [] });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("ran but nothing executed");
    expect(out).not.toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    expect(emittedXml(ctx)).toContain("no runnable tests — not verified");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("treats an inconclusive (selector/timeout) result as a counted failure", async () => {
    // Regression: a strict-mode / hidden-element failure is a test bug the
    // agent should fix, NOT an 'infrastructure problem'.
    runner.mockResolvedValue(
      inconclusiveResult(
        "strict mode violation: locator resolved to 2 elements",
      ),
    );
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("Test run FAILED");
    expect(out).not.toContain("infrastructure problem");
    expect(out).toContain("locator/timeout/strict-mode");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("truncates long error output", async () => {
    const longError = "x".repeat(9000);
    runner.mockResolvedValue(failResult(longError));
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("(truncated)");
    expect(out.length).toBeLessThan(longError.length);
  });

  it("keeps the fix budget after a grep-narrowed pass (no attempt laundering)", async () => {
    // Only a whole-file pass resets the counter. If a narrowed pass did too,
    // alternating a known-green pattern with a failing one would launder
    // unlimited attempts past the per-spec cap.
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
    addEdit(ctx, "e2e-tests/a.spec.ts");
    runner.mockResolvedValue(passedResult);
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], grep: "does a thing" },
      ctx,
    );
    expect(out).toContain("matching /does a thing/ passed");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("treats an all-skipped spec (errorless inconclusive) as no runnable tests (uncounted)", async () => {
    // `test.skip`/`test.fixme` specs parse as errorless "inconclusive"
    // verdicts; they should ask the agent to un-skip, not burn a fix attempt
    // on locator-failure guidance.
    runner.mockResolvedValue({
      appId: 1,
      results: [
        {
          file: "e2e-tests/a.spec.ts",
          status: "inconclusive",
          tests: [{ title: "does a thing", status: "inconclusive" }],
        },
      ],
      isolation: { mode: "neon-branch" },
    });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("skipped");
    expect(out).toContain("did NOT count");
    expect(out).not.toContain("Test run FAILED");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("survives a thrown runner error: uncounted, and the free flakeCheck is restored", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    runner.mockRejectedValue(new Error("db exploded"));
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    expect(out).toContain("did NOT count");
    expect(out).toContain("db exploded");
    const state = ctx.testRunAttempts.get("e2e-tests/a.spec.ts")!;
    expect(state.attempts).toBe(1);
    // The throw happened after the free flake rerun was consumed — it must be
    // handed back so the model can still use it once the environment is fixed.
    expect(state.flakeCheckUsed).toBeFalsy();
  });

  it("restores the free flakeCheck after a structured (resolved) infra failure", async () => {
    // Infra failures overwhelmingly arrive as RESOLVED infraError results, not
    // throws. The infra reply promises "call run_tests again" — without the
    // refund that retry would be refused (flake rerun spent, no changes made).
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFiles: ["e2e-tests/a.spec.ts"] }, ctx);
    runner.mockResolvedValue(infraResult);
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    expect(out).toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    const state = ctx.testRunAttempts.get("e2e-tests/a.spec.ts")!;
    expect(state.attempts).toBe(1);
    expect(state.flakeCheckUsed).toBeFalsy();
    // And the promised retry actually runs.
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"], flakeCheck: true },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("reports a spec with passing tests plus a skipped test as passing", async () => {
    // A deliberately skipped test (errorless inconclusive) must never read as
    // a failure: the spec would be reported FAILED every run, never record its
    // pass, and drain the whole fix budget on a non-failure.
    runner.mockResolvedValue({
      appId: 1,
      results: [
        {
          file: "e2e-tests/a.spec.ts",
          status: "inconclusive",
          tests: [
            { title: "does a thing", status: "passed" },
            { title: "does another thing", status: "passed" },
            { title: "not ready yet", status: "inconclusive" },
          ],
        },
      ],
      isolation: { mode: "neon-branch" },
    });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("All runnable tests passed");
    expect(out).toContain("2 passed, 1 deliberately skipped");
    expect(out).not.toContain("Test run FAILED");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
    // The pass was recorded: an unchanged rerun is refused.
    runner.mockClear();
    const rerun = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(rerun).toContain("already passed");
  });

  it("does not list a skipped test as FAILED alongside real failures", async () => {
    runner.mockResolvedValue({
      appId: 1,
      results: [
        {
          file: "e2e-tests/a.spec.ts",
          status: "failed",
          error: "boom",
          tests: [
            { title: "does a thing", status: "passed" },
            { title: "breaks", status: "failed", error: "boom" },
            { title: "not ready yet", status: "inconclusive" },
          ],
        },
      ],
      isolation: { mode: "neon-branch" },
    });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFiles: ["e2e-tests/a.spec.ts"] },
      ctx,
    );
    expect(out).toContain("1 passed, 1 failed, 1 deliberately skipped");
    expect(out).toContain('FAILED e2e-tests/a.spec.ts > "breaks"');
    expect(out).not.toContain('FAILED e2e-tests/a.spec.ts > "not ready yet"');
  });
});
