// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
  killTree: vi.fn(),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  access: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/disposable-model-probe"),
  rm: mocks.rm,
}));
vi.mock("@/ipc/utils/kill_process_tree_sync", () => ({
  killProcessTreeSync: mocks.killTree,
}));

import { listClaudeModels, stopClaudeProcesses } from "./runtime";

const catalog = [
  {
    value: "opus[1m]",
    displayName: "Opus (1M context)",
    description: "Model from CLI",
  },
];

function child() {
  return Object.assign(new EventEmitter(), {
    pid: 999999,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
}

async function start() {
  const spawned = child();
  mocks.spawn.mockReturnValue(spawned);
  const result = listClaudeModels();
  // Attach a rejection handler before driving error events.
  void result.catch(() => {});
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
  const request = JSON.parse(spawned.stdin.read().toString());
  const reply = (models: unknown = catalog) =>
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request.request_id,
        response: { models, account: { email: "private@example.com" } },
      },
    });
  return { spawned, result, request, reply };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "kill").mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("discovers the CLI catalog without a user prompt and strips private initialization fields", async () => {
  const { spawned, result, request, reply } = await start();
  expect(request).toEqual({
    type: "control_request",
    request_id: expect.any(String),
    request: { subtype: "initialize" },
  });
  const [, args, options] = mocks.spawn.mock.calls[0];
  expect(args).toEqual(
    expect.arrayContaining([
      "--restricted",
      "--strict-mcp-config",
      "--no-session-persistence",
    ]),
  );
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  expect(JSON.parse(args[args.indexOf("--mcp-config") + 1])).toEqual({
    mcpServers: {},
  });
  expect(JSON.parse(args[args.indexOf("--settings") + 1])).toEqual({
    disableAllHooks: true,
    enabledPlugins: {},
    autoMemoryEnabled: false,
  });
  expect(options.cwd).toBe("/disposable-model-probe");
  expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
  spawned.stdout.write(reply([{ ...catalog[0], supportsEffort: true }]));
  spawned.stdout.write("\n");
  expect(mocks.rm).not.toHaveBeenCalled();
  spawned.emit("close", 137);
  await expect(result).resolves.toEqual(catalog);
  expect(mocks.rm).toHaveBeenCalledWith(options.cwd, {
    recursive: true,
    force: true,
  });
  expect(spawned.stdin.read()).toBeNull();
  const kills =
    vi.mocked(process.kill).mock.calls.length +
    mocks.killTree.mock.calls.length;
  stopClaudeProcesses();
  expect(
    vi.mocked(process.kill).mock.calls.length +
      mocks.killTree.mock.calls.length,
  ).toBe(kills);
});

it("matches the initialize request, handles split UTF-8, and accepts a final unterminated line", async () => {
  const { spawned, result, reply } = await start();
  spawned.stdout.write(
    '{"type":"control_response","response":{"request_id":"unrelated","subtype":"error"}}\n',
  );
  const models = [{ ...catalog[0], displayName: "Model 🌊" }];
  const bytes = Buffer.from(reply(models));
  const split = bytes.indexOf(Buffer.from("🌊")) + 2;
  spawned.stdout.write(bytes.subarray(0, split));
  spawned.stdout.write(bytes.subarray(split));
  spawned.emit("close", 0);
  await expect(result).resolves.toEqual(models);
});

it.each([
  ["missing models", undefined],
  ["invalid model", [{ value: "missing-label" }]],
  ["oversized catalog", Array.from({ length: 129 }, () => catalog[0])],
])("rejects %s without exposing the raw response", async (_, models) => {
  const { spawned, result, reply } = await start();
  spawned.stdout.write(reply(models === undefined ? null : models) + "\n");
  spawned.emit("close", 0);
  await expect(result).rejects.toThrow("Could not load Claude Code models");
  expect(mocks.rm).toHaveBeenCalledOnce();
});

it.each([
  "malformed JSON",
  "oversized output",
  "control error",
  "early exit",
  "spawn error",
])("cleans up after %s", async (scenario) => {
  const { spawned, result, request } = await start();
  if (scenario === "malformed JSON") spawned.stdout.write("not-json\n");
  if (scenario === "oversized output")
    spawned.stdout.write("x".repeat(1024 * 1024 + 1));
  if (scenario === "control error")
    spawned.stdout.write(
      JSON.stringify({
        type: "control_response",
        response: {
          request_id: request.request_id,
          subtype: "error",
          error: "private error",
        },
      }) + "\n",
    );
  if (scenario === "spawn error")
    spawned.emit("error", new Error("private error"));
  spawned.emit("close", 1);
  await expect(result).rejects.toThrow("Could not load Claude Code models");
  expect(mocks.rm).toHaveBeenCalledOnce();
});

it("times out a hung CLI and waits for process exit before removing its directory", async () => {
  vi.useFakeTimers();
  const { spawned, result } = await start();
  await vi.advanceTimersByTimeAsync(10_000);
  if (process.platform === "win32")
    expect(mocks.killTree).toHaveBeenCalledWith(spawned.pid);
  else expect(process.kill).toHaveBeenCalledWith(-spawned.pid, "SIGKILL");
  expect(mocks.rm).not.toHaveBeenCalled();
  spawned.emit("close", null);
  await expect(result).rejects.toThrow("Could not load Claude Code models");
  expect(mocks.rm).toHaveBeenCalledOnce();
});

it("coalesces concurrent model probes and releases the flight for refresh", async () => {
  const first = await start();
  expect(listClaudeModels()).toBe(first.result);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  first.spawned.stdout.write(first.reply() + "\n");
  first.spawned.emit("close", 0);
  await first.result;
  mocks.spawn.mockClear();
  const next = await start();
  expect(next.result).not.toBe(first.result);
  next.spawned.stdout.write(next.reply() + "\n");
  next.spawned.emit("close", 0);
  await next.result;
});
