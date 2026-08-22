import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecuteAddDependencyError } from "@/ipc/processors/executeAddDependency";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  ensureNitroOnViteApp: vi.fn(),
}));

vi.mock("@/ipc/utils/nitro_setup", () => ({
  ensureNitroOnViteApp: mocks.ensureNitroOnViteApp,
}));

import { enableNitroTool } from "./enable_nitro";

describe("enableNitroTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tracks package files left by a partially successful Nitro install", async () => {
    mocks.ensureNitroOnViteApp.mockRejectedValue(
      new ExecuteAddDependencyError({
        error: new Error("later install command failed"),
        warningMessages: [],
        completedPackages: ["nitro"],
      }),
    );
    const ctx = {
      appId: 1,
      appPath: "/tmp/app",
      frameworkType: "vite",
    } as AgentContext;

    await expect(
      enableNitroTool.execute({ reason: "server route" }, ctx),
    ).rejects.toThrow("later install command failed");

    expect(ctx.mutationCount).toBe(1);
    expect(ctx.fileMutationCount).toBe(1);
  });
});
