import { normalizeMediaIntentTypos } from "./media_intent_typos";

// Explicit command prefixes that always mean "generate an image".
const IMAGE_COMMAND = /^\/(image|img|imagine|draw)\b\s*/i;

// "... image/picture of ..." strongly implies an image request.
const IMAGE_NOUN_OF =
  /\b(image|picture|photo|illustration|drawing|artwork|painting|render|logo|icon|wallpaper|avatar|poster|banner)\s+of\b/i;

// A generation verb paired with an image noun.
const IMAGE_VERB =
  /\b(generate|create|make|render|design|produce|draw|paint|sketch|illustrate)\b/i;
const IMAGE_NOUN =
  /\b(image|images|picture|pictures|photo|photos|photograph|illustration|logo|logos|icon|icons|artwork|drawing|painting|wallpaper|avatar|sticker|poster|banner|graphic|graphics|mockup|thumbnail)\b/i;

/**
 * Detects whether a Chat Agent message is asking to generate an image.
 *
 * Returns the prompt to send to the image model, or `null` when the message is
 * not an image request. Command prefixes (e.g. `/image a red car`) have the
 * prefix stripped; natural-language requests are passed through verbatim.
 */
export function detectImagePrompt(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const normalized = normalizeMediaIntentTypos(trimmed);

  const command = normalized.match(IMAGE_COMMAND);
  if (command) {
    return trimmed.slice(command[0].length).trim() || trimmed;
  }

  if (IMAGE_NOUN_OF.test(normalized)) return trimmed;
  if (IMAGE_VERB.test(normalized) && IMAGE_NOUN.test(normalized))
    return trimmed;

  return null;
}
