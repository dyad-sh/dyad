import { imageGenerationContracts } from "@/ipc/types/image_generation";
import { imageGenerationOperationService } from "../services/image_generation_operation_service";
import { createTypedHandler } from "./base";

export function registerImageGenerationHandlers(): void {
  createTypedHandler(
    imageGenerationContracts.waitForOperation,
    async (_event, { requestId }) =>
      imageGenerationOperationService.waitFor(requestId),
  );
}
