import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above the imports, so the mock fn must be created with
// `vi.hoisted` to exist when the factory runs.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

// Mirror the pattern from pty_command_runner.test.ts: override the named `spawn`
// AND `default.spawn` so vitest's CJS/ESM interop lands on the mock regardless
// of how the consumer destructures `child_process`.
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    default: {
      ...(("default" in actual ? actual.default : actual) as Record<
        string,
        unknown
      >),
      spawn: spawnMock,
    },
    spawn: spawnMock,
  };
});
// spawn_streaming imports electron-log (which pulls in the `electron` native
// module) and tree-kill; stub both so the test loads in a headless CI box.
vi.mock("electron-log/main", () => ({
  default: {
    scope: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  },
}));
vi.mock("tree-kill", () => ({ default: () => {} }));

import {
  buildSpawnStreamingInvocation,
  spawnStreaming,
} from "./spawn_streaming";

/**
 * A minimal `ChildProcess` stand-in: `spawnStreaming` attaches `data`
 * listeners to stdout/stderr and `close`/`error` listeners to the child.
 * Emitting `close` resolves the returned promise.
 */
function fakeChild(): unknown {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 12345,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: () => true,
  });
  spawnMock.mockReturnValueOnce(child);
  return child;
}

describe("buildSpawnStreamingInvocation", () => {
  it("wraps Windows command shims and preserves grep regex metacharacters", () => {
    expect(
      buildSpawnStreamingInvocation(
        "npx",
        ["playwright", "test", "-g", "user can (sign up|log in)"],
        "win32",
        "cmd.exe",
      ),
    ).toEqual({
      command: "cmd.exe",
      // The `/c` payload is outer-quoted (consumed by `/s`); the inner quotes
      // are the cmd-style quoting. `useVerbatimArguments` opts out of libuv's
      // MSVC re-escaping.
      args: [
        "/d",
        "/s",
        "/c",
        '"npx.cmd playwright test -g "user can (sign up|log in)""',
      ],
      useVerbatimArguments: true,
    });
  });

  it("keeps Unix invocations as direct argv calls", () => {
    expect(
      buildSpawnStreamingInvocation("npx", ["playwright", "test"], "linux"),
    ).toEqual({
      command: "npx",
      args: ["playwright", "test"],
    });
  });
});

describe("spawnStreaming: windowsVerbatimArguments handoff", () => {
  it("forwards a Windows batch-shim invocation verbatim so libuv does not re-escape it", async () => {
    const child = fakeChild();
    // `process.platform` is the default platform; force win32 so the batch
    // path is taken without depending on the test host OS.
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const result = spawnStreaming({
        command: "npx",
        args: ["playwright", "test", "--grep", "(a|b) c"],
        cwd: ".",
      });
      (child as EventEmitter).emit("close", 0);
      await result;
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }

    const [, , options] = spawnMock.mock.calls.at(-1)! as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect((options as { shell: boolean }).shell).toBe(false);
    // The whole point of the fix: libuv forwards the already cmd-quoted `/c`
    // payload unchanged instead of MSVC-escaping it a second time.
    expect(options.windowsVerbatimArguments).toBe(true);
    // And the payload still carries the outer pair of quotes `/s` strips.
    const passedArgs = spawnMock.mock.calls.at(-1)![1] as string[];
    expect(passedArgs[3]).toBe('"npx.cmd playwright test --grep "(a|b) c""');
  });

  it("leaves windowsVerbatimArguments disabled for a real executable", async () => {
    const child = fakeChild();
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const result = spawnStreaming({
        command: "node.exe",
        args: ["script.js", "a b"],
        cwd: ".",
      });
      (child as EventEmitter).emit("close", 0);
      await result;
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }

    const [, , options] = spawnMock.mock.calls.at(-1)! as [
      string,
      string[],
      Record<string, unknown>,
    ];
    // A real executable's raw args still need libuv's MSVC argv-quoting (e.g.
    // a path with spaces passed to `node.exe`), so verbatim must stay off.
    expect(options.windowsVerbatimArguments).toBe(false);
  });
});
