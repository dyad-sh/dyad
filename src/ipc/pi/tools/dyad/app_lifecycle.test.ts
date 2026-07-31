// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeExternalLifecycleMock } = vi.hoisted(() => ({
  executeExternalLifecycleMock: vi.fn(),
}));

vi.mock("@/ipc/services/app_run_actor_service", () => ({
  appRunActorService: {
    executeExternalLifecycle: executeExternalLifecycleMock,
  },
}));

import { restartAppTool } from "./app_lifecycle";
import type { AgentContext } from "./types";

describe("restartAppTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeExternalLifecycleMock.mockResolvedValue(undefined);
  });

  it("passes the invocation abort signal through restart and readiness", async () => {
    const controller = new AbortController();
    await restartAppTool.execute({}, {
      appId: 7,
      event: { sender: {} },
      abortSignal: controller.signal,
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext);

    expect(executeExternalLifecycleMock).toHaveBeenCalledWith({
      appId: 7,
      operation: "restart",
      abortSignal: controller.signal,
      timeoutMs: undefined,
    });
  });
});
