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
import { runClaudeTurn } from "./runtime";
import { getClaudeUsageLimits, setClaudeUsageAccount } from "./usage_limits";

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
