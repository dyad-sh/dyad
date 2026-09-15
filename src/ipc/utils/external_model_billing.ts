import { wrapLanguageModel, type LanguageModel } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { ExternalModelAdmission } from "../services/external_model_admission";
import {
  startExternalModelUsage,
  finishExternalModelUsage,
  interruptExternalModelUsage,
  type ExternalModelBilling,
} from "../services/external_model_usage";

/** Preserve direct inference; report each completed request once in the background. */
export function wrapExternalModelBilling(
  model: LanguageModel,
  billing: ExternalModelBilling,
  apiKey: string,
  admission?: ExternalModelAdmission,
): LanguageModel {
  if (typeof model === "string" || model.specificationVersion !== "v3") {
    throw new Error("External model billing requires a v3 model");
  }
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ doGenerate, params }) => {
        const id = await startExternalModelUsage(
          model.modelId,
          params.abortSignal,
          billing,
          apiKey,
          admission,
        );
        try {
          const result = await doGenerate();
          void finishExternalModelUsage(
            id,
            result.response?.modelId ?? model.modelId,
            result.usage,
          );
          return result;
        } catch (error) {
          interruptExternalModelUsage(id);
          throw error;
        }
      },
      wrapStream: async ({ doStream, params }) => {
        const id = await startExternalModelUsage(
          model.modelId,
          params.abortSignal,
          billing,
          apiKey,
          admission,
        );
        try {
          const result = await doStream();
          const reader = result.stream.getReader();
          let actualModel = model.modelId;
          let finished = false;
          return {
            ...result,
            stream: new ReadableStream<LanguageModelV3StreamPart>({
              async pull(controller) {
                try {
                  const chunk = await reader.read();
                  if (chunk.done) {
                    if (!finished) interruptExternalModelUsage(id);
                    controller.close();
                    return;
                  }
                  if (
                    chunk.value.type === "response-metadata" &&
                    chunk.value.modelId
                  )
                    actualModel = chunk.value.modelId;
                  if (chunk.value.type === "finish" && !finished) {
                    finished = true;
                    void finishExternalModelUsage(
                      id,
                      actualModel,
                      chunk.value.usage,
                    );
                  }
                  controller.enqueue(chunk.value);
                } catch (error) {
                  if (!finished) interruptExternalModelUsage(id);
                  controller.error(error);
                }
              },
              async cancel(reason) {
                if (!finished) interruptExternalModelUsage(id);
                await reader.cancel(reason);
              },
            }),
          };
        } catch (error) {
          interruptExternalModelUsage(id);
          throw error;
        }
      },
    },
  });
}
