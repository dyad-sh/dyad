import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDuration,
  normalizePtyOutput,
  PtyCommandExecutionError,
  runPtyCommand,
} from "./pty_command_runner";

const { processSpawnMock, spawnMock } = vi.hoisted(() => ({
  processSpawnMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );

  return {
    ...actual,
    default: {
      ...(("default" in actual ? actual.default : actual) as Record<
        string,
        unknown
      >),
      spawn: processSpawnMock,
    },
    spawn: processSpawnMock,
  };
});

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

interface MockPtyController {
  emitData(data: string): void;
  emitExit(event: { exitCode: number; signal?: number }): void;
  pty: {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onExit: ReturnType<typeof vi.fn>;
  };
}

function createMockPtyController(): MockPtyController {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();

  return {
    emitData(data) {
      for (const listener of dataListeners) {
        listener(data);
      }
    },
    emitExit(event) {
      for (const listener of exitListeners) {
        listener(event);
      }
    },
    pty: {
      pid: 1234,
      kill: vi.fn(),
      onData: vi.fn((listener: (data: string) => void) => {
        dataListeners.add(listener);
        return {
          dispose: () => dataListeners.delete(listener),
        };
      }),
      onExit: vi.fn(
        (listener: (event: { exitCode: number; signal?: number }) => void) => {
          exitListeners.add(listener);
          return {
            dispose: () => exitListeners.delete(listener),
          };
        },
      ),
    },
  };
}

async function withPlatform<T>(
  platform: NodeJS.Platform,
  callback: () => Promise<T>,
): Promise<T> {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  }
}

describe("normalizePtyOutput", () => {
  it("strips ANSI sequences and keeps the last carriage-return update", () => {
    expect(
      normalizePtyOutput(
        "\u001b]0;npm install\u0007\u001b[32mfetching\u001b[0m\rfetched\nabc\bXY\r\n",
      ),
    ).toBe("fetched\nabXY");
  });

  it("preserves carriage-return frames when requested", () => {
    expect(
      normalizePtyOutput("Progress 1\rProgress 2\rFailed to download\n", {
        preserveCarriageReturnFrames: true,
      }),
    ).toBe("Progress 1\nProgress 2\nFailed to download");
  });
});

describe("formatDuration", () => {
  it("formats user-facing timeout durations in readable units", () => {
    expect(formatDuration(25)).toBe("25 ms");
    expect(formatDuration(30_000)).toBe("30 seconds");
    expect(formatDuration(10 * 60 * 1000)).toBe("10 minutes");
  });
});

describe("runPtyCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    processSpawnMock.mockReturnValue({
      once: vi.fn().mockReturnThis(),
      unref: vi.fn(),
    });
  });

  it("captures normalized PTY output on success", async () => {
    const controller = createMockPtyController();
    spawnMock.mockReturnValue(controller.pty);

    const promise = runPtyCommand("npx", ["sfw", "--help"], {
      cwd: "/tmp/app",
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "npx",
      ["sfw", "--help"],
      expect.objectContaining({
        cols: 160,
        cwd: "/tmp/app",
        encoding: "utf8",
        env: process.env,
        name: "xterm-color",
        rows: 24,
      }),
    );

    controller.emitData("\u001b[32mResolving\u001b[0m\rResolved\n");
    controller.emitData("added 1 package\r\n");
    controller.emitExit({ exitCode: 0 });

    await expect(promise).resolves.toEqual({
      output: "Resolved\nadded 1 package",
    });
  });

  it("rejects with the captured output when the PTY exits non-zero", async () => {
    const controller = createMockPtyController();
    spawnMock.mockReturnValue(controller.pty);

    const promise = runPtyCommand("pnpm", ["add", "react"]);

    controller.emitData("blocked react\n");
    controller.emitExit({ exitCode: 1 });

    await expect(promise).rejects.toMatchObject({
      exitCode: 1,
      message: "Command 'pnpm add react' exited with code 1",
      name: "PtyCommandExecutionError",
      output: "blocked react",
    } satisfies Partial<PtyCommandExecutionError>);
  });

  it("rejects when the PTY exits due to a signal even with exit code zero", async () => {
    const controller = createMockPtyController();
    spawnMock.mockReturnValue(controller.pty);

    const promise = runPtyCommand("pnpm", ["add", "react"]);

    controller.emitData("Progress 1\rProgress 2\r");
    controller.emitExit({ exitCode: 0, signal: 15 });

    await expect(promise).rejects.toMatchObject({
      exitCode: 0,
      message: "Command 'pnpm add react' was terminated by signal 15",
      output: "Progress 1\nProgress 2",
      signal: 15,
    } satisfies Partial<PtyCommandExecutionError>);
  });

  it("kills the PTY and rejects when the command times out", async () => {
    vi.useFakeTimers();
    const controller = createMockPtyController();
    spawnMock.mockReturnValue(controller.pty);

    const promise = runPtyCommand("npx", ["sfw"], {
      timeoutMs: 25,
    });
    controller.emitData("still running");
    const handledPromise = promise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(25);
    await expect(handledPromise).resolves.toMatchObject({
      exitCode: null,
      message:
        "Command 'npx sfw' timed out after 25 ms. The command may be stuck. Check your network or environment and try again.",
      output:
        "still running\nCommand 'npx sfw' timed out after 25 ms. The command may be stuck. Check your network or environment and try again.",
    } satisfies Partial<PtyCommandExecutionError>);
    expect(controller.pty.kill).toHaveBeenCalledTimes(1);
  });

  it("uses the display-command override in PTY exit errors", async () => {
    const controller = createMockPtyController();
    spawnMock.mockReturnValue(controller.pty);

    const promise = runPtyCommand(
      "cmd.exe",
      ["/d", "/s", "/c", '"npx.cmd" "--yes" "sfw@2.0.4"'],
      {
        displayCommand: "npx --yes sfw@2.0.4",
      },
    );

    controller.emitExit({ exitCode: 1 });

    await expect(promise).rejects.toMatchObject({
      message: "Command 'npx --yes sfw@2.0.4' exited with code 1",
    } satisfies Partial<PtyCommandExecutionError>);
  });

  it("uses taskkill to terminate the PTY process tree on Windows timeouts", async () => {
    await withPlatform("win32", async () => {
      vi.useFakeTimers();
      const controller = createMockPtyController();
      controller.pty.pid = 4321;
      spawnMock.mockReturnValue(controller.pty);

      const promise = runPtyCommand("npx", ["sfw"], {
        timeoutMs: 25,
      });
      const handledPromise = promise.catch((error) => error);

      await vi.advanceTimersByTimeAsync(25);
      await expect(handledPromise).resolves.toBeInstanceOf(
        PtyCommandExecutionError,
      );

      expect(processSpawnMock).toHaveBeenCalledWith(
        "taskkill",
        ["/F", "/T", "/PID", "4321"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      expect(controller.pty.kill).not.toHaveBeenCalled();
    });
  });
});
