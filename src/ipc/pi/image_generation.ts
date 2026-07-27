import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getPiImageModels } from "@/ipc/pi/model_runtime";
import { getOpenRouterAppAttributionHeaders } from "@/ipc/utils/openrouter_attribution";

const DEFAULT_IMAGE_MODEL = "openrouter/auto";
export const IMAGE_GENERATION_TIMEOUT_MS = 120_000;
export const MAX_GENERATED_IMAGE_SIZE = 50 * 1024 * 1024;

export interface GeneratedImageData {
  data: string;
  mimeType: string;
}

function classifyImageGenerationError(message: string): DyadErrorKind {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("no api key") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication") ||
    /\b40[13]\b/.test(normalized)
  ) {
    return DyadErrorKind.Auth;
  }
  if (normalized.includes("rate limit") || /\b429\b/.test(normalized)) {
    return DyadErrorKind.RateLimited;
  }
  return DyadErrorKind.External;
}

export async function generateImage(
  prompt: string,
  signal?: AbortSignal,
): Promise<GeneratedImageData> {
  const models = getPiImageModels();
  const model = models.getModel("openrouter", DEFAULT_IMAGE_MODEL);
  if (!model) {
    throw new DyadError(
      `Image model ${DEFAULT_IMAGE_MODEL} is unavailable.`,
      DyadErrorKind.NotFound,
    );
  }

  const result = await models.generateImages(
    model,
    { input: [{ type: "text", text: prompt }] },
    {
      signal,
      headers: getOpenRouterAppAttributionHeaders(),
      timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
    },
  );
  if (result.stopReason === "aborted") {
    throw new DyadError(
      "Image generation cancelled.",
      DyadErrorKind.UserCancelled,
    );
  }
  if (result.stopReason === "error") {
    const message = result.errorMessage ?? "Image generation failed.";
    throw new DyadError(message, classifyImageGenerationError(message));
  }

  const image = result.output.find((part) => part.type === "image");
  if (!image || image.type !== "image") {
    throw new DyadError(
      "Image generation returned no image data.",
      DyadErrorKind.External,
    );
  }
  return image;
}

export function imageMimeTypeToExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}
