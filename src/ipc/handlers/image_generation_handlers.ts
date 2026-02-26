import { createTypedHandler } from "./base";
import {
  imageGenerationContracts,
  type ImageThemeMode,
} from "../types/image_generation";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { readSettings } from "../../main/settings";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

const logger = log.scope("image_generation_handlers");

const DYAD_ENGINE_URL =
  process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";

const IMAGE_GENERATION_TIMEOUT_MS = 120_000;

const THEME_SYSTEM_PROMPTS: Record<ImageThemeMode, string | null> = {
  plain: null,
  "3d-clay":
    "Render in a 3D claymorphism style. All subjects must look sculpted from smooth, matte clay with a subtle subsurface-scattering sheen. Use soft, diffused studio lighting with gentle ambient occlusion and contact shadows only — no hard cast shadows. Edges should be heavily rounded and beveled; proportions should be slightly inflated and cartoonish. Limit the palette to 4–6 harmonious pastel or muted tones per image. Backgrounds should be a simple seamless gradient or solid color so the clay subjects stand out. The final render should feel like a high-quality Blender/Cinema 4D product shot: tactile, toy-like, warm, and approachable.",
  "real-photography":
    "Produce a photorealistic image indistinguishable from a high-end DSLR photograph. Simulate natural or studio lighting with accurate specular highlights, soft falloff, and physically correct shadows. Render realistic material textures (skin pores, fabric weave, metal reflections). Apply a shallow depth of field (f/1.8–f/2.8) with natural bokeh for portraits, or a wider aperture for landscapes. Use the rule of thirds for composition. Color grading should be subtle and true-to-life — no oversaturation or HDR artifacts. Include fine details like subtle lens vignetting and natural grain at ISO 200–400. The image should look like it was shot on a full-frame camera with a prime lens.",
  "isometric-illustration":
    "Create a crisp isometric illustration at a true 30° isometric projection angle. Use a flat-to-semi-flat vector style with bold, saturated colors and clean hard edges — no photorealism. Apply a limited, cohesive color palette (5–7 colors) with flat fills and minimal gradients. Add short, uniform drop shadows (offset 4–8 px at 45°) beneath objects to ground them on a clean white or light neutral background. Keep line weights consistent throughout. The style should be polished and minimal, suitable for SaaS product marketing, landing page hero images, or UI spot illustrations. No outlines unless they reinforce clarity.",
};

export function registerImageGenerationHandlers() {
  createTypedHandler(
    imageGenerationContracts.generateImage,
    async (_, params) => {
      const settings = readSettings();
      const apiKey = settings.providerSettings?.auto?.apiKey?.value;

      if (!apiKey) {
        throw new Error("Dyad Pro API key is required for image generation");
      }

      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.targetAppId),
      });
      if (!app) {
        throw new Error("Target app not found");
      }

      const systemPrompt = THEME_SYSTEM_PROMPTS[params.themeMode];
      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${params.prompt}`
        : params.prompt;

      const requestId = `image-gen-${uuidv4()}`;
      const controller = new AbortController();
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
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Image generation timed out. Please try again.");
        }
        throw new Error("Failed to connect to image generation service.");
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Image generation failed: ${response.status} - ${errorText}`,
        );
      }

      const data = await response.json();
      const imageData = data.data?.[0];

      if (!imageData) {
        throw new Error("No image data returned from generation service");
      }

      // Save to app's media folder
      const appPath = getDyadAppPath(app.path);
      const mediaDir = path.join(appPath, ".dyad", "media");
      fs.mkdirSync(mediaDir, { recursive: true });

      const timestamp = Date.now();
      const sanitizedPrompt = params.prompt
        .slice(0, 30)
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .toLowerCase();
      const fileName = `generated_${sanitizedPrompt}_${timestamp}.png`;
      const filePath = path.join(mediaDir, fileName);

      if (imageData.b64_json) {
        const buffer = Buffer.from(imageData.b64_json, "base64");
        fs.writeFileSync(filePath, buffer);
      } else if (imageData.url) {
        const imgResponse = await fetch(imageData.url);
        const arrayBuffer = await imgResponse.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      } else {
        throw new Error("Unexpected image response format");
      }

      logger.log(`Generated image saved: ${filePath}`);

      return {
        fileName,
        filePath,
        appId: app.id,
        appName: app.name,
      };
    },
  );
}
