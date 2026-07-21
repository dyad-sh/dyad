import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));

vi.mock("electron", () => ({
  utilityProcess: { fork: (...args: unknown[]) => forkMock(...args) },
}));

import { runSupabaseDependencyAnalysis } from "./supabase_dependency_analysis";
import { typescriptUtilityProcessScheduler } from "./typescript_utility_process_scheduler";

class FakeUtilityProcess extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn(() => true);
}

describe("runSupabaseDependencyAnalysis", () => {
  let child: FakeUtilityProcess;

  beforeEach(() => {
    child = new FakeUtilityProcess();
    forkMock.mockReset().mockReturnValue(child);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the ephemeral worker to exit after receiving its result", async () => {
    const result = runSupabaseDependencyAnalysis({
      appPath: "/app",
      changedSharedModulePaths: ["supabase/functions/_shared/util.ts"],
    });
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit("spawn");
    expect(child.postMessage).toHaveBeenCalledWith({
      appPath: "/app",
      changedSharedModulePaths: ["supabase/functions/_shared/util.ts"],
    });
    child.emit("message", {
      success: true,
      data: { kind: "partial", functionNames: ["alpha"] },
    });
    expect(child.kill).toHaveBeenCalledOnce();

    let settled = false;
    void result.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    child.emit("exit", 0);
    await expect(result).resolves.toEqual({
      kind: "partial",
      functionNames: ["alpha"],
    });
  });

  it("rejects a clean exit before a reply", async () => {
    const result = runSupabaseDependencyAnalysis({
      appPath: "/app",
      changedSharedModulePaths: [],
    });
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit("spawn");
    child.emit("exit", 0);

    await expect(result).rejects.toThrow("before replying");
  });

  it("maps a fatal utility-process error to a useful memory message", async () => {
    const result = runSupabaseDependencyAnalysis({
      appPath: "/app",
      changedSharedModulePaths: [],
    });
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit("spawn");
    child.emit("error", "FatalError", "v8");
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit("exit", 1);

    await expect(result).rejects.toThrow("ran out of memory");
  });

  it("rejects after the timeout and shutdown grace even without exit", async () => {
    vi.useFakeTimers();
    const result = runSupabaseDependencyAnalysis({
      appPath: "/app",
      changedSharedModulePaths: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    child.emit("spawn");
    const rejection = expect(result).rejects.toThrow("timed out after 60s");
    await vi.advanceTimersByTimeAsync(65_000);
    expect(child.kill).toHaveBeenCalledOnce();
    await rejection;

    const nextOperation = vi.fn(async () => "next");
    const next = typescriptUtilityProcessScheduler.runExclusive(
      "tsc",
      nextOperation,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(nextOperation).not.toHaveBeenCalled();

    // A late exit clears the non-reusable resident registration so later
    // TypeScript workloads can proceed safely.
    child.emit("exit", 1);
    await expect(next).resolves.toBe("next");
  });

  it("returns a valid reply after shutdown grace instead of timing it out", async () => {
    vi.useFakeTimers();
    const result = runSupabaseDependencyAnalysis({
      appPath: "/app",
      changedSharedModulePaths: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    child.emit("spawn");
    child.emit("message", {
      success: true,
      data: { kind: "partial", functionNames: ["alpha"] },
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual({
      kind: "partial",
      functionNames: ["alpha"],
    });
    child.emit("exit", 0);
  });

  it("uses the first reply if another message arrives before exit", async () => {
    const result = runSupabaseDependencyAnalysis({
      appPath: "/app",
      changedSharedModulePaths: [],
    });
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit("spawn");
    child.emit("message", {
      success: true,
      data: { kind: "partial", functionNames: ["alpha"] },
    });
    child.emit("message", {
      success: true,
      data: { kind: "partial", functionNames: ["beta"] },
    });
    child.emit("exit", 0);

    await expect(result).resolves.toEqual({
      kind: "partial",
      functionNames: ["alpha"],
    });
  });
});
