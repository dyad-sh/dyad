import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecuteAddDependencyError } from "@/ipc/processors/executeAddDependency";
import type { AgentContext } from "./types";

const executeAddDependencyMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../db", () => ({
  db: {
    query: {
      messages: {
        findFirst: vi.fn().mockResolvedValue({ id: 1, content: "" }),
      },
    },
  },
}));

vi.mock("@/ipc/processors/executeAddDependency", async () => {
  const actual = await vi.importActual<
    typeof import("@/ipc/processors/executeAddDependency")
  >("@/ipc/processors/executeAddDependency");

  return {
    ...actual,
    executeAddDependency: executeAddDependencyMock,
  };
});

import { addDependencyTool } from "./add_dependency";

describe("addDependencyTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires at least one package", () => {
    expect(
      addDependencyTool.inputSchema.safeParse({ packages: [] }).success,
    ).toBe(false);
  });

  it("guides the model to use @latest only for explicit upgrades", () => {
    expect(addDependencyTool.description).toContain(
      "use package@latest to explicitly upgrade",
    );
  });

  it("tracks successful installs and updates as mutations", () => {
    expect(
      addDependencyTool.shouldTrackMutation?.(
        { packages: ["react"] },
        "Successfully installed or updated react",
        {} as any,
      ),
    ).toBe(true);
  });

  it("describes both possible operations in the consent preview", () => {
    expect(addDependencyTool.getConsentPreview?.({ packages: ["react"] })).toBe(
      "Install or refresh react",
    );
  });

  it("tracks package groups completed before a later command fails", async () => {
    executeAddDependencyMock.mockRejectedValue(
      new ExecuteAddDependencyError({
        error: new Error("later command failed"),
        warningMessages: [],
        completedPackages: ["react"],
      }),
    );
    const ctx = {
      messageId: 1,
      appPath: "/tmp/app",
    } as AgentContext;

    await expect(
      addDependencyTool.execute({ packages: ["react", "zod@999.0.0"] }, ctx),
    ).rejects.toThrow("later command failed");

    expect(ctx.mutationCount).toBe(1);
  });
});
