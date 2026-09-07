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
    readOnly: true,
    mcpConfigPath: "/config",
    signal,
    onEvent: vi.fn().mockResolvedValue(undefined),
  };
}
afterEach(() => vi.restoreAllMocks());

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
