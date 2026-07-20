import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUFFERED_PROCESS_FORCE_KILL_GRACE_MS,
  BufferedProcessSpawnError,
  runBufferedProcess,
} from "./buffered_process";
import { OUTPUT_TRUNCATION_MARKER } from "./bounded_output_buffer";

const { spawnMock, treeKillMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  treeKillMock: vi.fn(),
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
      spawn: spawnMock,
    },
    spawn: spawnMock,
  };
});

vi.mock("tree-kill", () => ({
  default: treeKillMock,
}));

interface MockChildController {
  child: ChildProcess;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  close(code: number | null, signal?: NodeJS.Signals | null): void;
  error(error: Error): void;
}

function createMockChildController(): MockChildController {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const kill = vi.fn(() => true);

  Object.assign(child, {
    pid: 4321,
    stdin,
    stdout,
    stderr,
    kill,
  });

  return {
    child,
    stdout,
    stderr,
    kill,
    close(code, signal = null) {
      child.emit("close", code, signal);
    },
    error(error) {
      child.emit("error", error);
    },
  };
}

describe("runBufferedProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    treeKillMock.mockImplementation(
      (_pid: number, _signal: string, callback: (error?: Error) => void) =>
        callback(),
    );
  });

  it("enforces independent byte budgets for stdout and stderr", async () => {
    const controller = createMockChildController();
    spawnMock.mockReturnValue(controller.child);

    const promise = runBufferedProcess({
      command: "npm test",
      cwd: "/tmp/app",
      maxOutputBytes: 8,
    });

    controller.stdout.emit("data", Buffer.from("old-stdout-TAILOUT"));
    controller.stderr.emit("data", Buffer.from("old-stderr-TAILERR"));
    controller.close(1);

    await expect(promise).resolves.toMatchObject({
      code: 1,
      stdout: OUTPUT_TRUNCATION_MARKER + "-TAILOUT",
      stderr: OUTPUT_TRUNCATION_MARKER + "-TAILERR",
      stdoutTruncated: true,
      stderrTruncated: true,
    });
  });

  it("passes explicit arguments without a shell", async () => {
    const controller = createMockChildController();
    spawnMock.mockReturnValue(controller.child);

    const promise = runBufferedProcess({
      command: "/tmp/app/node_modules/.bin/tsc",
      args: ["--pretty", "false"],
      cwd: "/tmp/app",
    });
    controller.close(0);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "/tmp/app/node_modules/.bin/tsc",
      ["--pretty", "false"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("decodes split multi-byte chunks for callbacks and returned output", async () => {
    const controller = createMockChildController();
    spawnMock.mockReturnValue(controller.child);
    const onStdout = vi.fn();
    const encoded = Buffer.from("before 🙂 after");

    const promise = runBufferedProcess({
      command: "npm test",
      cwd: "/tmp/app",
      onStdout,
    });

    controller.stdout.emit("data", encoded.subarray(0, 9));
    controller.stdout.emit("data", encoded.subarray(9, 11));
    controller.stdout.emit("data", encoded.subarray(11));
    controller.close(0);

    await expect(promise).resolves.toMatchObject({
      stdout: "before 🙂 after",
    });
    expect(onStdout.mock.calls.map(([chunk]) => chunk).join("")).toBe(
      "before 🙂 after",
    );
  });

  it("does not decode retained logs when successful output is unused", async () => {
    const controller = createMockChildController();
    spawnMock.mockReturnValue(controller.child);
    const decoderWriteSpy = vi.spyOn(StringDecoder.prototype, "write");

    const promise = runBufferedProcess({
      command: "npm test",
      cwd: "/tmp/app",
      captureOutputOnSuccess: false,
    });

    controller.stdout.emit("data", Buffer.from("successful output"));
    controller.stderr.emit("data", Buffer.from("warning output"));
    controller.close(0);

    await expect(promise).resolves.toMatchObject({
      code: 0,
      stdout: "",
      stderr: "",
    });
    expect(decoderWriteSpy).not.toHaveBeenCalled();
    decoderWriteSpy.mockRestore();
  });

  it("tree-kills timed-out commands and removes every listener", async () => {
    vi.useFakeTimers();
    const controller = createMockChildController();
    spawnMock.mockReturnValue(controller.child);

    const promise = runBufferedProcess({
      command: "npm test",
      cwd: "/tmp/app",
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    expect(treeKillMock).toHaveBeenCalledWith(
      4321,
      "SIGTERM",
      expect.any(Function),
    );

    await vi.advanceTimersByTimeAsync(BUFFERED_PROCESS_FORCE_KILL_GRACE_MS);
    await expect(promise).resolves.toMatchObject({
      code: null,
      signal: "SIGKILL",
      timedOut: true,
    });
    expect(treeKillMock).toHaveBeenLastCalledWith(
      4321,
      "SIGKILL",
      expect.any(Function),
    );
    expect(controller.stdout.listenerCount("data")).toBe(0);
    expect(controller.stderr.listenerCount("data")).toBe(0);
    expect(controller.child.listenerCount("close")).toBe(0);
    expect(controller.child.listenerCount("error")).toBe(0);
  });

  it("aborts a running process and unregisters the AbortSignal listener", async () => {
    vi.useFakeTimers();
    const controller = createMockChildController();
    spawnMock.mockReturnValue(controller.child);
    const abortController = new AbortController();
    const removeEventListener = vi.spyOn(
      abortController.signal,
      "removeEventListener",
    );

    const promise = runBufferedProcess({
      command: "npm test",
      cwd: "/tmp/app",
      signal: abortController.signal,
    });

    abortController.abort();
    controller.close(null, "SIGTERM");

    await expect(promise).resolves.toMatchObject({
      aborted: true,
      signal: "SIGTERM",
    });
    expect(removeEventListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
  });

  it("includes bounded stdout and stderr when spawning fails", async () => {
    const controller = createMockChildController();
    spawnMock.mockReturnValue(controller.child);

    const promise = runBufferedProcess({
      command: "npm test",
      cwd: "/tmp/app",
      maxOutputBytes: 8,
    });

    controller.stdout.emit("data", Buffer.from("stdout tail"));
    controller.stderr.emit("data", Buffer.from("stderr tail"));
    controller.error(new Error("spawn failed"));

    await expect(promise).rejects.toMatchObject({
      message: "spawn failed",
      name: "BufferedProcessSpawnError",
      stdout: OUTPUT_TRUNCATION_MARKER + "out tail",
      stderr: OUTPUT_TRUNCATION_MARKER + "err tail",
    } satisfies Partial<BufferedProcessSpawnError>);
  });

  it("kills the child and rejects when an output callback throws", async () => {
    const controller = createMockChildController();
    spawnMock.mockReturnValue(controller.child);

    const promise = runBufferedProcess({
      command: "npm test",
      cwd: "/tmp/app",
      onStdout: () => {
        throw new Error("output callback failed");
      },
    });

    controller.stdout.emit("data", Buffer.from("some output"));

    await expect(promise).rejects.toMatchObject({
      message: "output callback failed",
      stdout: "some output",
    } satisfies Partial<BufferedProcessSpawnError>);
    expect(treeKillMock).toHaveBeenCalledWith(
      4321,
      "SIGKILL",
      expect.any(Function),
    );
    expect(controller.stdout.listenerCount("data")).toBe(0);
  });
});
