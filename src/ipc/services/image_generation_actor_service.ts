import { getImageGenerationKey } from "@/image_generation/transport";
import type {
  ImageGenerationActorState,
  ImageGenerationEvent,
  ImageGenerationIgnoreReason,
} from "@/image_generation/state";
import type { FenceHandle } from "@/distributed_machines/keyed_admission_gate";
import type { HostedActorRef } from "@/distributed_machines/definition";
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
  readonly actor:
    | HostedActorRef<
        ImageGenerationActorState,
        ImageGenerationEvent,
        ImageGenerationIgnoreReason
      >
    | undefined;
}

export class ImageGenerationActorService {
  constructor(
    private readonly host: ImageGenerationActorHost = remoteMachineHost,
  ) {}

  beginAppDeletion(appId: number): ImageGenerationDeletionFence {
    imageGenerationService.beginAppDeletion(appId);
    try {
      const handle = this.host.beginFence(imageGenerationDefinition, {
        key: getImageGenerationKey(),
        allowDuringDrain: (event) =>
          event.type === "APP_DELETED" ||
          event.type === "JOB_SUCCEEDED" ||
          event.type === "JOB_FAILED" ||
          event.type === "CANCEL_REQUESTED",
      });
      return {
        appId,
        handle,
        actor: this.host.peek<
          ImageGenerationActorState,
          ImageGenerationEvent,
          ImageGenerationIgnoreReason
        >(imageGenerationDefinition.id, getImageGenerationKey()),
      };
    } catch (error) {
      imageGenerationService.endAppDeletion(appId);
      throw error;
    }
  }

  async prepareAppDeletion(fence: ImageGenerationDeletionFence): Promise<void> {
    await imageGenerationService.cancelAndSettleApp(fence.appId);
    await fence.handle.seal();
  }

  async finishAppDeletion(
    fence: ImageGenerationDeletionFence,
    committed: boolean,
  ): Promise<void> {
    try {
      if (committed) {
        if (!fence.handle.commit()) {
          throw new Error(
            "Image-generation deletion fence is no longer current",
          );
        }
        if (!fence.handle.release()) {
          throw new Error(
            "Image-generation deletion fence could not be released",
          );
        }
        if (fence.actor) {
          imageGenerationPresentationService.forgetApp(
            fence.appId,
            fence.actor.getSnapshot(),
          );
          await fence.actor.enqueue({
            type: "APP_DELETED",
            appId: fence.appId,
          }).settled;
        }
        imageGenerationOperationService.releaseApp(fence.appId);
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
