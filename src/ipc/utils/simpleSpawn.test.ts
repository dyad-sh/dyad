import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  BufferedProcessSpawnError,
  DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS,
} from "./buffered_process";
import { simpleSpawn } from "./simpleSpawn";

const { logger, runBufferedProcessMock } = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
  runBufferedProcessMock: vi.fn(),
}));

vi.mock("electron-log/main", () => ({
  default: {
    scope: () => logger,
  },
}));

vi.mock("./socket_firewall", () => ({
  getPackageManagerCommandEnv: () => ({ PATH: "/managed" }),
}));

vi.mock("./buffered_process", async () => {
  const actual =
    await vi.importActual<typeof import("./buffered_process")>(
      "./buffered_process",
    );
  return {
    ...actual,
    runBufferedProcess: runBufferedProcessMock,
  };
});

describe("simpleSpawn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs the success message without retaining successful output", async () => {
    runBufferedProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: "",
      stderr: "",
      aborted: false,
      timedOut: false,
    });

    await simpleSpawn({
      command: "npm run build",
      cwd: "/tmp/app",
      successMessage: "built successfully",
      errorPrefix: "build failed",
    });

    expect(runBufferedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        captureOutputOnSuccess: false,
        env: { PATH: "/managed" },
        timeoutMs: DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith("built successfully");
  });

  it("reports bounded stdout and stderr when a command fails", async () => {
    runBufferedProcessMock.mockResolvedValue({
      code: 2,
      signal: null,
      stdout: "stdout tail",
      stderr: "stderr tail",
      aborted: false,
      timedOut: false,
    });

    const promise = simpleSpawn({
      command: "npm run build",
      cwd: "/tmp/app",
      successMessage: "built successfully",
      errorPrefix: "build failed",
    });

    await expect(promise).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message:
        "build failed (exit code 2)\n\nSTDOUT:\nstdout tail\n\nSTDERR:\nstderr tail",
    });
  });

  it("reports timeout and cancellation distinctly", async () => {
    runBufferedProcessMock.mockResolvedValueOnce({
      code: null,
      signal: null,
      stdout: "timeout tail",
      stderr: "",
      aborted: false,
      timedOut: true,
    });

    await expect(
      simpleSpawn({
        command: "npm install",
        cwd: "/tmp/app",
        successMessage: "installed",
        errorPrefix: "install failed",
        timeoutMs: 25,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: expect.stringContaining(
        "install failed (timed out after 25 ms)",
      ),
    });

    runBufferedProcessMock.mockResolvedValueOnce({
      code: null,
      signal: null,
      stdout: "",
      stderr: "",
      aborted: true,
      timedOut: false,
    });

    await expect(
      simpleSpawn({
        command: "npm install",
        cwd: "/tmp/app",
        successMessage: "installed",
        errorPrefix: "install failed",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: expect.stringContaining("install failed (was cancelled)"),
    });
  });

  it("preserves captured output from spawn failures", async () => {
    runBufferedProcessMock.mockRejectedValue(
      new BufferedProcessSpawnError(
        "ENOENT",
        "bounded stdout",
        "bounded stderr",
      ),
    );

    await expect(
      simpleSpawn({
        command: "missing",
        cwd: "/tmp/app",
        successMessage: "done",
        errorPrefix: "failed",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message:
        "Failed to spawn command: ENOENT\n\nSTDOUT:\nbounded stdout\n\nSTDERR:\nbounded stderr",
    });
  });
});
