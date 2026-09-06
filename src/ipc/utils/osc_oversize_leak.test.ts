import { beforeEach, describe, expect, it, vi } from "vitest";
import { PtyCommandExecutionError, runPtyCommand } from "./pty_command_runner";

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

/**
 * Build an ST-terminated OSC whose payload (bytes after `]`) is `payloadBytes`
 * bytes long, followed by the literal `VISIBLE` marker. The payload is
 * `0;` followed by `payloadBytes - 2` `x` bytes; the ST terminator is `ESC \`.
 */
function buildStTerminatedOsc(payloadBytes: number): string {
  const fill = "x".repeat(Math.max(0, payloadBytes - 2));
  return `\u001b]0;${fill}\u001b\\VISIBLE`;
}

/** Build a BEL-terminated OSC with `payloadBytes` bytes of payload after `]`. */
function buildBelTerminatedOsc(payloadBytes: number): string {
  const fill = "x".repeat(Math.max(0, payloadBytes - 2));
  return `\u001b]0;${fill}\u0007VISIBLE`;
}

/** Split a string into chunks of at most `chunkSize` characters. */
function splitChunks(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks.length === 0 ? [""] : chunks;
}

async function runSingleChunk(input: string): Promise<string> {
  const controller = createMockPtyController();
  spawnMock.mockReturnValue(controller.pty);
  const promise = runPtyCommand("pnpm", ["install"]);
  controller.emitData(input);
  controller.emitExit({ exitCode: 1 });
  try {
    await promise;
    return "";
  } catch (error) {
    if (error instanceof PtyCommandExecutionError) {
      return error.output;
    }
    throw error;
  }
}

async function runChunked(input: string, chunkSize: number): Promise<string> {
  const controller = createMockPtyController();
  spawnMock.mockReturnValue(controller.pty);
  const promise = runPtyCommand("pnpm", ["install"]);
  for (const chunk of splitChunks(input, chunkSize)) {
    controller.emitData(chunk);
  }
  controller.emitExit({ exitCode: 1 });
  try {
    await promise;
    return "";
  } catch (error) {
    if (error instanceof PtyCommandExecutionError) {
      return error.output;
    }
    throw error;
  }
}

describe("StreamingAnsiStripper OSC size-cap handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("strips an OSC just under the cap (control)", async () => {
    expect(await runSingleChunk(buildStTerminatedOsc(8190))).toBe("VISIBLE");
  });

  it("strips an OSC at the exact 8191-byte boundary without leaking the ST backslash", async () => {
    // The ST terminator's ESC is the byte that pushes oscCharacters to the cap;
    // it must be recognized as a terminator before the size-cap branch runs.
    expect(await runSingleChunk(buildStTerminatedOsc(8191))).toBe("VISIBLE");
  });

  it("strips an OSC just over the cap (8193 bytes) without leaking payload", async () => {
    expect(await runSingleChunk(buildStTerminatedOsc(8193))).toBe("VISIBLE");
  });

  it("strips a much larger ST-terminated OSC via the discard state", async () => {
    expect(await runSingleChunk(buildStTerminatedOsc(9000))).toBe("VISIBLE");
  });

  it("strips an oversized OSC split across chunks (state persists across writes)", async () => {
    expect(await runChunked(buildStTerminatedOsc(9000), 1024)).toBe("VISIBLE");
  });

  it("strips a large BEL-terminated OSC that exceeds the cap", async () => {
    expect(await runSingleChunk(buildBelTerminatedOsc(9000))).toBe("VISIBLE");
  });

  it("recovers visible text at the next line feed after an oversized unterminated OSC", async () => {
    const input = `\u001b]0;${"x".repeat(9000)}\nvisible failure\n`;
    expect(await runSingleChunk(input)).toBe("visible failure");
  });

  it("keeps discarding an oversized OSC past a fake ST until a real terminator", async () => {
    // ESC X inside an oversized OSC is not a real ST terminator; the parser must
    // stay in discard mode until the real ESC \ later in the stream.
    const input = `\u001b]0;${"x".repeat(9000)}\u001bX\u001b]0;real\u001b\\VISIBLE`;
    expect(await runSingleChunk(input)).toBe("VISIBLE");
  });

  it("preserves visible text before and after a stripped oversized OSC", async () => {
    const fill = "x".repeat(9000 - 2);
    const input = `before\n\u001b]0;${fill}\u001b\\after`;
    expect(await runSingleChunk(input)).toBe("before\nafter");
  });

  it("strips a small ST-terminated OSC (no regression)", async () => {
    expect(await runSingleChunk("\u001b]0;title\u001b\\VISIBLE")).toBe(
      "VISIBLE",
    );
  });

  it("strips a small BEL-terminated OSC (no regression)", async () => {
    expect(await runSingleChunk("\u001b]0;title\u0007VISIBLE")).toBe("VISIBLE");
  });
});
