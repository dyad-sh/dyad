// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeAddDependency, findFirst } = vi.hoisted(() => ({
  executeAddDependency: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { query: { messages: { findFirst } } },
}));
vi.mock("@/db/schema", () => ({ messages: { id: "id" } }));
vi.mock("@/ipc/processors/executeAddDependency", () => ({
  executeAddDependency,
  ExecuteAddDependencyError: class ExecuteAddDependencyError extends Error {},
}));

import type { AgentContext } from "./types";
import { addDependencyTool } from "./add_dependency";

describe("addDependencyTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue({ id: 7, content: "" });
    executeAddDependency.mockResolvedValue({ warningMessages: [] });
  });

  it("passes the invocation abort signal to dependency installation", async () => {
    const controller = new AbortController();
    const context = {
      appPath: "/tmp/app",
      appId: 1,
      messageId: 7,
      abortSignal: controller.signal,
    } as unknown as AgentContext;

    await addDependencyTool.execute({ packages: ["react"] }, context);

    expect(executeAddDependency).toHaveBeenCalledWith({
      packages: ["react"],
      message: { id: 7, content: "" },
      appPath: "/tmp/app",
      signal: controller.signal,
    });
  });
});
