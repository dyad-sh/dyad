// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const state = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: state.spawn,
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  access: vi.fn().mockResolvedValue(undefined),
}));
import { runClaudeTurn, safeClaudeDiagnostic } from "./runtime";
import { getClaudeUsageLimits, setClaudeUsageAccount } from "./usage_limits";
import { DyadErrorKind } from "@/errors/dyad_error";

function child() {
  return Object.assign(new EventEmitter(), {
    pid: 999999,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}
function options(signal: AbortSignal) {
  return {
    cwd: "/disposable",
    prompt: "test",
    model: "sonnet",
    sessionId: "explicit-session",
    resume: false,

    mcpConfigPath: "/config",
    signal,
    onEvent: vi.fn().mockResolvedValue(undefined),
  };
}
afterEach(() => vi.restoreAllMocks());

it("captures usage from the CLI stream while forwarding the original event", async () => {
  state.spawn.mockClear();
  setClaudeUsageAccount("stream-account");
  const spawned = child();
  state.spawn.mockReturnValue(spawned);
  const turn = options(new AbortController().signal);
  const running = runClaudeTurn(turn);
  await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled());
  const event = {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      unifiedWindows: {
        five_hour: { utilization: 0.25, resetsAt: Date.now() / 1000 + 3600 },
      },
    },
  };
  spawned.stdout.write(JSON.stringify(event) + "\n");
  spawned.emit("close", 0);
  await running;
  expect(turn.onEvent).toHaveBeenCalledWith(event);
  expect(getClaudeUsageLimits().windows).toEqual([
    expect.objectContaining({ name: "five_hour", usedPercent: 25 }),
  ]);
  setClaudeUsageAccount(null);
});

it("decodes split UTF-8 and drains ordered events before completion", async () => {
  const process = child();
  state.spawn.mockReturnValue(process);
  const turn = options(new AbortController().signal);
  const running = runClaudeTurn(turn);
  await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled());
  const bytes = Buffer.from('{"text":"🌊"}\n');
  process.stdout.write(bytes.subarray(0, 11));
  process.stdout.write(bytes.subarray(11));
  await vi.waitFor(() =>
    expect(turn.onEvent).toHaveBeenCalledWith({ text: "🌊" }),
  );
  process.emit("close", 0);
  await running;
  expect(turn.onEvent).toHaveBeenCalledWith({ text: "🌊" });
});

it("shows a Claude Code OAuth refresh error from the CLI stream", async () => {
  const spawned = child();
  state.spawn.mockReturnValue(spawned);
  const running = runClaudeTurn(options(new AbortController().signal));
  await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled());
  spawned.stdout.write(
    JSON.stringify({
      type: "assistant",
      message: {
        model: "<synthetic>",
        content: [
          {
            type: "text",
            text: "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again",
          },
        ],
      },
    }) + "\n",
  );
  spawned.emit("close", 1);
  await expect(running).rejects.toMatchObject({
    message:
      "Claude Code: Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again",
    kind: DyadErrorKind.Precondition,
  });
});

it("preserves Claude login guidance without exposing paths or credentials", () => {
  expect(safeClaudeDiagnostic("Please run /login to reconnect.")).toBe(
    "Please run /login to reconnect.",
  );
  const secret = safeClaudeDiagnostic(
    "Please run /login. Diagnostic path: /Users/alice/private project. Authorization: Bearer secret-token-value",
  );
  expect(secret).toContain("/login");
  expect(secret).not.toContain("/Users/alice");
  expect(secret).not.toContain("secret-token-value");
  expect(
    safeClaudeDiagnostic("OAuth token: sk-ant-abcdefghijklmnop"),
  ).not.toContain("sk-ant-abcdefghijklmnop");
  expect(safeClaudeDiagnostic("Read /login/private/secret.txt")).not.toContain(
    "/login/private/secret.txt",
  );
});

it("redacts and bounds stderr when the CLI has no structured error", async () => {
  const spawned = child();
  state.spawn.mockReturnValue(spawned);
  const running = runClaudeTurn(options(new AbortController().signal));
  await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled());
  spawned.stderr.write(
    `Request failed for /Users/alice/private project with Authorization: Bearer secret-token-value\n${"x".repeat(10_000)}`,
  );
  spawned.emit("close", 1);
  const error = (await running.catch((caught: Error) => caught)) as Error;
  expect(error.message).toContain("Claude Code:");
  expect(error.message).not.toContain("/Users/alice");
  expect(error.message).not.toContain("secret-token-value");
  expect(error.message.length).toBeLessThan(4_000);
});

it("keeps the generic exit message when the CLI reports no detail", async () => {
  const spawned = child();
  state.spawn.mockReturnValue(spawned);
  const running = runClaudeTurn(options(new AbortController().signal));
  await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled());
  spawned.emit("close", 1);
  await expect(running).rejects.toMatchObject({
    message: expect.stringContaining("Claude Code exited (1)"),
    kind: DyadErrorKind.External,
  });
});

it.skipIf(process.platform === "win32")(
  "cancellation signals the process group and waits for actual process exit",
  async () => {
    state.spawn.mockClear();
    const spawned = child();
    state.spawn.mockReturnValue(spawned);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const controller = new AbortController();
    let settled = false;
    const running = runClaudeTurn(options(controller.signal)).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled());
    controller.abort();
    expect(kill).toHaveBeenCalledWith(-999999, "SIGINT");
    await Promise.resolve();
    expect(settled).toBe(false);
    spawned.emit("close", null);
    await running;
    expect(settled).toBe(true);
  },
);

it("drains stdout after an oversized frame so process close can settle the turn", async () => {
  state.spawn.mockClear();
  const spawned = child();
  state.spawn.mockReturnValue(spawned);
  vi.spyOn(process, "kill").mockReturnValue(true);
  const turn = options(new AbortController().signal);
  const running = runClaudeTurn(turn);
  const rejection = expect(running).rejects.toThrow(
    "stream frame exceeded limit",
  );
  await vi.waitFor(() => expect(state.spawn).toHaveBeenCalledOnce());
  // Model ChildProcess's close-after-stdio-EOF contract, not a synthetic close
  // that would hide the paused pipe bug.
  spawned.stdout.once("end", () => spawned.emit("close", null));
  spawned.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 1, "x"));
  spawned.stdout.end("ignored after failure");
  await rejection;
  expect(turn.onEvent).not.toHaveBeenCalled();
});
