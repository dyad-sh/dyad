import log from "electron-log";
import type { LargeLanguageModel } from "../../lib/schemas";

const logger = log.scope("vision_utils");

/**
 * List of models that support vision/image inputs
 */
const VISION_CAPABLE_MODELS = [
  // OpenAI
  "gpt-4-vision-preview",
  "gpt-4-turbo",
  "gpt-4-turbo-2024-04-09",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "chatgpt-4o-latest",

  // Anthropic
  "claude-3-opus",
  "claude-3-sonnet",
  "claude-3-haiku",
  "claude-3-5-sonnet",
  "claude-3-5-haiku",
  "claude-sonnet-4",
  "claude-opus-4",

  // Google
  "gemini-pro-vision",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-2.0-pro",
  "gemini-2.5-pro",

  // OpenRouter (proxied vision models)
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-3-opus",
  "openai/gpt-4o",
  "openai/gpt-4-vision-preview",
  "google/gemini-pro-vision",
  "google/gemini-1.5-pro",
];

/**
 * Providers that support vision models
 */
const VISION_CAPABLE_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "google-vertex",
  "openrouter",
  "azure", // If using GPT-4 Vision
];

/**
 * Check if a model supports vision inputs
 */
export function isVisionCapable(model: LargeLanguageModel): boolean {
  // Check if provider supports vision
  if (!VISION_CAPABLE_PROVIDERS.includes(model.provider)) {
    return false;
  }

  // Check if specific model supports vision
  const modelName = model.name.toLowerCase();

  // Direct match
  if (VISION_CAPABLE_MODELS.some((vm) => modelName.includes(vm.toLowerCase()))) {
    return true;
  }

  // Pattern matching for common vision model naming conventions
  if (
    modelName.includes("vision") ||
    modelName.includes("gpt-4o") ||
    modelName.includes("claude-3") ||
    modelName.includes("claude-sonnet-4") ||
    modelName.includes("claude-opus-4") ||
    modelName.includes("gemini")
  ) {
    return true;
  }

  return false;
}

/**
 * Get recommended vision model for a provider
 */
export function getRecommendedVisionModel(provider: string): string | null {
  const recommendations: Record<string, string> = {
    openai: "gpt-4o",
    anthropic: "claude-3-5-sonnet-20241022",
    google: "gemini-2.5-flash",
    "google-vertex": "gemini-2.5-flash",
    openrouter: "openai/gpt-4o",
  };

  return recommendations[provider] || null;
}

/**
 * Check if file is an image
 */
export function isImageFile(filePath: string): boolean {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"];
  const ext = filePath.toLowerCase().split(".").pop();
  return imageExtensions.includes(`.${ext}`);
}

/**
 * Get supported image MIME types for vision models
 */
export function getSupportedImageTypes(): string[] {
  return [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
  ];
}

/**
 * Validate if image can be used with vision model
 */
export function validateImageForVision(
  filePath: string,
  fileSize?: number,
): { valid: boolean; error?: string } {
  if (!isImageFile(filePath)) {
    return {
      valid: false,
      error: "File is not a supported image format",
    };
  }

  // Check file size (most models have a limit around 20MB)
  if (fileSize && fileSize > 20 * 1024 * 1024) {
    return {
      valid: false,
      error: "Image file size exceeds 20MB limit",
    };
  }

  return { valid: true };
}

logger.info("Vision utils module loaded");
