import { createTypedHandler } from "./base";
import {
  imageGenerationContracts,
  ImageGenerationApiResponseSchema,
  type ImageThemeMode,
} from "../types/image_generation";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { DYAD_MEDIA_DIR_NAME } from "../utils/media_path_utils";
import { safeJoin } from "../utils/path_utils";
import { withLock } from "../utils/lock_utils";
import { readSettings } from "../../main/settings";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("image_generation_handlers");

// Track active generation controllers so they can be cancelled from the renderer
const activeControllers = new Map<string, AbortController>();

const DYAD_ENGINE_URL =
  process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";

const IMAGE_GENERATION_TIMEOUT_MS = 120_000;
const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB

const THEME_SYSTEM_PROMPTS: Record<ImageThemeMode, string | null> = {
  plain: null,
  "3d-clay":
    "Render in a breathtaking 3D claymorphism style with cinematic quality. All subjects must look hand-sculpted from luxuriously smooth, matte clay with a beautiful subsurface-scattering glow that makes surfaces feel warm and alive. Use dramatic yet soft three-point studio lighting — a warm key light, cool fill light, and gentle rim light — to create depth and dimension with delicate ambient occlusion and velvety contact shadows. Edges should be perfectly rounded and beveled with satisfying, pillowy softness; proportions slightly inflated and charmingly stylized. Apply a curated palette of 4–6 rich, harmonious tones with subtle color variation across surfaces — gentle hue shifts, soft specular highlights, and warm-to-cool gradients that give each piece visual interest. Add micro-details: tiny imperfections in the clay texture, soft fingerprint-like dimples, and delicate catchlights in glossy areas. Backgrounds should use a beautiful soft gradient with atmospheric depth and a subtle ground-plane reflection. The final render should feel like an award-winning Blender/Cinema 4D hero shot: irresistibly tactile, miniature-world charming, and gallery-worthy.",
  "real-photography":
    "Produce a jaw-droppingly photorealistic image that rivals the work of world-class photographers. Simulate masterful lighting — whether golden-hour warmth, dramatic chiaroscuro, or pristine studio setups — with physically accurate specular highlights, luminous soft falloff, and rich, natural shadows with subtle color in the shadow tones. Render hyper-detailed material textures: visible skin pores with natural translucency, intricate fabric weave catching the light, polished metal with environment reflections, and surfaces that beg to be touched. Apply cinematic depth of field (f/1.4–f/2.8) with creamy, circular bokeh that transforms background lights into dreamy orbs. Compose using the rule of thirds with leading lines and intentional framing that draws the eye. Color grade with a refined, editorial look — rich mid-tones, lifted shadows with subtle color casts, and controlled highlights that feel magazine-cover worthy. Include atmospheric details: volumetric light rays, natural lens flares, gentle vignetting, and film-like grain at ISO 100–400. The image should feel like it was captured on a medium-format Hasselblad with a Zeiss prime lens — breathtaking clarity, extraordinary dynamic range, and an unmistakable sense of artistry.",
  "isometric-illustration":
    "Create a stunning isometric illustration at a true 30° isometric projection angle with extraordinary attention to detail and visual richness. Use a refined vector style with vibrant, carefully chosen colors that feel premium and modern. Apply a sophisticated color palette (5–8 colors) with beautiful gradients, subtle lighting effects, and gentle color transitions that give depth and dimension — avoid flat, lifeless fills. Add layered soft shadows and ambient occlusion beneath and between objects to create a sense of depth and realism while maintaining the illustrative style. Include micro-details: tiny highlights, subtle textures (gentle noise, fine patterns), and delicate light reflections on surfaces to make the scene feel alive and crafted. Compose the scene with visual storytelling — arrange elements with intentional hierarchy, negative space, and a sense of narrative. Use a soft, complementary background with a subtle gradient or atmospheric glow that enhances the focal objects. The overall aesthetic should feel like a premium Dribbble or Behance showcase piece: elegant, whimsical yet polished, with a warm inviting atmosphere suitable for high-end SaaS product marketing or editorial illustration.",
};

export function registerImageGenerationHandlers() {
  createTypedHandler(
    imageGenerationContracts.generateImage,
    async (_, params) => {
      const settings = readSettings();
      const apiKey = settings.providerSettings?.auto?.apiKey?.value;

      if (!apiKey) {
        throw new DyadError(
          "Dyad Pro API key is required for image generation",
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
