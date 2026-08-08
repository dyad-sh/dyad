import { createTypedHandler } from "./base";
import {
  imageGenerationContracts,
  ImageGenerationApiResponseSchema,
  OpenRouterImageApiResponseSchema,
  OpenRouterModelsListSchema,
  NANO_BANANA_2_MODEL,
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

  // Image Agent: generate images directly via OpenRouter (Nano Banana 2).
  // Unlike `generateImage`, this is app-independent and returns base64 data
  // URLs straight to the renderer instead of saving into an app's media folder.
  createTypedHandler(
    imageGenerationContracts.generateAgentImage,
    async (_, params) => {
      const settings = readSettings();
      const apiKey =
        settings.providerSettings?.openrouter?.apiKey?.value ||
        getEnvVar("OPENROUTER_API_KEY");

      if (!apiKey) {
        throw new DyadError(
          "An OpenRouter API key is required. Add it in Settings → AI → Model Providers → OpenRouter.",
          DyadErrorKind.Auth,
        );
      }

      const model = params.model?.trim() || NANO_BANANA_2_MODEL;

      // Multi-part content when editing an existing image, plain text otherwise.
      const userContent = params.inputImage
        ? [
            { type: "text", text: params.prompt },
            { type: "image_url", image_url: { url: params.inputImage } },
          ]
        : params.prompt;

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

      return { images, text, model };
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
