import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { shouldFilterTelemetryException } from "@/ipc/utils/telemetry";
import type { ProblemReport } from "@/ipc/types";
import {
  generateProblemReport,
  getTypeCheckPreconditionKind,
  toProblemReportError,
  TypeCheckPreconditionError,
} from "./tsc";

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));

vi.mock("electron", () => ({
  utilityProcess: { fork: forkMock },
}));

// getTypeScriptCachePath() resolves paths via the Electron `app` object, which
// does not exist under Vitest; stub just that export.
vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  return {
    ...actual,
    getTypeScriptCachePath: vi.fn(() => "/fake/typescript-cache"),
  };
});

describe("toProblemReportError", () => {
  it("propagates structured worker error kinds", () => {
    const error = toProblemReportError(
      new Error("Cannot find module 'typescript'"),
      "typescript-not-found",
    );

    expect(error).toBeInstanceOf(TypeCheckPreconditionError);
    expect((error as TypeCheckPreconditionError).kind).toBe(
      DyadErrorKind.Precondition,
    );
    expect(getTypeCheckPreconditionKind(error)).toBe("typescript-not-found");
    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("classifies missing TypeScript as a filtered precondition error", () => {
    const error = toProblemReportError(
      new Error(
        "Failed to load TypeScript from C:\\Users\\jazzm\\dyad-apps\\wandering-koala-nudge because of Error: Cannot find module 'typescript'",
      ),
    );

    expect(error).toBeInstanceOf(DyadError);
    expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
    expect(getTypeCheckPreconditionKind(error)).toBe("typescript-not-found");
    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("classifies missing tsconfig as a filtered precondition error", () => {
    const error = toProblemReportError(
      new Error(
        "No TypeScript configuration file found in /app. Expected one of: tsconfig.app.json, tsconfig.json",
      ),
    );

    expect(error).toBeInstanceOf(DyadError);
    expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
    expect(getTypeCheckPreconditionKind(error)).toBe("tsconfig-not-found");
    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("preserves unexpected worker failures for telemetry", () => {
    const error = toProblemReportError(
      new Error("TypeScript config error: invalid compiler option"),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DyadError);
    expect(shouldFilterTelemetryException(error)).toBe(false);
  });
});

/**
 * Fake for Electron's UtilityProcess: an EventEmitter so tests can emit the
 * real event sequences (spawn/message/error/exit) with spies for the methods
 * generateProblemReport calls.
 */
class FakeUtilityProcess extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn(() => {
    this.emit("exit", 0);
    return true;
  });
}

const TSC_WORKER_TIMEOUT_MS = 5 * 60 * 1000;

describe("generateProblemReport", () => {
  let child: FakeUtilityProcess;

  beforeEach(() => {
    child = new FakeUtilityProcess();
    forkMock.mockReset();
    forkMock.mockImplementation(() => child);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const start = () =>
    generateProblemReport({ fullResponse: "", appPath: "/fake/app" });

  it("resolves with the worker's report, posting input only after spawn", async () => {
    const report: ProblemReport = { problems: [] };

    const promise = start();

    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(forkMock.mock.calls[0][0]).toMatch(/tsc_worker\.js$/);
    expect(forkMock.mock.calls[0][2]).toEqual({
      serviceName: "dyad-tsc-worker",
    });

    // The request must not be posted before the IPC channel is established.
    expect(child.postMessage).not.toHaveBeenCalled();
    child.emit("spawn");
    expect(child.postMessage).toHaveBeenCalledTimes(1);
    expect(child.postMessage).toHaveBeenCalledWith({
      virtualChanges: { deletePaths: [], renameTags: [], writeTags: [] },
      appPath: "/fake/app",
      tsBuildInfoCacheDir: "/fake/typescript-cache",
    });

    child.emit("message", { success: true, data: report });

    await expect(promise).resolves.toEqual(report);
    expect(child.kill).toHaveBeenCalled();
  });

  it("rejects when the worker replies with a failure output", async () => {
    const promise = start();
    child.emit("spawn");
    child.emit("message", {
      success: false,
      error: "Cannot find module 'typescript'",
      errorKind: "typescript-not-found",
    });

    await expect(promise).rejects.toThrow("Cannot find module 'typescript'");
    await expect(promise).rejects.toBeInstanceOf(TypeCheckPreconditionError);
    expect(child.kill).toHaveBeenCalled();
  });

  it("rejects when the worker exits with code 0 before replying", async () => {
    const promise = start();
    child.emit("spawn");
    child.emit("exit", 0);

    await expect(promise).rejects.toThrow("Worker exited with code 0");
  });

  it("rejects when the worker exits with a nonzero code before replying", async () => {
    const promise = start();
    child.emit("exit", 134);

    await expect(promise).rejects.toThrow("Worker exited with code 134");
  });

  it("maps a FatalError to an out-of-memory failure", async () => {
    const promise = start();
    child.emit("spawn");
    child.emit("error", "FatalError", "v8", {});

    await expect(promise).rejects.toThrow(
      "Type check failed: the TypeScript worker ran out of memory. This can happen with very large apps.",
    );
    expect(child.kill).toHaveBeenCalled();
  });

  it("rejects and kills the worker when the type check times out", async () => {
    vi.useFakeTimers();

    const promise = start();
    child.emit("spawn");
    const expectation = expect(promise).rejects.toThrow(
      "Type check timed out after 300s",
    );

    await vi.advanceTimersByTimeAsync(TSC_WORKER_TIMEOUT_MS);

    await expectation;
    expect(child.kill).toHaveBeenCalled();
  });

  it("ignores an exit that arrives after the worker already replied", async () => {
    const report: ProblemReport = {
      problems: [
        {
          file: "src/App.tsx",
          line: 1,
          column: 1,
          message: "Type error",
          code: 2322,
          snippet: "const x: string = 1;",
        },
      ],
    };

    const promise = start();
    child.emit("spawn");
    child.emit("message", { success: true, data: report });
    // kill() triggers a real exit event afterwards; it must not double-settle.
    child.emit("exit", 0);

    await expect(promise).resolves.toEqual(report);
  });
});
