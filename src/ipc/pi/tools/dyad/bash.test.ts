// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runPtyCommandMock = vi.hoisted(() => vi.fn());
const getAgentGitStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/utils/pty_command_runner", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/pty_command_runner")>();
  return { ...actual, runPtyCommand: runPtyCommandMock };
});

vi.mock("@/ipc/utils/git_utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ipc/utils/git_utils")>();
  return { ...actual, getAgentGitStatus: getAgentGitStatusMock };
});

import { bashTool, buildSanitizedShellEnv, buildShellInvocation } from "./bash";
import type { AgentContext } from "./types";

const cleanStatus = {
  branch: "main",
  head: "abc123",
  detached: false,
  conflicted: [],
  staged: [],
  unstaged: [],
  untracked: [],
  truncated: false,
};

describe("bashTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runPtyCommandMock.mockResolvedValue({ output: "done" });
    getAgentGitStatusMock.mockResolvedValue(cleanStatus);
  });

  it("uses the platform shell without enabling an extra shell layer", () => {
    expect(buildShellInvocation("pwd", "darwin", "/bin/zsh")).toEqual({
      command: "/bin/zsh",
      args: ["-lc", "pwd"],
    });
    expect(
      buildShellInvocation("echo hello", "win32", "/bin/sh", "cmd.exe"),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "echo hello"],
    });
  });

  it("waits for a streamed command before rendering status", () => {
    expect(bashTool.buildXml?.({}, false)).toBeUndefined();
  });

  it("passes only non-secret environment variables to the command", () => {
    expect(
      buildSanitizedShellEnv(
        "/tmp/dyad-bash",
        {
          PATH: "/usr/bin",
          LANG: "en_US.UTF-8",
          API_KEY: "secret",
          SSH_AUTH_SOCK: "/tmp/agent.sock",
        },
        "darwin",
      ),
    ).toEqual({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      HOME: "/tmp/dyad-bash",
      TEMP: "/tmp/dyad-bash",
      TMP: "/tmp/dyad-bash",
      TMPDIR: "/tmp/dyad-bash",
    });
  });

  it("shows the entire command in the consent preview", () => {
    const command = `printf ok ${"x".repeat(1_000)}; touch changed.txt`;
    expect(bashTool.getConsentPreview?.({ command })).toBe(command);
  });

  it("runs in the app root and forwards the invocation abort signal", async () => {
    const controller = new AbortController();
    const onXmlComplete = vi.fn();
    const result = await bashTool.execute({ command: "npm test" }, {
      appPath: "/workspace/app",
      abortSignal: controller.signal,
      onXmlStream: vi.fn(),
      onXmlComplete,
    } as unknown as AgentContext);

    expect(result).toBe("done");
    expect(runPtyCommandMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: "/workspace/app",
        displayCommand: "npm test",
        signal: controller.signal,
      }),
    );
    expect(onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining("Shell command completed"),
    );
  });

  it("does not track a read-only command as a workspace mutation", async () => {
    const ctx = {
      appPath: "/workspace/app",
      abortSignal: new AbortController().signal,
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    const result = await bashTool.execute({ command: "pwd" }, ctx);

    expect(
      bashTool.shouldTrackMutation?.({ command: "pwd" }, result, ctx),
    ).toBe(false);
  });

  it("tracks a command when the Git workspace state changes", async () => {
    getAgentGitStatusMock
      .mockResolvedValueOnce(cleanStatus)
      .mockResolvedValueOnce({
        ...cleanStatus,
        untracked: ["src/created.txt"],
      });
    const ctx = {
      appPath: "/workspace/app",
      abortSignal: new AbortController().signal,
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    const result = await bashTool.execute(
      { command: "touch src/created.txt" },
      ctx,
    );

    expect(
      bashTool.shouldTrackMutation?.(
        { command: "touch src/created.txt" },
        result,
        ctx,
      ),
    ).toBe(true);
  });

  it("tracks content changes to an already-dirty path", async () => {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-bash-test-"));
    const dirtyPath = path.join(appPath, "src", "App.tsx");
    await fs.mkdir(path.dirname(dirtyPath), { recursive: true });
    await fs.writeFile(dirtyPath, "before");
    const dirtyStatus = {
      ...cleanStatus,
      unstaged: ["src/App.tsx"],
    };
    getAgentGitStatusMock.mockResolvedValue(dirtyStatus);
    runPtyCommandMock.mockImplementationOnce(async () => {
      await fs.writeFile(dirtyPath, "after");
      return { output: "done" };
    });
    const ctx = {
      appPath,
      abortSignal: new AbortController().signal,
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    try {
      const result = await bashTool.execute({ command: "update app" }, ctx);
      expect(
        bashTool.shouldTrackMutation?.({ command: "update app" }, result, ctx),
      ).toBe(true);
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });

  it("does not start a command when the initial status is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    getAgentGitStatusMock.mockRejectedValueOnce(new Error("cancelled"));
    const ctx = {
      appPath: "/workspace/app",
      abortSignal: controller.signal,
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await expect(bashTool.execute({ command: "pwd" }, ctx)).rejects.toThrow(
      "cancelled",
    );
    expect(runPtyCommandMock).not.toHaveBeenCalled();
  });

  it("tracks workspace changes left by a failed command", async () => {
    getAgentGitStatusMock
      .mockResolvedValueOnce(cleanStatus)
      .mockResolvedValueOnce({
        ...cleanStatus,
        untracked: ["changed.txt"],
      });
    runPtyCommandMock.mockRejectedValueOnce(new Error("command failed"));
    const ctx = {
      appPath: "/workspace/app",
      abortSignal: new AbortController().signal,
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
      mutationCount: 0,
    } as unknown as AgentContext;

    await expect(
      bashTool.execute({ command: "touch changed.txt; false" }, ctx),
    ).rejects.toThrow("command failed");
    expect(ctx.mutationCount).toBe(1);
    expect(ctx.workspaceMutated).toBe(true);
  });
});
