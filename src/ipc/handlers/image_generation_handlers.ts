import { createTypedHandler } from "./base";
import {
  imageGenerationContracts,
  ImageGenerationApiResponseSchema,
  OpenRouterImageApiResponseSchema,
  OpenRouterModelsListSchema,
  type ImageThemeMode,
} from "../types/image_generation";
import { getEnvVar } from "../utils/read_env";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { DYAD_MEDIA_DIR_NAME } from "../utils/media_path_utils";
import { safeJoin } from "../utils/path_utils";
import { withLock } from "../utils/lock_utils";
import { selectGeneratedImages } from "../utils/generated_images";
import {
  isBlobConnected,
  isCloudStorageEnabled,
  uploadToBlob,
} from "../utils/vercel_blob";
import { readSettings } from "../../main/settings";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { saveGeneratedImageToLocalVault } from "../utils/storage_vault";
import { generateImage, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGateway } from "@ai-sdk/gateway";
import { getAssignedModelForRole } from "@/lib/model_roles";
import {
  getImageGenerationTimeoutMs,
  isGeminiImageModel,
  isExplicitImageRendererSelection,
  isImageGenerationModel,
  isNativeImageProvider,
  resolveNativeImageModel,
  type NativeImageProvider,
} from "@/lib/image_generation_models";
import { getModelClient } from "../utils/get_model_client";
import { getLanguageModelProviders } from "../shared/language_model_helpers";
import {
  getLMStudioApiBaseUrl,
  getOllamaBaseUrlFromSettings,
} from "@/lib/local_provider_utils";
import { getMxServeApiBaseUrl } from "@/lib/mx_serve";
import { assertLocalModelReady } from "@/lib/validate_local_model";

const logger = log.scope("image_generation_handlers");

// Track active generation controllers so they can be cancelled from the renderer
const activeControllers = new Map<string, AbortController>();

const DYAD_ENGINE_URL =
  process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";

const IMAGE_GENERATION_TIMEOUT_MS = 120_000;
const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

// Dedicated library "app" that holds Image Agent generations so they show up in
// Library → Media (media is stored per-app).
const IMAGE_AGENT_APP_NAME = "Image Agent";
export const IMAGE_AGENT_APP_PATH = "image-agent-generations";

async function getOrCreateImageAgentApp() {
  const existing = await db.query.apps.findFirst({
    where: eq(apps.path, IMAGE_AGENT_APP_PATH),
  });
  if (existing) return existing;

  const fullAppPath = getDyadAppPath(IMAGE_AGENT_APP_PATH);
  await fs.promises.mkdir(path.join(fullAppPath, DYAD_MEDIA_DIR_NAME), {
    recursive: true,
  });
  const [app] = await db
    .insert(apps)
    .values({ name: IMAGE_AGENT_APP_NAME, path: IMAGE_AGENT_APP_PATH })
    .returning();
  return app;
}

