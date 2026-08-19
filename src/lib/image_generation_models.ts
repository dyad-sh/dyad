export type NativeImageProvider =
  | "auto"
  | "openrouter"
  | "openai"
  | "google"
  | "vercel";

export const CLOUD_IMAGE_GENERATION_TIMEOUT_MS = 120_000;
export const LOCAL_IMAGE_GENERATION_TIMEOUT_MS = 10 * 60_000;

/**
 * Local renderers may need several minutes to load a multi-gigabyte model
 * before producing the first image. Cloud APIs should still fail quickly.
 */
export function getImageGenerationTimeoutMs(provider: string): number {
  return ["ollama", "lmstudio", "mx_serve"].includes(provider)
    ? LOCAL_IMAGE_GENERATION_TIMEOUT_MS
    : CLOUD_IMAGE_GENERATION_TIMEOUT_MS;
}

export type BuiltInImageModel = {
  provider: Exclude<NativeImageProvider, "openrouter">;
  providerName: string;
  name: string;
  displayName: string;
};

/**
 * Image models that have a native request path in Meta Human OS. OpenRouter's
 * image catalogue is loaded dynamically and is therefore added separately.
 */
export const BUILT_IN_IMAGE_MODELS: readonly BuiltInImageModel[] = [
  {
    provider: "openai",
    providerName: "OpenAI",
    name: "gpt-image-2",
    displayName: "GPT Image 2",
  },
  {
    provider: "openai",
    providerName: "OpenAI",
    name: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
  },
  {
    provider: "google",
    providerName: "Google AI",
    name: "gemini-3.1-flash-image",
    displayName: "Gemini 3.1 Flash Image",
  },
  {
    provider: "google",
    providerName: "Google AI",
    name: "gemini-3-pro-image-preview",
    displayName: "Gemini 3 Pro Image",
  },
  {
    provider: "google",
    providerName: "Google AI",
    name: "imagen-4.0-generate-001",
    displayName: "Imagen 4",
  },
  {
    provider: "google",
    providerName: "Google AI",
    name: "imagen-4.0-fast-generate-001",
    displayName: "Imagen 4 Fast",
  },
  {
    provider: "vercel",
    providerName: "Vercel AI Gateway",
    name: "openai/gpt-image-2",
    displayName: "GPT Image 2",
  },
  {
    provider: "vercel",
    providerName: "Vercel AI Gateway",
    name: "google/imagen-4.0-generate-001",
    displayName: "Imagen 4",
  },
] as const;

export const DEFAULT_IMAGE_MODEL_BY_PROVIDER: Readonly<
  Record<NativeImageProvider, string>
> = {
  auto: "gpt-image-1.5",
  openrouter: "google/gemini-3.1-flash-image-preview",
  openai: "gpt-image-2",
  google: "gemini-3.1-flash-image",
  vercel: "openai/gpt-image-2",
};

export function isNativeImageProvider(
  provider: string,
): provider is NativeImageProvider {
  return ["auto", "openrouter", "openai", "google", "vercel"].includes(
    provider,
  );
}

export function isGeminiImageModel(model: string): boolean {
  return /(?:^|\/)gemini[^/]*image/i.test(model);
}

export function isImageGenerationModel(model: string): boolean {
  return /(?:^|[\s/:_-])(?:image|imagen|flux(?:[._-]?\d+(?:\.\d+)?)?|dall[_-]?e|stable[ _-]?diffusion|nano[ _-]?banana)(?=$|[\s/:_.-])/i.test(
    model,
  );
}

/** An explicit image-role choice must render with that model, not a fallback. */
export function isExplicitImageRendererSelection(
  provider?: string,
  model?: string,
): boolean {
  return Boolean(
    provider?.trim() && model?.trim() && isImageGenerationModel(model),
  );
}

/**
 * A text model selected under an image-capable provider should not be sent to
 * an image endpoint. Keep genuine image model choices, otherwise use that
 * provider's current default image model.
 */
export function resolveNativeImageModel(
  provider: NativeImageProvider,
  requestedModel?: string,
): string {
  const requested = requestedModel?.trim();
  return requested && isImageGenerationModel(requested)
    ? requested
    : DEFAULT_IMAGE_MODEL_BY_PROVIDER[provider];
}
