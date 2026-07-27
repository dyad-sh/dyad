import { z } from "zod";
import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  generateImage,
  imageMimeTypeToExtension,
  MAX_GENERATED_IMAGE_SIZE,
} from "@/ipc/pi/image_generation";

const logger = log.scope("generate_image");

const generateImageSchema = z.object({
  prompt: z
    .string()
    .describe(
      "A detailed, descriptive prompt for the image to generate. Be specific about colors, composition, style, mood, and subject matter. Avoid generic or vague descriptions.",
    ),
});

const DESCRIPTION = `Generate an image using AI based on a text prompt. The generated image is saved to the project's .dyad/media directory.

### When to Use
- User requests a custom image, illustration, icon, or graphic for their app
- User wants a hero image, background, banner, or visual asset
- Creating images that are more visually relevant than placeholder rectangles

### Prompt Guidelines
Write detailed, descriptive prompts. Be specific about:
- **Subject**: What is in the image (objects, people, scenes)
- **Style**: Photography, illustration, flat design, 3D render, watercolor, etc.
- **Composition**: Layout, perspective, framing
- **Colors**: Specific color palette or mood
- **Mood**: Cheerful, professional, dramatic, minimal, etc.

### Examples
- "A modern flat illustration of a team collaborating around a laptop, using a blue and purple color palette, clean minimal style with subtle gradients, white background"
- "Professional product photography of a sleek smartphone on a marble surface, soft studio lighting, shallow depth of field, warm neutral tones"

### After Generation
The tool returns the file path in .dyad/media. Use the copy_file tool to copy it to the appropriate location in the project (e.g., public/assets/) and reference that path in your code.
`;

async function saveGeneratedImage(
  imageData: { data: string; mimeType: string },
  appPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const buffer = Buffer.from(imageData.data, "base64");
  if (buffer.byteLength === 0) {
    throw new DyadError(
      "Image generation returned no image data",
      DyadErrorKind.External,
    );
  }
  if (buffer.byteLength > MAX_GENERATED_IMAGE_SIZE) {
    throw new DyadError(
      "Generated image exceeds the maximum allowed size.",
      DyadErrorKind.Validation,
    );
  }

  throwIfImageGenerationCancelled(signal);
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  await fs.mkdir(mediaDir, { recursive: true });
  throwIfImageGenerationCancelled(signal);

  const hash = crypto.randomBytes(8).toString("hex");
  const timestamp = Date.now();
  const extension = imageMimeTypeToExtension(imageData.mimeType);
  const fileName = `generated-${timestamp}-${hash}.${extension}`;
  const filePath = path.join(mediaDir, fileName);
  const tempFilePath = path.join(
    mediaDir,
    `.${fileName}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const relativePath = path.join(DYAD_MEDIA_DIR_NAME, fileName);

  let finalized = false;
  try {
    await fs.writeFile(tempFilePath, buffer, { signal });
    throwIfImageGenerationCancelled(signal);
    await fs.rename(tempFilePath, filePath);
    finalized = true;
    throwIfImageGenerationCancelled(signal);
  } catch (error) {
    const cleanupOperations = [fs.rm(tempFilePath, { force: true })];
    if (finalized && signal?.aborted) {
      cleanupOperations.push(fs.rm(filePath, { force: true }));
    }
    await Promise.allSettled(cleanupOperations);
    throwIfImageGenerationCancelled(signal);
    throw error;
  }

  return relativePath;
}

function throwIfImageGenerationCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DyadError(
      "Image generation cancelled.",
      DyadErrorKind.UserCancelled,
    );
  }
}

export const generateImageTool: ToolDefinition<
  z.infer<typeof generateImageSchema>
> = {
  name: "generate_image",
  description: DESCRIPTION,
  inputSchema: generateImageSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Generate image: "${args.prompt}"`,

  shouldTrackMutation: (_args, result) =>
    result.startsWith("Image generated and saved"),

  buildXml: (args, isComplete) => {
    if (!args.prompt) return undefined;
    if (isComplete) return undefined;
    return `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}">`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing image generation with prompt: ${args.prompt}`);

    ctx.onXmlStream(
      `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}">`,
    );

    try {
      const imageData = await generateImage(args.prompt, ctx.abortSignal);

      const relativePath = await saveGeneratedImage(
        imageData,
        ctx.appPath,
        ctx.abortSignal,
      );

      ctx.onXmlComplete(
        `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}" path="${escapeXmlAttr(relativePath)}">${escapeXmlContent(relativePath)}</dyad-image-generation>`,
      );

      logger.log(`Image generation completed, saved to: ${relativePath}`);

      return `Image generated and saved to: ${relativePath}\nUse the copy_file tool to copy it from "${relativePath}" to the appropriate location in the project (e.g., public/assets/), then reference the copied path in your code.`;
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}"></dyad-image-generation>`,
      );
      throw error;
    }
  },
};
