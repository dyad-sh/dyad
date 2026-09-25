import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { BufferedProcessSpawnError } from "./buffered_process";
import { runPortalMigrationCommand } from "./portal_migration";

const { logger, runBufferedProcessMock, runGuestBufferedMock, dockerMode } =
  vi.hoisted(() => ({
    runGuestBufferedMock: vi.fn(),
    dockerMode: { active: false },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    runBufferedProcessMock: vi.fn(),
  }));

vi.mock("electron-log", () => ({
  default: {
    scope: () => logger,
  },
}));

vi.mock("./socket_firewall", () => ({
  getPackageManagerCommandEnv: () => ({ PATH: "/managed" }),
}));

vi.mock("@/ipc/services/docker_runtime/runtime_mode", () => ({
  isDockerRuntimeActive: () => dockerMode.active,
}));

vi.mock("@/ipc/services/docker_runtime/guest_command", () => ({
  appGuestInput: async (input: Record<string, unknown>) => ({
    ...input,
    kind: "app-guest-input",
  }),
  runGuestBuffered: runGuestBufferedMock,
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

describe("runPortalMigrationCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dockerMode.active = false;
  });

  it("runs the app's migrate script in the container in Docker mode", async () => {
    dockerMode.active = true;
    const write = vi.fn();
    const child = { pid: 9, stdin: { write } } as unknown as ChildProcess;
    runGuestBufferedMock.mockImplementation(async (_input, options) => {
      options.onStdout?.("Migration created at drizzle/0002.sql\n", child);
      options.onStdout?.("created or renamed from another\n", child);
      return {
        code: 0,
        signal: null,
        stdout: "Migration created at drizzle/0002.sql",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        aborted: false,
        timedOut: false,
      };
    });

    await runPortalMigrationCommand({ appId: 3, appPath: "/apps/portal" });

    expect(runBufferedProcessMock).not.toHaveBeenCalled();
    expect(runGuestBufferedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 3,
        appPath: "/apps/portal",
        command: "npm",
        args: ["run", "migrate:create", "--", "--skip-empty"],
        interactive: true,
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    // Rename prompts are still answered through the guest's attached stdin.
    expect(write).toHaveBeenCalledWith("\r\n");
  });

  it("answers each rename prompt exactly once, including split ones", async () => {
    const write = vi.fn();
    const child = {
      pid: 123,
      stdin: { write },
    } as unknown as ChildProcess;

    runBufferedProcessMock.mockImplementation(async (options) => {
      options.onStdout?.("Migration crea", child);
      options.onStdout?.("ted at drizzle/0001.sql\ncreated or renamed ", child);
      options.onStdout?.("from another\n", child);
      options.onStdout?.("created or renamed from another\n", child);
      return {
        code: 0,
        signal: null,
        stdout: "bounded stdout tail",
        stderr: "bounded warning tail",
        aborted: false,
        timedOut: false,
      };
    });

    await expect(
      runPortalMigrationCommand({ appId: 7, appPath: "/tmp/app" }),
    ).resolves.toBe(
      "bounded stdout tail\n\nErrors/Warnings:\nbounded warning tail",
    );
    // One answer for the prompt split across chunks and one for the second
    // prompt; the tail overlap must not re-answer the first prompt.
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith("\r\n");
    expect(runBufferedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "npm run migrate:create -- --skip-empty",
        cwd: "/tmp/app",
        env: { PATH: "/managed" },
      }),
    );
  });

  it("returns useful bounded tails in exit and timeout failures", async () => {
    runBufferedProcessMock.mockResolvedValueOnce({
      code: 2,
      signal: null,
      stdout: "stdout tail",
      stderr: "stderr tail",
      aborted: false,
      timedOut: false,
    });

    await expect(
      runPortalMigrationCommand({ appId: 7, appPath: "/tmp/app" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message:
        "Migration creation failed (exit code 2)\n\nstdout tail\n\nErrors/Warnings:\nstderr tail",
    });

    runBufferedProcessMock.mockResolvedValueOnce({
      code: null,
      signal: null,
      stdout: "timeout tail",
      stderr: "",
      aborted: false,
      timedOut: true,
    });

    await expect(
      runPortalMigrationCommand({
        appId: 7,
        appPath: "/tmp/app",
        timeoutMs: 25,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: "Migration creation timed out after 25 ms\n\ntimeout tail",
    });
  });

  it("classifies a successful no-op migration as a precondition failure", async () => {
    runBufferedProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: "No schema changes",
      stderr: "",
      aborted: false,
      timedOut: false,
    });

    await expect(
      runPortalMigrationCommand({ appId: 7, appPath: "/tmp/app" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: "No migration was created because no changes were found.",
    });
  });

  it("preserves bounded output when the migration process cannot spawn", async () => {
    runBufferedProcessMock.mockRejectedValue(
      new BufferedProcessSpawnError(
        "ENOENT",
        "bounded stdout",
        "bounded stderr",
      ),
    );

    await expect(
      runPortalMigrationCommand({ appId: 7, appPath: "/tmp/app" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message:
        "Failed to run migration command: ENOENT\n\nOutput:\nbounded stdout\n\nErrors:\nbounded stderr",
    });
  });
});
