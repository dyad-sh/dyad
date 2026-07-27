import { readFile } from "node:fs/promises";
import path from "node:path";

import { streamText, TextPart, ImagePart, ModelMessage } from "ai";
import log from "electron-log";

import type { UserSettings } from "@/lib/schemas";
import {
  getInlineImageMimeType,
  isInlineImageAttachment,
  type StoredChatAttachment,
} from "@/ipc/utils/chat_attachment_utils";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { getEnvVar } from "@/ipc/utils/read_env";
import { cancelOrphanedBaseStream } from "@/ipc/utils/stream_text_utils";
import { getLanguageModelProviders } from "@/ipc/shared/language_model_helpers";
import { resolveBuiltinModelAlias } from "@/ipc/shared/remote_language_model_catalog";

const logger = log.scope("vision_fallback");

/**
 * Aliases tried in order. `dyad/vision/default` is the dedicated alias; the
 * theme-generator aliases are a backstop for users who have an Anthropic or
 * OpenAI key but no Google key. All four resolve to vision-capable models.
 */
const VISION_FALLBACK_ALIASES = [
  "dyad/vision/default",
  "dyad/theme-generator/google",
  "dyad/theme-generator/anthropic",
  "dyad/theme-generator/openai",
] as const;

const DESCRIBE_IMAGE_SYSTEM_PROMPT = `You are describing images for a coding assistant that cannot see images.
Describe each image precisely and completely enough that the assistant can act on it without seeing it.
For UI screenshots and mockups: describe layout, hierarchy, components, spacing, colors and copy.
For diagrams: describe every node, label and edge.
For screenshots of code or errors: transcribe the visible text verbatim.
Do not speculate. Do not offer advice. Output the description only.`;

const MAX_DESCRIBED_IMAGES = 4;

/**
 * Wall-clock bound on the describer call. `maxRetries` bounds retries, not time,
 * and this call blocks the user's turn behind an empty assistant placeholder —
 * degrading to VISION_UNAVAILABLE_NOTE beats hanging the chat.
 */
const VISION_DESCRIBE_TIMEOUT_MS = 60_000;

const IMAGE_DESCRIPTION_CLOSING_TAG = "</dyad-image-description>";

/** Case- and whitespace-insensitive */
const IMAGE_DESCRIPTION_CLOSING_TAG_PATTERN =
  /<\s*\/\s*dyad-image-description\s*>/gi;

/**
 * Inline images the user attached for the model to look at.
 */
export function selectDescribableImages(
  attachments: StoredChatAttachment[],
): StoredChatAttachment[] {
  return attachments.filter(
    (attachment) =>
      isInlineImageAttachment(attachment) &&
      attachment.attachmentType === "chat-context",
  );
}

/**
 * Resolve the first vision-capable builtin alias the user can actually call.
 *
 * Returns null when no alias resolves or none of the resolved providers have a
 * usable API key.
 */
export async function resolveVisionFallbackModel(
  settings: UserSettings,
): Promise<{ providerId: string; apiName: string } | null> {
  // Dyad Pro routes every provider through the gateway with a single key.
  const dyadProKey = settings.enableDyadPro
    ? settings.providerSettings?.auto?.apiKey?.value
    : undefined;
  // Only needed for the per-provider key lookup below, which Dyad Pro skips.
  const providers = dyadProKey ? [] : await getLanguageModelProviders();

  for (const alias of VISION_FALLBACK_ALIASES) {
    const resolved = await resolveBuiltinModelAlias(alias);
    if (!resolved) {
      continue;
    }
    if (dyadProKey) {
      return resolved;
    }

    const providerInfo = providers.find((p) => p.id === resolved.providerId);
    const apiKey =
      settings.providerSettings?.[resolved.providerId]?.apiKey?.value ||
      (providerInfo?.envVarName
        ? getEnvVar(providerInfo.envVarName)
        : undefined);
    if (apiKey) {
      return resolved;
    }
  }
  return null;
}

/**
 * Describe inline image attachments using a vision-capable model.
 *
 * Returns a text block to append to the user message, or null when no
 * description could be produced.
 */
