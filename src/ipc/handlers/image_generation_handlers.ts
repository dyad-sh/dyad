import { imageGenerationContracts } from "@/ipc/types/image_generation";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import { imageGenerationOperationService } from "../services/image_generation_operation_service";
import { createTypedHandler } from "./base";

export function registerImageGenerationHandlers(): void {
  createTypedHandler(
    imageGenerationContracts.waitForOperation,
    async (event, { requestId }) => {
      const windowSessionId = windowRegistry.ensureRegistered(event.sender);
      return imageGenerationOperationService.waitFor(
        requestId,
        windowSessionId,
      );
    },
  );
}
