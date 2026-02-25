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
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";

const logger = log.scope("generate_image");

const generateImageSchema = z.object({
  prompt: z
    .string()
    .describe(
      "A detailed, descriptive prompt for the image to generate. Be specific about colors, composition, style, mood, and subject matter. Avoid generic or vague descriptions.",
    ),
});

const imageDataSchema = z.object({
  url: z.string().nullable().optional(),
  b64_json: z.string().nullable().optional(),
  revised_prompt: z.string().nullable().optional(),
});

const generateImageResponseSchema = z.object({
  created: z.number(),
  data: z.array(imageDataSchema),
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
  ctx: Pick<AgentContext, "dyadRequestId">,
): Promise<z.infer<typeof imageDataSchema>> {
  const response = await engineFetch(ctx, "/images/generations", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      model: "gpt-image-1.5",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Image generation failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = generateImageResponseSchema.parse(await response.json());

  if (!data.data || data.data.length === 0) {
    throw new Error("Image generation returned no results");
  }

  return data.data[0];
}

async function saveGeneratedImage(
  imageData: z.infer<typeof imageDataSchema>,
  appPath: string,
): Promise<string> {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  await fs.mkdir(mediaDir, { recursive: true });

  const hash = crypto.randomBytes(8).toString("hex");
  const timestamp = Date.now();
  const fileName = `generated-${timestamp}-${hash}.png`;
  const filePath = path.join(mediaDir, fileName);
  const relativePath = path.join(DYAD_MEDIA_DIR_NAME, fileName);

  if (imageData.b64_json) {
    const buffer = Buffer.from(imageData.b64_json, "base64");
    await fs.writeFile(filePath, buffer);
  } else if (imageData.url) {
    const response = await fetch(imageData.url);
    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
  } else {
    throw new Error("Image generation returned no image data");
  }

  return relativePath;
}

export const generateImageTool: ToolDefinition<
  z.infer<typeof generateImageSchema>
> = {
  name: "generate_image",
  description: DESCRIPTION,
  inputSchema: generateImageSchema,
  defaultConsent: "ask",
  modifiesState: true,

  isEnabled: (ctx) => ctx.isDyadPro,

  getConsentPreview: (args) => `Generate image: "${args.prompt}"`,

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

      const relativePath = await saveGeneratedImage(imageData, ctx.appPath);

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
