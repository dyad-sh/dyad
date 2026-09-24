import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  runtimeMode2: "docker" as "docker" | "host",
  runBufferedProcess: vi.fn(),
}));

vi.mock("@/main/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/main/settings")>();
  return {
    ...actual,
    readSettings: () => ({
      ...actual.readSettings(),
      runtimeMode2: mocks.runtimeMode2,
    }),
  };
});

vi.mock("@/ipc/utils/buffered_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/buffered_process")>()),
  runBufferedProcess: mocks.runBufferedProcess,
}));

import { buildAgentToolSet } from "../tool_definitions";
import { runPreCommitTool } from "./run_pre_commit";

function context(): AgentContext {
  return {
    appId: 987_657,
    appPath: "/tmp/unused-pre-commit-docker",
    chatId: 1,
    isDyadPro: false,
    preCommitHookAvailable: true,
    fileMutationCount: 1,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    referencedApps: new Map(),
    abortSignal: new AbortController().signal,
  } as unknown as AgentContext;
}

describe("run_pre_commit in Docker mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeMode2 = "docker";
  });

  it("is not offered, even when a hook was detected", () => {
    const tools = buildAgentToolSet(context(), { enableAppBlueprint: false });
    expect(tools.run_pre_commit).toBeUndefined();
  });

  it("refuses an already-offered call after switching to Docker mode", async () => {
    mocks.runtimeMode2 = "host";
    const tools = buildAgentToolSet(context(), { enableAppBlueprint: false });
    expect(tools.run_pre_commit).toBeDefined();

    mocks.runtimeMode2 = "docker";
    await expect(tools.run_pre_commit.execute({})).rejects.toThrow(
      "Tool is unavailable in this turn",
    );
    expect(mocks.runBufferedProcess).not.toHaveBeenCalled();
  });

  it("refuses direct execution without staging or running the hook", async () => {
    await expect(runPreCommitTool.execute({}, context())).rejects.toMatchObject(
      {
        name: "DyadError",
        kind: "precondition",
        message: expect.stringContaining(
          "Pre-commit hooks aren't supported in Docker mode",
        ),
      },
    );
    expect(mocks.runBufferedProcess).not.toHaveBeenCalled();
  });
});