async function loadImageForLibrary(
  image: string,
): Promise<{ buffer: Buffer; mime: string }> {
  const dataUrlMatch = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(image);
  if (dataUrlMatch) {
    return {
      mime: dataUrlMatch[1],
      buffer: Buffer.from(dataUrlMatch[2], "base64"),
    };
  }

  let url: URL;
  try {
    url = new URL(image);
  } catch {
    throw new DyadError("Invalid image data.", DyadErrorKind.Validation);
  }
  if (url.protocol !== "https:") {
    throw new DyadError(
      "Generated image URLs must use HTTPS.",
      DyadErrorKind.Validation,
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    IMAGE_DOWNLOAD_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    throw new DyadError(
      `Could not download the generated image: ${
        error instanceof Error ? error.message : String(error)
      }`,
      DyadErrorKind.External,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new DyadError(
      `Could not download the generated image (HTTP ${response.status}).`,
      DyadErrorKind.External,
    );
  }
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (!mime?.startsWith("image/")) {
    throw new DyadError(
      "The generated image URL did not return an image.",
      DyadErrorKind.Validation,
    );
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_SIZE) {
    throw new DyadError(
      "Image exceeds the maximum allowed size.",
      DyadErrorKind.Validation,
    );
  }
  return { mime, buffer: Buffer.from(await response.arrayBuffer()) };
}

const THEME_SYSTEM_PROMPTS: Record<ImageThemeMode, string | null> = {
  plain: null,
  "3d-clay":
    "Render in a breathtaking 3D claymorphism style with cinematic quality. All subjects must look hand-sculpted from luxuriously smooth, matte clay with a beautiful subsurface-scattering glow that makes surfaces feel warm and alive. Use dramatic yet soft three-point studio lighting — a warm key light, cool fill light, and gentle rim light — to create depth and dimension with delicate ambient occlusion and velvety contact shadows. Edges should be perfectly rounded and beveled with satisfying, pillowy softness; proportions slightly inflated and charmingly stylized. Apply a curated palette of 4–6 rich, harmonious tones with subtle color variation across surfaces — gentle hue shifts, soft specular highlights, and warm-to-cool gradients that give each piece visual interest. Add micro-details: tiny imperfections in the clay texture, soft fingerprint-like dimples, and delicate catchlights in glossy areas. Backgrounds should use a beautiful soft gradient with atmospheric depth and a subtle ground-plane reflection. The final render should feel like an award-winning Blender/Cinema 4D hero shot: irresistibly tactile, miniature-world charming, and gallery-worthy.",
  "real-photography":
    "Produce a jaw-droppingly photorealistic image that rivals the work of world-class photographers. Simulate masterful lighting — whether golden-hour warmth, dramatic chiaroscuro, or pristine studio setups — with physically accurate specular highlights, luminous soft falloff, and rich, natural shadows with subtle color in the shadow tones. Render hyper-detailed material textures: visible skin pores with natural translucency, intricate fabric weave catching the light, polished metal with environment reflections, and surfaces that beg to be touched. Apply cinematic depth of field (f/1.4–f/2.8) with creamy, circular bokeh that transforms background lights into dreamy orbs. Compose using the rule of thirds with leading lines and intentional framing that draws the eye. Color grade with a refined, editorial look — rich mid-tones, lifted shadows with subtle color casts, and controlled highlights that feel magazine-cover worthy. Include atmospheric details: volumetric light rays, natural lens flares, gentle vignetting, and film-like grain at ISO 100–400. The image should feel like it was captured on a medium-format Hasselblad with a Zeiss prime lens — breathtaking clarity, extraordinary dynamic range, and an unmistakable sense of artistry.",
  "isometric-illustration":
    "Create a stunning isometric illustration at a true 30° isometric projection angle with extraordinary attention to detail and visual richness. Use a refined vector style with vibrant, carefully chosen colors that feel premium and modern. Apply a sophisticated color palette (5–8 colors) with beautiful gradients, subtle lighting effects, and gentle color transitions that give depth and dimension — avoid flat, lifeless fills. Add layered soft shadows and ambient occlusion beneath and between objects to create a sense of depth and realism while maintaining the illustrative style. Include micro-details: tiny highlights, subtle textures (gentle noise, fine patterns), and delicate light reflections on surfaces to make the scene feel alive and crafted. Compose the scene with visual storytelling — arrange elements with intentional hierarchy, negative space, and a sense of narrative. Use a soft, complementary background with a subtle gradient or atmospheric glow that enhances the focal objects. The overall aesthetic should feel like a premium Dribbble or Behance showcase piece: elegant, whimsical yet polished, with a warm inviting atmosphere suitable for high-end SaaS product marketing or editorial illustration.",
};

/**
 * Best-effort upload when Vercel Blob is the selected storage destination.
 * Never throws — the local copy is always the source of truth.
 */
async function maybeUploadImageToBlob(
  pathname: string,
  buffer: Buffer,
  contentType?: string,
): Promise<string | undefined> {
  if (!isCloudStorageEnabled() || !isBlobConnected()) return undefined;
  try {
    const { url } = await uploadToBlob(pathname, buffer, {
      contentType,
      addRandomSuffix: true,
    });
    logger.log(`Uploaded image to Vercel Blob: ${url}`);
    return url;
  } catch (e) {
    logger.error("Vercel Blob upload failed (kept local copy):", e);
    return undefined;
  }
}

function configuredImageApiKey(
  provider: NativeImageProvider,
  settings: ReturnType<typeof readSettings>,
): string | undefined {
  const saved = settings.providerSettings?.[provider]?.apiKey?.value?.trim();
  if (saved) return saved;
  if (provider === "vercel") {
    return (
      settings.vercelAiGatewayApiKey?.value?.trim() ||
      getEnvVar("AI_GATEWAY_API_KEY")
    );
  }
  if (provider === "auto") {
    return saved || getEnvVar("DYAD_API_KEY");
  }
  return getEnvVar(
    provider === "openai"
      ? "OPENAI_API_KEY"
      : provider === "google"
        ? "GEMINI_API_KEY"
        : "OPENROUTER_API_KEY",
  );
}

function generatedFilesAsDataUrls(
  files: readonly { base64: string; mediaType: string }[],
): string[] {
  return files
    .filter((file) => file.mediaType.startsWith("image/"))
    .map((file) => `data:${file.mediaType};base64,${file.base64}`);
}

function imageApiDataAsUrls(
  data: Array<{ url?: string | null; b64_json?: string | null }>,
): string[] {
  return data.flatMap((image) =>
    image.b64_json
      ? [`data:image/png;base64,${image.b64_json}`]
      : image.url
        ? [image.url]
        : [],
  );
}

async function generateWithOpenAICompatibleEndpoint(input: {
  baseURL: string;
  apiKey?: string;
  model: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<{ images: string[]; model: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.apiKey?.trim()) {
    headers.Authorization = `Bearer ${input.apiKey.trim()}`;
  }
  const response = await fetch(
    `${input.baseURL.replace(/\/+$/, "")}/images/generations`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        n: 1,
        response_format: "b64_json",
      }),
      signal: input.signal,
    },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const parsed = ImageGenerationApiResponseSchema.safeParse(
    await response.json(),
  );
  if (!parsed.success) {
    throw new Error("the image endpoint returned an invalid response");
  }
  return { images: imageApiDataAsUrls(parsed.data.data), model: input.model };
}

async function configuredCompatibleEndpoint(
  provider: string,
  settings: ReturnType<typeof readSettings>,
): Promise<{ baseURL: string; apiKey?: string } | undefined> {
  const stored = settings.providerSettings?.[provider] as
    | { apiBaseUrl?: string; apiKey?: { value?: string } }
    | undefined;
  const providers = await getLanguageModelProviders();
  const providerInfo = providers.find((item) => item.id === provider);
  const apiKey =
    stored?.apiKey?.value?.trim() ||
    (providerInfo?.envVarName ? getEnvVar(providerInfo.envVarName) : undefined);

  if (provider === "lmstudio") {
    return { baseURL: getLMStudioApiBaseUrl(settings), apiKey };
  }
  if (provider === "ollama") {
    return {
      baseURL: `${getOllamaBaseUrlFromSettings(settings)}/v1`,
      apiKey,
    };
  }
  if (provider === "mx_serve") {
    return { baseURL: getMxServeApiBaseUrl(settings), apiKey };
  }
  const baseURL =
    stored?.apiBaseUrl?.trim() || providerInfo?.apiBaseUrl?.trim();
  return baseURL ? { baseURL: baseURL.replace(/\/+$/, ""), apiKey } : undefined;
}

function firstConfiguredImageProvider(
  settings: ReturnType<typeof readSettings>,
  exclude?: string,
): NativeImageProvider | undefined {
  return (["auto", "openrouter", "openai", "google", "vercel"] as const).find(
    (provider) =>
      provider !== exclude &&
      Boolean(configuredImageApiKey(provider, settings)),
  );
}

async function prepareImagePromptWithModel(input: {
  provider: string;
  model: string;
  prompt: string;
  settings: ReturnType<typeof readSettings>;
  signal: AbortSignal;
}): Promise<string> {
  const { modelClient } = await getModelClient(
    { provider: input.provider, name: input.model },
    input.settings,
  );
  const result = await generateText({
    model: modelClient.model,
    system:
      "You are an image prompt director. Rewrite the user's request into one production-ready image-generation prompt. Preserve every requested subject and constraint. Add useful composition, lighting, material, camera, colour and style details, but do not invent logos, captions or text. Return only the final prompt, with no preamble or Markdown.",
    prompt: input.prompt,
    temperature: 0.4,
    maxOutputTokens: 900,
    maxRetries: 1,
    abortSignal: input.signal,
  });
  const prepared = result.text.trim();
  if (!prepared) {
    throw new Error("the selected text model returned an empty image prompt");
  }
  return prepared.slice(0, 4000);
}

async function generateWithNativeImageProvider(input: {
  provider: Exclude<NativeImageProvider, "openrouter">;
  apiKey: string;
  model: string;
  prompt: string;
  inputImage?: string;
  signal: AbortSignal;
}): Promise<{
  images: string[];
  text?: string;
  model: string;
  provider: string;
}> {
  if (input.provider === "auto") {
    const response = await fetch(`${DYAD_ENGINE_URL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({ prompt: input.prompt, model: input.model }),
      signal: input.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = ImageGenerationApiResponseSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success) {
      throw new Error("the image service returned an invalid response");
    }
    return {
      images: imageApiDataAsUrls(parsed.data.data),
      model: input.model,
      provider: input.provider,
    };
  }

  if (input.provider === "google" && isGeminiImageModel(input.model)) {
    const google = createGoogleGenerativeAI({ apiKey: input.apiKey });
    const result = await generateText({
      model: google(input.model),
      ...(input.inputImage
        ? {
            messages: [
              {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: input.prompt },
                  {
                    type: "image" as const,
                    image: input.inputImage,
                  },
                ],
              },
            ],
          }
        : { prompt: input.prompt }),
      providerOptions: {
        google: { responseModalities: ["TEXT", "IMAGE"] },
      },
      abortSignal: input.signal,
    });
    return {
      images: generatedFilesAsDataUrls(result.files),
      text: result.text?.trim() || undefined,
      model: input.model,
      provider: input.provider,
    };
  }

  const imageModel =
    input.provider === "openai"
      ? createOpenAI({ apiKey: input.apiKey }).image(input.model)
      : input.provider === "google"
        ? createGoogleGenerativeAI({ apiKey: input.apiKey }).image(input.model)
        : createGateway({ apiKey: input.apiKey }).imageModel(input.model);
  const result = await generateImage({
    model: imageModel,
    prompt: input.inputImage
      ? { text: input.prompt, images: [input.inputImage] }
      : input.prompt,
    n: 1,
    abortSignal: input.signal,
  });
  return {
    images: generatedFilesAsDataUrls(result.images),
    model: input.model,
    provider: input.provider,
  };
}

export function registerImageGenerationHandlers() {
  createTypedHandler(
    imageGenerationContracts.generateImage,
    async (_, params) => {
      const settings = readSettings();
      const apiKey = settings.providerSettings?.auto?.apiKey?.value;

      if (!apiKey) {
        throw new DyadError(
          "Pro API key is required for image generation",
          DyadErrorKind.Auth,
        );
      }

      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.targetAppId),
      });
      if (!app) {
        throw new DyadError("Target app not found", DyadErrorKind.NotFound);
      }

      const systemPrompt = THEME_SYSTEM_PROMPTS[params.themeMode];
      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${params.prompt}`
        : params.prompt;

      const requestId = params.requestId;
      const controller = new AbortController();
      activeControllers.set(requestId, controller);
      const timeoutId = setTimeout(
        () => controller.abort(),
        IMAGE_GENERATION_TIMEOUT_MS,
      );

      let response: Response;
      try {
        response = await fetch(`${DYAD_ENGINE_URL}/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "X-Dyad-Request-Id": requestId,
          },
          body: JSON.stringify({
            prompt: fullPrompt,
            model: "gpt-image-1.5",
          }),
          signal: controller.signal,
        });
      } catch (error) {
        activeControllers.delete(requestId);
        if (error instanceof Error && error.name === "AbortError") {
          throw new DyadError(
            "Image generation cancelled or timed out.",
            DyadErrorKind.UserCancelled,
          );
        }
        throw new DyadError(
          "Failed to connect to image generation service.",
          DyadErrorKind.External,
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        // Only log status code and request ID — never log response body
        // as it may echo back request details including credentials
        logger.error(
          `Image generation API error: HTTP ${response.status} (request: ${requestId})`,
        );
        throw new Error(
          `Image generation failed (HTTP ${response.status}). Please try again.`,
        );
      }

      const rawData = await response.json();
      const parsed = ImageGenerationApiResponseSchema.safeParse(rawData);
      if (!parsed.success) {
        logger.error("Invalid image generation response:", parsed.error);
        throw new DyadError(
          "Invalid response from image generation service",
          DyadErrorKind.External,
        );
      }

      const imageData = parsed.data.data[0];
      if (!imageData?.b64_json && !imageData?.url) {
        throw new DyadError(
          "No image data returned from generation service",
          DyadErrorKind.External,
        );
      }

      // Prepare image data before acquiring lock (network I/O outside lock)
      let imageBuffer: Buffer;
      if (imageData.b64_json) {
        imageBuffer = Buffer.from(imageData.b64_json, "base64");
        if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
          throw new DyadError(
            "Decoded image exceeds maximum allowed size",
            DyadErrorKind.Validation,
          );
        }
      } else if (imageData.url) {
        const imageUrl = new URL(imageData.url);
        if (imageUrl.protocol !== "https:") {
          throw new DyadError(
            "Image URL must use HTTPS",
            DyadErrorKind.External,
          );
        }
        const dlController = new AbortController();
        const dlTimeout = setTimeout(
          () => dlController.abort(),
          IMAGE_GENERATION_TIMEOUT_MS,
        );
        try {
          const imgResponse = await fetch(imageData.url, {
            signal: dlController.signal,
          });
          if (!imgResponse.ok) {
            throw new Error(
              `Failed to download image: ${imgResponse.status} ${imgResponse.statusText}`,
            );
          }
          const arrayBuffer = await imgResponse.arrayBuffer();
          if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
            throw new DyadError(
              "Downloaded image exceeds maximum allowed size",
              DyadErrorKind.Validation,
            );
          }
          imageBuffer = Buffer.from(arrayBuffer);
        } catch (dlError) {
          if (dlError instanceof Error && dlError.name === "AbortError") {
            throw new DyadError(
              "Image download timed out. Please try again.",
              DyadErrorKind.External,
            );
          }
          throw dlError;
        } finally {
          clearTimeout(dlTimeout);
        }
      } else {
        throw new DyadError(
          "Unexpected image response format",
          DyadErrorKind.External,
        );
      }

      // Save to app's media folder under lock (consistent with media CRUD handlers)
      const { fileName, filePath, appPath } = await withLock(
        `media:${params.targetAppId}`,
        async () => {
          const appPath = getDyadAppPath(app.path);
          const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
          await fs.promises.mkdir(mediaDir, { recursive: true });

          const timestamp = Date.now();
          const sanitizedPrompt =
            params.prompt
              .slice(0, 30)
              .replace(/[^a-zA-Z0-9]/g, "_")
              .replace(/_+/g, "_")
              .replace(/^_|_$/g, "")
              .toLowerCase() || "image";
          const fileName = `generated_${sanitizedPrompt}_${timestamp}.png`;
          const filePath = safeJoin(mediaDir, fileName);

          await fs.promises.writeFile(filePath, imageBuffer);

          logger.log(`Generated image saved: ${filePath}`);
          await maybeUploadImageToBlob(
            `images/${fileName}`,
            imageBuffer,
            "image/png",
          );
          return { fileName, filePath, appPath: app.path };
        },
      );

      activeControllers.delete(requestId);

      return {
        fileName,
        filePath,
        appPath,
        appId: app.id,
        appName: app.name,
      };
    },
  );

  // Image Agent: route through the provider assigned to the Image model role.
  // Unlike `generateImage`, this is app-independent and returns base64 data
  // URLs straight to the renderer instead of saving into an app's media folder.
  createTypedHandler(
    imageGenerationContracts.generateAgentImage,
    async (_, params) => {
      const settings = readSettings();
      const assigned = getAssignedModelForRole(settings, "image");
      const requestedProvider =
        params.provider?.trim() || assigned?.provider || "openrouter";
      const requestedModel =
        params.model?.trim() ||
        (assigned?.provider === requestedProvider ? assigned.name : undefined);
      const requiresSelectedRenderer = isExplicitImageRendererSelection(
        requestedProvider,
        requestedModel,
      );
      let effectivePrompt = params.prompt;
      let promptProvider: string | undefined;
      let promptModel: string | undefined;

      // A text-only selection still participates: it directs and expands the
      // user's prompt before a dedicated image model renders the pixels.
      if (requestedModel && !isImageGenerationModel(requestedModel)) {
        const controller = new AbortController();
        if (params.requestId)
          activeControllers.set(params.requestId, controller);
        const timeoutId = setTimeout(
          () => controller.abort(),
          IMAGE_GENERATION_TIMEOUT_MS,
        );
        try {
          effectivePrompt = await prepareImagePromptWithModel({
            provider: requestedProvider,
            model: requestedModel,
            prompt: params.prompt,
            settings,
            signal: controller.signal,
          });
          promptProvider = requestedProvider;
          promptModel = requestedModel;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new DyadError(
              `${requestedProvider} timed out while preparing the image prompt.`,
              DyadErrorKind.External,
            );
          }
          throw new DyadError(
            `${requestedProvider} could not prepare the image prompt: ${error instanceof Error ? error.message : String(error)}`,
            DyadErrorKind.External,
          );
        } finally {
          clearTimeout(timeoutId);
          if (params.requestId) activeControllers.delete(params.requestId);
        }
      }

      // Local and custom providers can participate without a bespoke adapter
      // when they expose the OpenAI-compatible image endpoint. If they do not,
      // continue to a configured image backend instead of breaking the request.
      let compatibleEndpointError: string | undefined;
      if (
        !isNativeImageProvider(requestedProvider) &&
        requestedModel &&
        isImageGenerationModel(requestedModel)
      ) {
        let compatibleEndpointReady = true;
        if (requestedProvider === "ollama") {
          try {
            await assertLocalModelReady(
              { provider: requestedProvider, name: requestedModel },
              settings,
            );
          } catch (error) {
            compatibleEndpointReady = false;
            compatibleEndpointError =
              error instanceof Error ? error.message : String(error);
            logger.warn(
              `Ollama image model is unavailable; trying a configured image backend (${compatibleEndpointError})`,
            );
          }
        }
        const endpoint = await configuredCompatibleEndpoint(
          requestedProvider,
          settings,
        );
        if (!endpoint) {
          compatibleEndpointError =
            "no OpenAI-compatible image endpoint is configured";
        } else if (params.inputImage) {
          compatibleEndpointError =
            "image editing is not supported by this local image endpoint";
        }
        if (compatibleEndpointReady && endpoint && !params.inputImage) {
          const controller = new AbortController();
          if (params.requestId)
            activeControllers.set(params.requestId, controller);
          const timeoutMs = getImageGenerationTimeoutMs(requestedProvider);
          let timedOut = false;
          const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
          try {
            const result = await generateWithOpenAICompatibleEndpoint({
              ...endpoint,
              model: requestedModel,
              prompt: effectivePrompt,
              signal: controller.signal,
            });
            if (result.images.length > 0) {
              return {
                ...result,
                provider: requestedProvider,
                promptProvider,
                promptModel,
              };
            }
            compatibleEndpointError = "no image was returned";
          } catch (error) {
            const stoppedByUser =
              params.requestId != null &&
              !activeControllers.has(params.requestId);
            if (stoppedByUser) {
              throw new DyadError(
                "Image generation stopped.",
                DyadErrorKind.UserCancelled,
              );
            }
            compatibleEndpointError = timedOut
              ? `timed out after ${Math.round(timeoutMs / 60_000)} minutes while the local model was loading or rendering`
              : error instanceof Error
                ? error.message
                : String(error);
            logger.warn(
              `${requestedProvider} image endpoint failed (${compatibleEndpointError})`,
            );
          } finally {
            clearTimeout(timeoutId);
            if (params.requestId) activeControllers.delete(params.requestId);
          }
        }

        // When the user deliberately assigned a real image renderer, respect
        // that choice. Silently replacing an unavailable local Flux model with
        // OpenRouter made Settings say one thing while Chat used another.
        if (requiresSelectedRenderer && compatibleEndpointError) {
          throw new DyadError(
            `${requestedProvider} could not generate with ${requestedModel}: ${compatibleEndpointError}. The selected image renderer was not replaced with another provider.`,
            DyadErrorKind.Precondition,
          );
        }
      }

      let provider = isNativeImageProvider(requestedProvider)
        ? requestedProvider
        : firstConfiguredImageProvider(settings, requestedProvider);
      let apiKey = provider
        ? configuredImageApiKey(provider, settings)
        : undefined;

      // A provider may be present in a saved role after its credential was
      // removed. Keep generation working with another connected backend.
      if (!apiKey) {
        provider = firstConfiguredImageProvider(settings, requestedProvider);
        apiKey = provider
          ? configuredImageApiKey(provider, settings)
          : undefined;
      }

      if (!provider || !apiKey) {
        throw new DyadError(
          compatibleEndpointError
            ? `${requestedProvider} could not generate an image (${compatibleEndpointError}), and no fallback image backend is connected. Connect OpenRouter, OpenAI, Google AI, Vercel AI Gateway, Meta Human OS Pro, or a local image server with an OpenAI-compatible /images/generations endpoint.`
            : `${requestedProvider} does not expose an image-generation endpoint, and no fallback image backend is connected. Connect OpenRouter, OpenAI, Google AI, Vercel AI Gateway, Meta Human OS Pro, or a local image server with an OpenAI-compatible /images/generations endpoint.`,
          DyadErrorKind.Precondition,
        );
      }

      const routedFromProvider =
        provider === requestedProvider ? undefined : requestedProvider;
      const model = resolveNativeImageModel(
        provider,
        provider === requestedProvider ? requestedModel : undefined,
      );

      if (provider !== "openrouter") {
        const controller = new AbortController();
        if (params.requestId) {
          activeControllers.set(params.requestId, controller);
        }
        const timeoutId = setTimeout(
          () => controller.abort(),
          IMAGE_GENERATION_TIMEOUT_MS,
        );
        try {
          const result = await generateWithNativeImageProvider({
            provider,
            apiKey,
            model,
            prompt: effectivePrompt,
            inputImage: params.inputImage,
            signal: controller.signal,
          });
          if (result.images.length === 0) {
            throw new DyadError(
              `${model} did not return an image. Select a model labelled Image Generation.`,
              DyadErrorKind.External,
            );
          }
          return {
            ...result,
            routedFromProvider,
            promptProvider,
            promptModel,
          };
        } catch (error) {
          if (error instanceof DyadError) throw error;
          if (error instanceof Error && error.name === "AbortError") {
            throw new DyadError(
              "Image generation stopped or timed out.",
              DyadErrorKind.External,
            );
          }
          throw new DyadError(
            `Image generation with ${provider} failed: ${error instanceof Error ? error.message : String(error)}`,
            DyadErrorKind.External,
          );
        } finally {
          clearTimeout(timeoutId);
          if (params.requestId) activeControllers.delete(params.requestId);
        }
      }

      // Multi-part content when editing an existing image, plain text otherwise.
      const userContent = params.inputImage
        ? [
            { type: "text", text: effectivePrompt },
            { type: "image_url", image_url: { url: params.inputImage } },
          ]
        : effectivePrompt;

      const controller = new AbortController();
      // Registered so the composer's stop button can abort this request.
      if (params.requestId) {
        activeControllers.set(params.requestId, controller);
      }
      const timeoutId = setTimeout(
        () => controller.abort(),
        IMAGE_GENERATION_TIMEOUT_MS,
      );

      let response: Response;
      try {
        response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "X-Title": "Meta Human OS Image Agent",
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: userContent }],
              modalities: ["image", "text"],
              // One picture per request. Some image models otherwise return
              // several near-identical variants for a single prompt.
              n: 1,
            }),
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // Cancelling removes the controller from the map first; a timeout
          // leaves it there. That difference is how we tell them apart.
          const stoppedByUser =
            params.requestId != null &&
            !activeControllers.has(params.requestId);
          throw new DyadError(
            stoppedByUser
              ? "Image generation stopped."
              : "Image generation timed out. Please try again.",
            DyadErrorKind.External,
          );
        }
        throw new DyadError(
          "Failed to connect to OpenRouter.",
          DyadErrorKind.External,
        );
      } finally {
        clearTimeout(timeoutId);
        if (params.requestId) activeControllers.delete(params.requestId);
      }

      if (!response.ok) {
        let detail = "";
        try {
          const errJson: unknown = await response.json();
          const message = (errJson as { error?: { message?: unknown } })?.error
            ?.message;
          if (typeof message === "string") {
            detail = `: ${message.slice(0, 200)}`;
          }
        } catch {
          // Ignore body parse errors — never log the raw body (may echo input).
        }
        logger.error(`OpenRouter image API error: HTTP ${response.status}`);
        throw new DyadError(
          `Image generation failed (HTTP ${response.status})${detail}`,
          DyadErrorKind.External,
        );
      }

      const rawData = await response.json();
      const parsed = OpenRouterImageApiResponseSchema.safeParse(rawData);
      if (!parsed.success) {
        logger.error("Invalid OpenRouter image response:", parsed.error);
        throw new DyadError(
          "Invalid response from OpenRouter.",
          DyadErrorKind.External,
        );
      }

      const message = parsed.data.choices[0]?.message;
      const images = selectGeneratedImages(
        (message?.images ?? []).map((img) => img.image_url.url),
      );

      if (images.length === 0) {
        throw new DyadError(
          "The model did not return any images. Try rephrasing your prompt.",
          DyadErrorKind.External,
        );
      }

      const text =
        typeof message?.content === "string" ? message.content : undefined;

      return {
        images,
        text,
        model,
        provider,
        routedFromProvider,
        promptProvider,
        promptModel,
      };
    },
  );

  // List all OpenRouter models capable of image output. The /models endpoint
  // is public (no API key required), so the picker can populate before a key
  // is configured.
  createTypedHandler(imageGenerationContracts.listImageModels, async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      throw new DyadError(
        "Failed to load image models from OpenRouter.",
        DyadErrorKind.External,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      logger.error(`OpenRouter models API error: HTTP ${response.status}`);
      throw new DyadError(
        `Failed to load image models (HTTP ${response.status}).`,
        DyadErrorKind.External,
      );
    }

    const parsed = OpenRouterModelsListSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new DyadError(
        "Invalid models response from OpenRouter.",
        DyadErrorKind.External,
      );
    }

    const models = parsed.data.data
      .filter((m) => m.architecture?.output_modalities?.includes("image"))
      .map((m) => ({ id: m.id, name: m.name ?? m.id }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { models };
  });

  // Persist a generated image into the Library (Library → Media). Stored in a
  // dedicated "Image Agent" app's media folder.
  createTypedHandler(
    imageGenerationContracts.saveImageToLibrary,
    async (_, params) => {
      const { mime, buffer } = await loadImageForLibrary(params.image);
      const ext =
        mime === "image/jpeg"
          ? "jpg"
          : mime === "image/webp"
            ? "webp"
            : mime === "image/gif"
              ? "gif"
              : "png";
      if (buffer.byteLength > MAX_IMAGE_SIZE) {
        throw new DyadError(
          "Image exceeds the maximum allowed size.",
          DyadErrorKind.Validation,
        );
      }

      return withLock("image-agent-library", async () => {
        const app = await getOrCreateImageAgentApp();
        const mediaDir = path.join(
          getDyadAppPath(app.path),
          DYAD_MEDIA_DIR_NAME,
        );
        await fs.promises.mkdir(mediaDir, { recursive: true });

        const sanitizedPrompt =
          (params.prompt ?? "")
            .slice(0, 30)
            .replace(/[^a-zA-Z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "")
            .toLowerCase() || "image";
        const fileName = `generated_${sanitizedPrompt}_${Date.now()}.${ext}`;
        const filePath = safeJoin(mediaDir, fileName);
        await fs.promises.writeFile(filePath, buffer);
        logger.log(`Saved Image Agent image to library: ${filePath}`);

        const blobUrl = await maybeUploadImageToBlob(
          `images/${fileName}`,
          buffer,
          mime,
        );

        const storage = readSettings().storage;
        let localVaultPath: string | undefined;
        // Save into the vault whenever one is configured, not only when the
        // vault is the chosen destination: images belong with the rest of the
        // user's files, and cloud sync is an addition rather than a swap.
        // `syncGeneratedMedia: false` remains an explicit opt-out.
        if (
          storage?.localVaultPath?.trim() &&
          storage.syncGeneratedMedia !== false
        ) {
          localVaultPath = await saveGeneratedImageToLocalVault({
            vaultPath: storage.localVaultPath,
            fileName,
            data: buffer,
            prompt: params.prompt,
          });
          logger.log(`Saved generated image to local vault: ${localVaultPath}`);
        }

        return {
          fileName,
          appId: app.id,
          appName: app.name,
          blobUrl,
          storageDestination: blobUrl
            ? ("cloud" as const)
            : localVaultPath
              ? ("local" as const)
              : undefined,
          localVaultPath,
        };
      });
    },
  );

  createTypedHandler(
    imageGenerationContracts.cancelImageGeneration,
    async (_, params) => {
      const controller = activeControllers.get(params.requestId);
      if (controller) {
        controller.abort();
        activeControllers.delete(params.requestId);
        logger.log(`Image generation cancelled: ${params.requestId}`);
        return { cancelled: true };
      }
      return { cancelled: false };
    },
  );
}
