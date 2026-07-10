import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));

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

vi.mock("@/paths/paths", () => ({
  getTypeScriptCachePath: () => "/tmp/typescript-utility-test-cache",
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: vi.fn(),
}));

import type { CodeExplorerResult } from "../../../shared/code_explorer_types";
import { runCodeExplorer } from "./code_explorer";
import { generateProblemReport } from "./tsc";

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

describe("TypeScript utility process exclusion", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fully exits each resident process before starting the other kind", async () => {
    const children: FakeUtilityProcess[] = [];
    forkMock.mockImplementation(() => {
      const child = new FakeUtilityProcess();
      children.push(child);
      return child;
    });

    const firstExplorerRequest = runCodeExplorer({
      appPath: "/tmp/example-app",
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

    // The idle explorer remains cached until TSC needs the shared slot. TSC
    // requests its termination but must not fork until the exit event arrives.
    const typeCheck = generateProblemReport({
      fullResponse: "",
      appPath: "/tmp/example-app",
    });
    await vi.waitFor(() => expect(firstExplorer.kill).toHaveBeenCalledOnce());
    expect(children).toHaveLength(1);

    firstExplorer.emit("exit", 0);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    const tsc = children[1];
    tsc.emit("spawn");
    expect(tsc.postMessage).toHaveBeenCalledOnce();
    tsc.emit("message", { success: true, data: { problems: [] } });
    await expect(typeCheck).resolves.toEqual({ problems: [] });
    expect(tsc.kill).toHaveBeenCalledOnce();

    // The TSC result can resolve while its process is shutting down, but no
    // explorer replacement may fork until that process has fully exited.
    const secondExplorerRequest = runCodeExplorer({
      appPath: "/tmp/example-app",
      query: "entry point again",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(children).toHaveLength(2);

    tsc.emit("exit", 0);
    await vi.waitFor(() => expect(children).toHaveLength(3));
    const secondExplorer = children[2];
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
