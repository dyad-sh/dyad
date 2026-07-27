import { describe, expect, it, vi } from "vitest";
import type {
  ImageGenerationActorState,
  ImageGenerationEvent,
} from "@/image_generation/state";
import { ImageGenerationActorService } from "./image_generation_actor_service";

const service = vi.hoisted(() => ({
  cancelAndSettleApp: vi.fn(async () => undefined),
  cancelAndSettleAll: vi.fn(async () => undefined),
}));
const presentation = vi.hoisted(() => ({
  forgetApp: vi.fn(),
}));

vi.mock("./image_generation_service", () => ({
  imageGenerationService: service,
}));
vi.mock("./image_generation_presentation_service", () => ({
  imageGenerationPresentationService: presentation,
}));
vi.mock("./distributed_machine_host", () => ({
  remoteMachineHost: {},
}));

describe("ImageGenerationActorService", () => {
  it("settles and prunes matching jobs before app deletion continues", async () => {
    const state: ImageGenerationActorState = {
      jobs: [
        {
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
    const send = vi.fn<(event: ImageGenerationEvent) => void>();
    const host = {
      peek: vi.fn(() => ({ getSnapshot: () => state, send })),
      disposeMachine: vi.fn(async () => undefined),
    };
    const actorService = new ImageGenerationActorService(host as never);

    await actorService.disposeApp(7);

    expect(service.cancelAndSettleApp).toHaveBeenCalledWith(7);
    expect(presentation.forgetApp).toHaveBeenCalledWith(7, state);
    expect(send).toHaveBeenCalledWith({ type: "APP_DELETED", appId: 7 });
  });

  it("settles all provider work before reset disposes the actor", async () => {
    const disposeMachine = vi.fn(async () => undefined);
    const actorService = new ImageGenerationActorService({
      peek: vi.fn(),
      disposeMachine,
    } as never);

    await actorService.disposeAllApps();

    expect(service.cancelAndSettleAll).toHaveBeenCalled();
    expect(disposeMachine).toHaveBeenCalledWith("image_generation");
  });
});
