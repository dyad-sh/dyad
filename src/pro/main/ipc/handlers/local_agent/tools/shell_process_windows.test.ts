// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), treeKill: vi.fn() }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    default: { ...actual, spawn: mocks.spawn, spawnSync: vi.fn() },
    spawn: mocks.spawn,
    spawnSync: vi.fn(),
  };
});
vi.mock("tree-kill", () => ({ default: mocks.treeKill }));
import { runShellProcess, SHELL_SHUTDOWN_TIMEOUT_MS } from "./shell_process";
let child: EventEmitter & {
  pid: number;
  stdout: PassThrough;
  stderr: PassThrough;
  unref: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  vi.useFakeTimers();
  child = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unref: vi.fn(),
  });
  mocks.spawn.mockReturnValue(child);
  mocks.treeKill.mockImplementation((_pid, _signal, done) => done());
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("never calls taskkill after normal Windows exit or close", async () => {
  const pending = runShellProcess(
    {
      command: "Write-Output ok",
      cwd: "C:\\app",
      timeoutMs: 1000,
      onOutput: vi.fn(),
    },
    "win32",
  );
  child.emit("exit", 0);
  child.emit("close", 0);
  await pending;
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.treeKill).not.toHaveBeenCalled();
});
it("kills a live Windows tree only once on cancellation", async () => {
  const controller = new AbortController();
  const pending = runShellProcess(
    {
      command: "Start-Sleep 30",
      cwd: "C:\\app",
      timeoutMs: 1000,
      onOutput: vi.fn(),
      signal: controller.signal,
    },
    "win32",
  );
  controller.abort();
  expect(mocks.treeKill).toHaveBeenCalledTimes(1);
  child.emit("exit", null);
  child.emit("close", null);
  expect((await pending).status).toBe("cancelled");
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.treeKill).toHaveBeenCalledTimes(1);
});
it("does not target an exited root while inherited pipes drain", async () => {
  const controller = new AbortController();
  const pending = runShellProcess(
    {
      command: "Write-Output ok",
      cwd: "C:\\app",
      timeoutMs: 1000,
      onOutput: vi.fn(),
      signal: controller.signal,
    },
    "win32",
  );
  child.emit("exit", 0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(2000);
  child.emit("close", 0);
  await pending;
  expect(mocks.treeKill).not.toHaveBeenCalled();
});

it.each(["win32", "linux"] as const)(
  "settles %s cancellation when descendants never close pipes",
  async (platform) => {
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new AbortController();
    const pending = runShellProcess(
      {
        command: "echo ok",
        cwd: "C:\\app",
        timeoutMs: 1000,
        signal: controller.signal,
        onOutput: vi.fn(),
      },
      platform,
    );
    child.stdout.write("partial output");
    child.emit("exit", 0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(SHELL_SHUTDOWN_TIMEOUT_MS);
    expect(await pending).toMatchObject({
      status: "cancelled",
      shutdownUnconfirmed: true,
      stdout: "partial output",
    });
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    if (platform === "win32") expect(mocks.treeKill).not.toHaveBeenCalled();
  },
);
it("bounds a hung Windows taskkill callback even after close", async () => {
  mocks.treeKill.mockImplementation(() => {});
  const pending = runShellProcess(
    {
      command: "echo ok",
      cwd: "C:\\app",
      timeoutMs: 1000,
      onOutput: vi.fn(),
    },
    "win32",
  );
  await vi.advanceTimersByTimeAsync(1000);
  child.emit("exit", null);
  child.emit("close", null);
  await vi.advanceTimersByTimeAsync(SHELL_SHUTDOWN_TIMEOUT_MS);
  expect(await pending).toMatchObject({
    status: "timed_out",
    shutdownUnconfirmed: true,
  });
  expect(mocks.treeKill).toHaveBeenCalledTimes(1);
});
