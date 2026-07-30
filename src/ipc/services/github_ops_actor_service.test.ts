import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubOpsActorService } from "./github_ops_actor_service";

const operations = vi.hoisted(() => ({
  settleKey: vi.fn(),
  settleMachine: vi.fn(),
  settleActor: vi.fn(),
  releaseActor: vi.fn(),
  createPublisher: vi.fn(),
  remoteContract: vi.fn(() => ({
    prepare: vi.fn(() => undefined),
    ignoredOutcome: vi.fn(),
    receipt: vi.fn(),
  })),
}));

vi.mock("./github_ops_operation_service", () => ({
  githubOpsOperationService: operations,
}));
vi.mock("./distributed_machine_host", () => ({
  remoteMachineHost: {},
}));

function fence() {
  return {
    key: { appId: 7 },
    generation: { ordinal: 1, identity: {} },
    seal: vi.fn(async () => undefined),
    commit: vi.fn(() => true),
    abort: vi.fn(() => true),
    release: vi.fn(() => true),
  };
}

describe("GithubOpsActorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("owns app deletion with an app-keyed fence that admits only producer cleanup", () => {
    const handle = fence();
    const beginFence = vi.fn(() => handle);
    const service = new GithubOpsActorService({
      beginFence,
      beginMachineFence: vi.fn(),
      disposeKey: vi.fn(),
      disposeMachine: vi.fn(),
    } as never);

    expect(service.beginAppDeletion(7)).toBe(handle);
    const options = (beginFence.mock.calls[0] as unknown[])[1] as {
      readonly key: { readonly appId: number };
      readonly allowDuringDrain: (event: unknown) => boolean;
    };
    expect(options.key).toEqual({ appId: 7 });
    expect(
      options.allowDuringDrain({
        type: "OP_SUCCEEDED",
        operationId: "operation",
        requestId: "request",
        invocationRef: {
          kind: "github-ops",
          entityKey: 7,
          operationId: "operation",
        },
      }),
    ).toBe(true);
    expect(
      options.allowDuringDrain({
        type: "OP_REQUESTED",
        operationId: "operation",
        requestId: "request",
        initiatorWindowSessionId: "window",
        op: { type: "push", mode: "normal" },
      }),
    ).toBe(false);
  });

  it("settles operations before actor, app, or machine disposal", async () => {
    const order: string[] = [];
    operations.settleKey.mockImplementation(() => order.push("settle-key"));
    operations.settleMachine.mockImplementation(() =>
      order.push("settle-machine"),
    );
    const host = {
      beginFence: vi.fn(),
      beginMachineFence: vi.fn(() => fence()),
      disposeKey: vi.fn(async () => {
        order.push("dispose-key");
      }),
      disposeMachine: vi.fn(async () => {
        order.push("dispose-machine");
      }),
    };
    const service = new GithubOpsActorService(host as never);

    await service.disposeApp(7);
    await service.disposeAllApps();

    expect(order).toEqual([
      "settle-key",
      "dispose-key",
      "settle-machine",
      "dispose-machine",
    ]);
  });

  it("publishes a machine-wide reset fence", () => {
    const handle = fence();
    const beginMachineFence = vi.fn(() => handle);
    const service = new GithubOpsActorService({
      beginFence: vi.fn(),
      beginMachineFence,
      disposeKey: vi.fn(),
      disposeMachine: vi.fn(),
    } as never);

    expect(service.beginReset()).toBe(handle);
    expect(beginMachineFence).toHaveBeenCalledWith(
      expect.objectContaining({ id: "github_ops" }),
      expect.objectContaining({ allowDuringDrain: expect.any(Function) }),
    );
  });
});
