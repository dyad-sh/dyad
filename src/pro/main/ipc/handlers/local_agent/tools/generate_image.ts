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
import { engineFetch } from "./engine_fetch";
import {
  DYAD_INTERNAL_DIR_NAME,
  DYAD_MEDIA_DIR_NAME,
  getDyadMediaDir,
} from "@/ipc/utils/media_path_utils";
import { ImageGenerationApiResponseSchema } from "@/ipc/types/image_generation";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

import { getOriginalAppPath } from "@/ipc/services/chat_workspace_store";
import { readAppResource } from "@/ipc/services/app_operation_coordinator";
import { runWorkspaceScopedOperation } from "@/ipc/services/workspace_coordination";

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

async function callGenerateImage(
  prompt: string,
  ctx: Pick<AgentContext, "dyadRequestId" | "abortSignal">,
): Promise<z.infer<typeof ImageGenerationApiResponseSchema>["data"][number]> {
  const response = await engineFetch(ctx, "/images/generations", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      model: "dyad/image-gen",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Image generation failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = ImageGenerationApiResponseSchema.parse(await response.json());

  if (!data.data || data.data.length === 0) {
    throw new DyadError(
      "Image generation returned no results",
      DyadErrorKind.External,
    );
  }

  return data.data[0];
}

async function writeImage(
  appPath: string,
  name: string,
  bytes: Buffer,
  signal: AbortSignal | undefined,
): Promise<void> {
  const media = getDyadMediaDir(appPath);
  await fs.mkdir(media, { recursive: true });
  // A concurrent turn mirroring the library must only see complete images.
  const temp = path.join(appPath, DYAD_INTERNAL_DIR_NAME, name + ".tmp");
  try {
    await fs.writeFile(temp, bytes, { flag: "wx", signal });
    await fs.rename(temp, path.join(media, name));
  } finally {
    await fs.rm(temp, { force: true });
  }
}

async function saveGeneratedImage(
  imageData: z.infer<typeof ImageGenerationApiResponseSchema>["data"][number],
  ctx: AgentContext,
): Promise<string> {
  let buffer: Buffer;
  if (imageData.b64_json) {
    buffer = Buffer.from(imageData.b64_json, "base64");
  } else if (imageData.url) {
    const response = await fetch(imageData.url, { signal: ctx.abortSignal });
    if (!response.ok) {
      throw new DyadError(
        `Failed to download generated image: ${response.status}`,
        DyadErrorKind.External,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    throw new DyadError(
      "Image generation returned no image data",
      DyadErrorKind.External,
    );
  }

  return runWorkspaceScopedOperation(
    {
      appId: ctx.appId,
      workspaceKey: ctx.workspaceCoordinationKey,
      operation: "save image generated in chat",
      appResources: [readAppResource("app-path"), "media"],
      workspaceResources:
        ctx.workspaceCoordinationKey === undefined
          ? []
          : ["repository-worktree"],
      signal: ctx.abortSignal,
    },
    async () => {
      // An app may have moved during generation. Resolve the path while claimed.
      const appPath = await getOriginalAppPath(ctx.appId);
      if (!appPath)
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      const name = `generated-${Date.now()}-${crypto.randomBytes(8).toString("hex")}.png`;
      await writeImage(appPath, name, buffer, ctx.abortSignal);
      if (ctx.workspaceCoordinationKey !== undefined) {
        ctx.onMediaSavedToApp?.(name);
        await writeImage(ctx.appPath, name, buffer, ctx.abortSignal);
      }
      return path.join(DYAD_MEDIA_DIR_NAME, name);
    },
  );
}

export const generateImageTool: ToolDefinition<
  z.infer<typeof generateImageSchema>
> = {
  name: "generate_image",
  description: DESCRIPTION,
  inputSchema: generateImageSchema,
  defaultConsent: "always",
  modifiesState: true,
  usesEngineEndpoint: true,

  isEnabled: (ctx) => ctx.isDyadPro,

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
      const imageData = await callGenerateImage(args.prompt, ctx);

      const relativePath = await saveGeneratedImage(imageData, ctx);

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
