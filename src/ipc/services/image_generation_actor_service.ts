import { getImageGenerationKey } from "@/image_generation/transport";
import type {
  ImageGenerationActorState,
  ImageGenerationEvent,
  ImageGenerationIgnoreReason,
} from "@/image_generation/state";
import type { FenceHandle } from "@/distributed_machines/keyed_admission_gate";
import { imageGenerationDefinition } from "./image_generation_definition";
import { imageGenerationPresentationService } from "./image_generation_presentation_service";
import { imageGenerationService } from "./image_generation_service";
import { imageGenerationOperationService } from "./image_generation_operation_service";
import { remoteMachineHost } from "./distributed_machine_host";

type ImageGenerationActorHost = Pick<
  typeof remoteMachineHost,
  "peek" | "disposeMachine" | "beginFence"
>;

export interface ImageGenerationDeletionFence {
  readonly appId: number;
  readonly handle: FenceHandle<ReturnType<typeof getImageGenerationKey>>;
}

export class ImageGenerationActorService {
  constructor(
    private readonly host: ImageGenerationActorHost = remoteMachineHost,
  ) {}

  beginAppDeletion(appId: number): ImageGenerationDeletionFence {
    imageGenerationService.beginAppDeletion(appId);
    try {
      return {
        appId,
        handle: this.host.beginFence(imageGenerationDefinition, {
          key: getImageGenerationKey(),
          allowDuringDrain: (event) =>
            event.type === "APP_DELETED" ||
            event.type === "JOB_SUCCEEDED" ||
            event.type === "JOB_FAILED" ||
            event.type === "CANCEL_REQUESTED",
        }),
      };
    } catch (error) {
      imageGenerationService.endAppDeletion(appId);
      throw error;
    }
  }

  async prepareAppDeletion(fence: ImageGenerationDeletionFence): Promise<void> {
    const { appId } = fence;
    const actor = this.host.peek<
      ImageGenerationActorState,
      ImageGenerationEvent,
      ImageGenerationIgnoreReason
    >(imageGenerationDefinition.id, getImageGenerationKey());
    if (actor) {
      imageGenerationPresentationService.forgetApp(appId, actor.getSnapshot());
      await actor.enqueue({ type: "APP_DELETED", appId }).settled;
    }
    await imageGenerationService.cancelAndSettleApp(appId);
    await fence.handle.seal();
  }

  finishAppDeletion(
    fence: ImageGenerationDeletionFence,
    committed: boolean,
  ): void {
    try {
      if (committed) {
        if (!fence.handle.commit()) {
          throw new Error(
            "Image-generation deletion fence is no longer current",
          );
        }
        imageGenerationOperationService.releaseApp(fence.appId);
        if (!fence.handle.release()) {
          throw new Error(
            "Image-generation deletion fence could not be released",
          );
        }
      } else {
        fence.handle.abort();
      }
    } finally {
      imageGenerationService.endAppDeletion(fence.appId);
    }
  }

  async disposeAllApps(): Promise<void> {
    await this.host.disposeMachine(imageGenerationDefinition.id);
  }
}

export const imageGenerationActorService = new ImageGenerationActorService();
