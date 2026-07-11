import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";

const { ensureNitroOnViteAppMock } = vi.hoisted(() => ({
  ensureNitroOnViteAppMock: vi.fn(),
}));

vi.mock("@/ipc/utils/nitro_setup", () => ({
  ensureNitroOnViteApp: ensureNitroOnViteAppMock,
}));

import { enableNitroTool } from "./enable_nitro";

describe("enableNitroTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureNitroOnViteAppMock.mockResolvedValue({
      warningMessages: [],
      rollback: vi.fn(),
    });
  });

  it("suppresses Git hooks for its trusted automated package install", async () => {
    const context = {
      appPath: "/test/app",
      frameworkType: "vite",
      onWarningMessage: vi.fn(),
    } as unknown as AgentContext;

    await expect(
      enableNitroTool.execute({ reason: "Add an API route" }, context),
    ).resolves.toContain("Nitro server layer added");

    expect(ensureNitroOnViteAppMock).toHaveBeenCalledWith("/test/app", {
      disableGitHooks: true,
    });
  });
});
