import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";

const { executeAddDependencyMock, findMessageMock } = vi.hoisted(() => ({
  executeAddDependencyMock: vi.fn(),
  findMessageMock: vi.fn(),
}));

vi.mock("@/ipc/processors/executeAddDependency", () => ({
  executeAddDependency: executeAddDependencyMock,
  ExecuteAddDependencyError: class ExecuteAddDependencyError extends Error {
    warningMessages: string[] = [];
  },
}));

vi.mock("../../../../../../db", () => ({
  db: {
    query: {
      messages: {
        findFirst: findMessageMock,
      },
    },
  },
}));

vi.mock("../../../../../../db/schema", () => ({
  messages: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

import { addDependencyTool } from "./add_dependency";

describe("addDependencyTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMessageMock.mockResolvedValue({ id: 42, content: "message" });
    executeAddDependencyMock.mockResolvedValue({
      installResults: "installed",
      warningMessages: [],
    });
  });

  it("suppresses Git hooks only for its trusted automated dependency flow", async () => {
    const context = {
      appPath: "/test/app",
      messageId: 42,
      onWarningMessage: vi.fn(),
    } as unknown as AgentContext;

    await expect(
      addDependencyTool.execute({ packages: ["react"] }, context),
    ).resolves.toBe("Successfully installed react");

    expect(executeAddDependencyMock).toHaveBeenCalledWith({
      packages: ["react"],
      message: { id: 42, content: "message" },
      appPath: "/test/app",
      disableGitHooks: true,
    });
  });
});
