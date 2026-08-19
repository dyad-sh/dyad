import { describe, expect, it } from "vitest";
import {
  BUILT_IN_IMAGE_MODELS,
  CLOUD_IMAGE_GENERATION_TIMEOUT_MS,
  getImageGenerationTimeoutMs,
  isGeminiImageModel,
  isExplicitImageRendererSelection,
  isImageGenerationModel,
  isNativeImageProvider,
  LOCAL_IMAGE_GENERATION_TIMEOUT_MS,
  resolveNativeImageModel,
} from "./image_generation_models";

describe("image generation providers", () => {
  it("allows local image renderers enough time to load and render", () => {
    expect(getImageGenerationTimeoutMs("ollama")).toBe(
      LOCAL_IMAGE_GENERATION_TIMEOUT_MS,
    );
    expect(getImageGenerationTimeoutMs("lmstudio")).toBe(
      LOCAL_IMAGE_GENERATION_TIMEOUT_MS,
    );
    expect(getImageGenerationTimeoutMs("openrouter")).toBe(
      CLOUD_IMAGE_GENERATION_TIMEOUT_MS,
    );
  });

  it("only recognizes providers with an implemented image request path", () => {
    expect(isNativeImageProvider("auto")).toBe(true);
    expect(isNativeImageProvider("openrouter")).toBe(true);
    expect(isNativeImageProvider("openai")).toBe(true);
    expect(isNativeImageProvider("google")).toBe(true);
    expect(isNativeImageProvider("vercel")).toBe(true);
    expect(isNativeImageProvider("fal")).toBe(false);
    expect(isNativeImageProvider("kimi-code")).toBe(false);
  });

  it("offers direct image models for each supported non-OpenRouter provider", () => {
    expect(
      new Set(BUILT_IN_IMAGE_MODELS.map((model) => model.provider)),
    ).toEqual(new Set(["openai", "google", "vercel"]));
    expect(
      new Set(
        BUILT_IN_IMAGE_MODELS.map((model) => `${model.provider}:${model.name}`),
      ).size,
    ).toBe(BUILT_IN_IMAGE_MODELS.length);
  });

  it("distinguishes Gemini image-output models from Imagen models", () => {
    expect(isGeminiImageModel("gemini-3.1-flash-image")).toBe(true);
    expect(isGeminiImageModel("google/gemini-3-pro-image-preview")).toBe(true);
    expect(isGeminiImageModel("imagen-4.0-generate-001")).toBe(false);
    expect(isGeminiImageModel("gpt-image-2")).toBe(false);
  });

  it("keeps image models and replaces text models with the provider default", () => {
    expect(isImageGenerationModel("gpt-image-2")).toBe(true);
    expect(isImageGenerationModel("stable-diffusion-xl")).toBe(true);
    expect(isImageGenerationModel("x/flux2-klein:9b")).toBe(true);
    expect(isImageGenerationModel("black-forest-labs/flux.1-dev")).toBe(true);
    expect(isImageGenerationModel("claude-sonnet-4-6")).toBe(false);
    expect(resolveNativeImageModel("openai", "gpt-image-1.5")).toBe(
      "gpt-image-1.5",
    );
    expect(resolveNativeImageModel("openai", "gpt-5.2")).toBe("gpt-image-2");
    expect(resolveNativeImageModel("google", "gemini-3.1-pro")).toBe(
      "gemini-3.1-flash-image",
    );
  });

  it("distinguishes an explicit renderer from a text prompt-director selection", () => {
    expect(isExplicitImageRendererSelection("ollama", "x/flux2-klein:9b")).toBe(
      true,
    );
    expect(isExplicitImageRendererSelection("ollama", "qwen3:8b")).toBe(false);
    expect(isExplicitImageRendererSelection(undefined, undefined)).toBe(false);
  });
});
