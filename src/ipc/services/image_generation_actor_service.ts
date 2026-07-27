import { getImageGenerationKey } from "@/image_generation/transport";
import type {
  ImageGenerationActorState,
  ImageGenerationEvent,
  ImageGenerationIgnoreReason,
} from "@/image_generation/state";
import { imageGenerationDefinition } from "./image_generation_definition";
import { imageGenerationPresentationService } from "./image_generation_presentation_service";
import { imageGenerationService } from "./image_generation_service";
import { remoteMachineHost } from "./distributed_machine_host";

type ImageGenerationActorHost = Pick<
  typeof remoteMachineHost,
  "peek" | "disposeMachine"
>;

export class ImageGenerationActorService {
  constructor(
    private readonly host: ImageGenerationActorHost = remoteMachineHost,
  ) {}

  async disposeApp(appId: number): Promise<void> {
    await imageGenerationService.cancelAndSettleApp(appId);
    const actor = this.host.peek<
      ImageGenerationActorState,
      ImageGenerationEvent,
      ImageGenerationIgnoreReason
    >(imageGenerationDefinition.id, getImageGenerationKey());
    if (!actor) return;
    imageGenerationPresentationService.forgetApp(appId, actor.getSnapshot());
    actor.send({ type: "APP_DELETED", appId });
  }

  async disposeAllApps(): Promise<void> {
    await imageGenerationService.cancelAndSettleAll();
    await this.host.disposeMachine(imageGenerationDefinition.id);
  }
}

export const imageGenerationActorService = new ImageGenerationActorService();
