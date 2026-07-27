// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { restartAppMock, waitForAppReadyMock } = vi.hoisted(() => ({
  restartAppMock: vi.fn(),
  waitForAppReadyMock: vi.fn(),
}));

vi.mock("@/ipc/services/restart_app", () => ({
  restartApp: restartAppMock,
  waitForAppReady: waitForAppReadyMock,
}));
vi.mock("@/ipc/utils/safe_sender", () => ({ safeSend: vi.fn() }));

import { restartAppTool } from "./app_lifecycle";
import type { AgentContext } from "./types";

describe("restartAppTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restartAppMock.mockResolvedValue(undefined);
    waitForAppReadyMock.mockResolvedValue(undefined);
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

    expect(restartAppMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ appId: 7, signal: controller.signal }),
    );
    expect(waitForAppReadyMock).toHaveBeenCalledWith(7, {
      signal: controller.signal,
    });
  });
});
