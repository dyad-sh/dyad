import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireExistingApp: vi.fn().mockResolvedValue(undefined),
  createExternalLifecycleRef: vi.fn(),
}));

vi.mock("@/app_run/definition", () => ({
  appRunDefinition: { id: "app_run" },
  requireExistingApp: mocks.requireExistingApp,
}));

vi.mock("./app_runtime_service", () => ({
  appRuntimeService: {
    createExternalLifecycleRef: mocks.createExternalLifecycleRef,
  },
}));

vi.mock("./distributed_machine_host", () => ({
  remoteMachineHost: {},
}));

vi.mock("./main_app_runtime_output", () => ({
  MainAppRuntimeOutput: class MainAppRuntimeOutput {},
}));

import { AppRunActorService } from "./app_run_actor_service";

describe("AppRunActorService.executeAlreadyLockedExternalRestart", () => {
  const invocationRef = {
    kind: "app-run" as const,
    entityKey: 7,
    operationId: "isolated-restart-1",
  };
  const actor = {
    send: vi.fn(),
  };
  const host = {
    ensure: vi.fn(() => actor),
    peek: vi.fn(() => actor),
    disposeKey: vi.fn(),
    disposeMachine: vi.fn(),
    dispose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createExternalLifecycleRef.mockReturnValue(invocationRef);
  });

  it("uses a fresh invocation and settles successful already-locked work", async () => {
    const service = new AppRunActorService(host as never);
    const execute = vi.fn().mockResolvedValue(42);

    await expect(
      service.executeAlreadyLockedExternalRestart(7, execute),
    ).resolves.toBe(42);

    expect(execute).toHaveBeenCalledWith({
      invocationRef,
      output: expect.anything(),
    });
    expect(actor.send).toHaveBeenNthCalledWith(1, {
      type: "EXTERNAL_RESTART_STARTED",
      invocationRef,
      operation: "restart",
      startedAt: expect.any(Number),
    });
    expect(actor.send).toHaveBeenNthCalledWith(2, {
      type: "PROCESS_SPAWNED",
      operationId: invocationRef.operationId,
      invocationRef,
    });
  });

  it("settles failed already-locked work and preserves the rejection", async () => {
    const service = new AppRunActorService(host as never);
    const failure = new Error("replacement failed");

    await expect(
      service.executeAlreadyLockedExternalRestart(7, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(actor.send).toHaveBeenNthCalledWith(2, {
      type: "PROCESS_FAILED",
      operationId: invocationRef.operationId,
      invocationRef,
      error: { message: "replacement failed" },
    });
  });
});
