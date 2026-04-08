import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizePtyOutput,
  PtyCommandExecutionError,
  runPtyCommand,
} from "./pty_command_runner";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}));

interface MockPtyController {
  emitData(data: string): void;
  emitExit(event: { exitCode: number; signal?: number }): void;
  pty: {
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

describe("normalizePtyOutput", () => {
  it("strips ANSI sequences and keeps the last carriage-return update", () => {
    expect(
      normalizePtyOutput(
        "\u001b]0;npm install\u0007\u001b[32mfetching\u001b[0m\rfetched\nabc\bXY\r\n",
      ),
    ).toBe("fetched\nabXY");
  });
});

describe("runPtyCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
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

  it("kills the PTY and rejects when the command times out", async () => {
    vi.useFakeTimers();
    const controller = createMockPtyController();
    spawnMock.mockReturnValue(controller.pty);

    const promise = runPtyCommand("npx", ["sfw"], {
      timeoutMs: 25,
    });
    controller.emitData("still running");

    const rejection = expect(promise).rejects.toMatchObject({
      exitCode: null,
      message: "Command 'npx sfw' timed out after 25ms",
      output: "still running",
    } satisfies Partial<PtyCommandExecutionError>);

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(controller.pty.kill).toHaveBeenCalledTimes(1);
  });
});
