import { describe, expect, it, vi } from "vitest";
import type {
  ImageGenerationActorState,
  ImageGenerationEvent,
} from "@/image_generation/state";
import { ImageGenerationActorService } from "./image_generation_actor_service";
import type { RequestId } from "@/distributed_machines/request_identity";

const service = vi.hoisted(() => ({
  beginAppDeletion: vi.fn(),
  endAppDeletion: vi.fn(),
  cancelAndSettleApp: vi.fn(async () => undefined),
  cancelAndSettleAll: vi.fn(async () => undefined),
}));
const presentation = vi.hoisted(() => ({
  forgetApp: vi.fn(),
}));
const operations = vi.hoisted(() => ({
  createPublisher: vi.fn(),
  releaseApp: vi.fn(),
  releaseActor: vi.fn(),
  remoteContract: vi.fn(() => undefined),
  settleActor: vi.fn(),
}));

vi.mock("./image_generation_service", () => ({
  imageGenerationService: service,
}));
vi.mock("./image_generation_presentation_service", () => ({
  imageGenerationPresentationService: presentation,
}));
vi.mock("./image_generation_operation_service", () => ({
  imageGenerationOperationService: operations,
}));
vi.mock("./distributed_machine_host", () => ({
  remoteMachineHost: {},
}));

describe("ImageGenerationActorService", () => {
  it("settles and prunes matching jobs before app deletion continues", async () => {
    const state: ImageGenerationActorState = {
      jobs: [
        {
          requestId: "request-1" as RequestId,
          job: {
            id: "job-1",
            prompt: "A lighthouse",
            themeMode: "plain",
            targetAppId: 7,
            targetAppName: "App",
            startedAt: 1,
            status: "pending",
          },
          activeInvocationRef: {
            kind: "image-generation",
            entityKey: "job-1",
            operationId: "operation-1",
          },
        },
      ],
    };
    const enqueue = vi.fn((_event: ImageGenerationEvent) => ({
      settled: Promise.resolve({ kind: "applied" }),
    }));
    const fence = {
      key: { collection: "default" },
      generation: { ordinal: 1, identity: {} },
      seal: vi.fn(async () => undefined),
      commit: vi.fn(() => true),
      abort: vi.fn(() => true),
      release: vi.fn(() => true),
    };
    const host = {
      peek: vi.fn(() => ({ getSnapshot: () => state, enqueue })),
      disposeMachine: vi.fn(async () => undefined),
      beginFence: vi.fn(() => fence),
    };
    const actorService = new ImageGenerationActorService(host as never);

    const deletion = actorService.beginAppDeletion(7);
    await actorService.prepareAppDeletion(deletion);
    actorService.finishAppDeletion(deletion, true);

    expect(service.beginAppDeletion).toHaveBeenCalledWith(7);
    expect(presentation.forgetApp).toHaveBeenCalledWith(7, state);
    expect(enqueue).toHaveBeenCalledWith({ type: "APP_DELETED", appId: 7 });
    expect(service.cancelAndSettleApp).toHaveBeenCalledWith(7);
    expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      service.cancelAndSettleApp.mock.invocationCallOrder[0],
    );
    expect(fence.seal).toHaveBeenCalled();
    expect(fence.commit).toHaveBeenCalled();
    expect(operations.releaseApp).toHaveBeenCalledWith(7);
    expect(fence.release).toHaveBeenCalled();
    expect(service.endAppDeletion).toHaveBeenCalledWith(7);
  });

  it("reopens only through the current fence handle when deletion fails", () => {
    const fence = {
      key: { collection: "default" },
      generation: { ordinal: 1, identity: {} },
      seal: vi.fn(async () => undefined),
      commit: vi.fn(() => true),
      abort: vi.fn(() => true),
      release: vi.fn(() => true),
    };
    const actorService = new ImageGenerationActorService({
      peek: vi.fn(),
      disposeMachine: vi.fn(),
      beginFence: vi.fn(() => fence),
    } as never);

    const deletion = actorService.beginAppDeletion(7);
    actorService.finishAppDeletion(deletion, false);

    expect(fence.abort).toHaveBeenCalledOnce();
    expect(fence.commit).not.toHaveBeenCalled();
    expect(fence.release).not.toHaveBeenCalled();
    expect(service.endAppDeletion).toHaveBeenCalledWith(7);
  });

  it("disposes the actor before reset continues", async () => {
    const disposeMachine = vi.fn(async () => undefined);
    const actorService = new ImageGenerationActorService({
      peek: vi.fn(),
      disposeMachine,
      beginFence: vi.fn(),
    } as never);

    await actorService.disposeAllApps();

    expect(disposeMachine).toHaveBeenCalledWith("image_generation");
  });
});
