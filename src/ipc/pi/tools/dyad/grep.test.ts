// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnStreaming = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/utils/spawn_streaming", () => ({ spawnStreaming }));
vi.mock("@/ipc/utils/ripgrep_utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/ripgrep_utils")>();
  return { ...actual, getRgExecutablePath: () => "/usr/bin/true" };
});

import type { AgentContext } from "./types";
import { grepTool } from "./grep";

describe("grepTool", () => {
  beforeEach(() => {
    spawnStreaming.mockReset();
    spawnStreaming.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "",
      aborted: false,
      timedOut: false,
    });
  });

  it("runs through the shared spawn helper with the invocation abort signal", async () => {
    const controller = new AbortController();
    const appPath = process.cwd();
    const context = {
      appPath,
      referencedApps: new Map(),
      abortSignal: controller.signal,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await grepTool.execute({ query: "needle" }, context);

    expect(spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: appPath,
        signal: controller.signal,
        args: expect.arrayContaining(["--json", "--", "needle", "."]),
      }),
    );
  });
});