export async function describeImageAttachments({
  attachments,
  settings,
  abortSignal,
}: {
  attachments: StoredChatAttachment[];
  settings: UserSettings;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  // The describer can be a model from a provider the user did not select for
  // this chat, so their images reach an additional third party. On by default
  // (the alternative is a hard provider error), but opt-out.
  if (settings.enableVisionFallback === false) {
    logger.info("Vision fallback is disabled in settings");
    return null;
  }

  const images = selectDescribableImages(attachments);
  if (images.length === 0) {
    return null;
  }

  const fallbackModel = await resolveVisionFallbackModel(settings);
  if (!fallbackModel) {
    logger.warn("No vision-capable fallback model could be resolved");
    return null;
  }

  logger.info(
    `Describing ${images.length} image(s) with ${fallbackModel.providerId}/${fallbackModel.apiName}`,
  );

  try {
    const { modelClient } = await getModelClient(
      { provider: fallbackModel.providerId, name: fallbackModel.apiName },
      settings,
    );

    const described = images.slice(0, MAX_DESCRIBED_IMAGES);
    const contentParts: (TextPart | ImagePart)[] = [
      {
        type: "text",
        text: `Describe the following ${described.length} image(s). Prefix each description with its file name.`,
      },
    ];

    for (const attachment of described) {
      // Non-null: selectDescribableImages already filtered on this same lookup.
      const mediaType = getInlineImageMimeType(attachment.filePath)!;
      const imageBuffer = await readFile(attachment.filePath);
      contentParts.push({
        type: "text",
        text: path.basename(attachment.filePath),
      });
      contentParts.push({
        type: "image",
        image: imageBuffer.toString("base64"),
        mediaType,
      });
    }

    const timeoutSignal = AbortSignal.timeout(VISION_DESCRIBE_TIMEOUT_MS);
    const stream = streamText({
      model: modelClient.model,
      system: DESCRIBE_IMAGE_SYSTEM_PROMPT,
      maxRetries: 1,
      messages: [{ role: "user", content: contentParts }],
      abortSignal: abortSignal
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal,
    });

    const textStream = stream.textStream;
    cancelOrphanedBaseStream(stream);
    let description = "";
    for await (const chunk of textStream) {
      description += chunk;
    }

    if (!description.trim()) {
      logger.warn("Vision fallback returned an empty description");
      return null;
    }

    const truncatedNote =
      images.length > described.length
        ? `\n\n(Only the first ${described.length} of ${images.length} images were described.)`
        : "";

    // The describer transcribes image text verbatim, so an image containing the
    // closing tag would let its contents escape the block and read as
    // instructions. Drop the delimiter rather than the description.
    const safeDescription = description
      .trim()
      .replace(IMAGE_DESCRIPTION_CLOSING_TAG_PATTERN, "");

    return `\n\n<dyad-image-description>
The selected model cannot read images, so the attached image(s) were described by a vision-capable model (${fallbackModel.providerId}):

${safeDescription}${truncatedNote}
${IMAGE_DESCRIPTION_CLOSING_TAG}\n`;
  } catch (error) {
    logger.error("Vision fallback description failed", error);
    return null;
  }
}

export const IMAGE_OMITTED_NOTE =
  "[image omitted: the selected model cannot read images]";

/**
 * Drop image parts from an already-built message history.
 *
 * The attachment-delivery gate only covers the turn the image was attached on.
 * Local-agent modes rebuild history from `aiMessagesJson`, which replays image
 * parts from earlier turns, so a chat that once used a vision model keeps
 * failing after switching to a text-only one — restarting the app does not
 * help, because the parts live in the DB.
 */
export function stripImageParts(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }
    const content = message.content.filter((part) => part.type !== "image");
    if (content.length === message.content.length) {
      return message;
    }
    // Providers reject a message with empty content, so leave a marker behind.
    return {
      ...message,
      content:
        content.length > 0
          ? content
          : [{ type: "text", text: IMAGE_OMITTED_NOTE }],
    } as ModelMessage;
  });
}

/**
 * Injected when the user turned the fallback off. Distinct from
 * VISION_UNAVAILABLE_NOTE: this is a choice, not a missing capability, so the
 * model must not push them toward another model over it.
 */
export const VISION_DISABLED_NOTE = `\n\n<dyad-image-description>
The user attached one or more images. The selected model cannot read images, and describing
images with a vision-capable model is turned off in Settings, so the images were omitted.
Answer using the text of the request. Do not ask the user to switch models; if you genuinely
cannot proceed without seeing the image, say so and mention they can re-enable
"Describe images for text-only models" in Settings.
</dyad-image-description>\n`;

/** Injected when images are attached but no description could be produced. */
export const VISION_UNAVAILABLE_NOTE = `\n\n<dyad-image-description>
The user attached one or more images, but the selected model cannot read images and no vision-capable model is available to describe them. Tell the user to switch to a vision-capable model (for example Gemini, Claude or GPT-5) or to describe the image in text.
</dyad-image-description>\n`;
