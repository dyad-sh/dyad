import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { forkMock, runBufferedProcessMock } = vi.hoisted(() => ({
  forkMock: vi.fn(),
  runBufferedProcessMock: vi.fn(),
}));

vi.mock("electron", () => ({
  utilityProcess: {
    fork: (...args: unknown[]) => forkMock(...args),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  return {
    ...actual,
    getTypeScriptCachePath: () => "/tmp/typescript-utility-test-cache",
    getUserDataPath: () => "/tmp/typescript-utility-test-user-data",
  };
});

vi.mock("@/ipc/utils/buffered_process", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/buffered_process")>();
  return { ...actual, runBufferedProcess: runBufferedProcessMock };
});

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: vi.fn(),
}));

import type { CodeExplorerResult } from "../../../shared/code_explorer_types";
import { runCodeExplorer } from "./code_explorer";
import { clearTypeScriptVersionCacheForTests, runTypeScriptCheck } from "./tsc";

class FakeUtilityProcess extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn(() => true);
}

const explorerResult: CodeExplorerResult = {
  query: "entry point",
  totalSymbols: 0,
  totalFiles: 0,
  indexedFileCount: 0,
  indexMs: 0,
  searchMs: 0,
  files: [],
  truncated: false,
  notes: [],
};

function processResult(overrides: Record<string, unknown> = {}) {
  return {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    aborted: false,
    timedOut: false,
    ...overrides,
  };
}

describe("TypeScript utility process exclusion", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fully exits each resident process before starting the other kind", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-ts-scheduler-"),
    );
    await fs.mkdir(path.join(appPath, "node_modules", "typescript"), {
      recursive: true,
    });
    await fs.mkdir(path.join(appPath, "node_modules", ".bin"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "node_modules", "typescript", "package.json"),
      "{}",
    );
    await fs.writeFile(path.join(appPath, "node_modules", ".bin", "tsc"), "");
    await fs.writeFile(path.join(appPath, "tsconfig.json"), "{}");
    clearTypeScriptVersionCacheForTests();

    const children: FakeUtilityProcess[] = [];
    forkMock.mockImplementation(() => {
      const child = new FakeUtilityProcess();
      children.push(child);
      return child;
    });

    const firstExplorerRequest = runCodeExplorer({
      appPath,
      query: "entry point",
    });
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const firstExplorer = children[0];
    firstExplorer.emit("spawn");
    await vi.waitFor(() =>
      expect(firstExplorer.postMessage).toHaveBeenCalledOnce(),
    );
    const firstRequestId = firstExplorer.postMessage.mock.calls[0][0].requestId;
    firstExplorer.emit("message", {
      requestId: firstRequestId,
      success: true,
      data: explorerResult,
    });
    await expect(firstExplorerRequest).resolves.toEqual(explorerResult);

    // The idle explorer remains cached until the CLI needs the shared slot.
    // The CLI must not launch until the explorer's exit event arrives.
    let finishTypeCheck!: (value: ReturnType<typeof processResult>) => void;
    runBufferedProcessMock
      .mockResolvedValueOnce(processResult({ stdout: "Version 7.0.0\n" }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishTypeCheck = resolve;
          }),
      );
    const typeCheck = runTypeScriptCheck({ appPath });
    await vi.waitFor(() => expect(firstExplorer.kill).toHaveBeenCalledOnce());
    expect(children).toHaveLength(1);
    expect(runBufferedProcessMock).not.toHaveBeenCalled();

    firstExplorer.emit("exit", 0);
    await vi.waitFor(() =>
      expect(runBufferedProcessMock).toHaveBeenCalledTimes(2),
    );

    // No explorer replacement may launch until the CLI has fully exited and
    // its scheduled operation resolves.
    const secondExplorerRequest = runCodeExplorer({
      appPath,
      query: "entry point again",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(children).toHaveLength(1);

    finishTypeCheck(processResult());
    await expect(typeCheck).resolves.toEqual({ problems: [] });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    const secondExplorer = children[1];
    secondExplorer.emit("spawn");
    await vi.waitFor(() =>
      expect(secondExplorer.postMessage).toHaveBeenCalledOnce(),
    );
    const secondRequestId =
      secondExplorer.postMessage.mock.calls[0][0].requestId;
    secondExplorer.emit("message", {
      requestId: secondRequestId,
      success: true,
      data: { ...explorerResult, query: "entry point again" },
    });
    await expect(secondExplorerRequest).resolves.toEqual({
      ...explorerResult,
      query: "entry point again",
    });

    // Clear the reusable resident and its idle timer for test isolation.
    secondExplorer.emit("exit", 0);
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("waits for an idle explorer to exit before starting its replacement", async () => {
    const children: FakeUtilityProcess[] = [];
    forkMock.mockImplementation(() => {
      const child = new FakeUtilityProcess();
      children.push(child);
      return child;
    });

    const firstRequest = runCodeExplorer({
      appPath: "/tmp/idle-race-app",
      query: "first query",
    });
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const firstExplorer = children[0];
    firstExplorer.emit("spawn");
    await vi.waitFor(() =>
      expect(firstExplorer.postMessage).toHaveBeenCalledOnce(),
    );

    // Install the idle timer under fake timers, then let it begin shutdown
    // without emitting the process exit yet.
    vi.useFakeTimers();
    const firstRequestId = firstExplorer.postMessage.mock.calls[0][0].requestId;
    firstExplorer.emit("message", {
      requestId: firstRequestId,
      success: true,
      data: { ...explorerResult, query: "first query" },
    });
    await expect(firstRequest).resolves.toEqual({
      ...explorerResult,
      query: "first query",
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(firstExplorer.kill).toHaveBeenCalledOnce();

    const secondRequest = runCodeExplorer({
      appPath: "/tmp/idle-race-app",
      query: "second query",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(1);

    // The scheduler may fork the replacement only after the dying resident's
    // actual exit event clears its registration.
    firstExplorer.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(2);
    const secondExplorer = children[1];
    secondExplorer.emit("spawn");
    await vi.advanceTimersByTimeAsync(0);
    expect(secondExplorer.postMessage).toHaveBeenCalledOnce();
    const secondRequestId =
      secondExplorer.postMessage.mock.calls[0][0].requestId;
    secondExplorer.emit("message", {
      requestId: secondRequestId,
      success: true,
      data: { ...explorerResult, query: "second query" },
    });
    await expect(secondRequest).resolves.toEqual({
      ...explorerResult,
      query: "second query",
    });
    secondExplorer.emit("exit", 0);
  });
});
