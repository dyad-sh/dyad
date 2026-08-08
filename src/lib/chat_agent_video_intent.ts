import type { VideoFormat } from "@/ipc/types/video_generation";
import { normalizeMediaIntentTypos } from "./media_intent_typos";

/**
 * Recognising "make me a video" in ordinary chat.
 *
 * Generating a video costs real money and takes minutes, so the two mistakes
 * are not equally bad: missing a request is a mild annoyance, while firing on
 * someone who merely *mentioned* video spends their credits and makes them
 * wait. These rules are therefore generous about how a request may be phrased
 * but insist that it actually reads as a request.
 */

const VIDEO_COMMAND = /^\/(video|animate)\b\s*/i;

const VIDEO_VERB =
  /\b(generate|create|make|produce|render|animate|turn|convert|film)\b/i;

const VIDEO_NOUN =
  /\b(video|clip|animation|short|shorts|reel|reels|movie|footage|gif)\b/i;

/**
 * Animating something is inherently asking for motion, so "animate this" needs
 * no accompanying noun. Restricted to instruction shapes: "animate this photo"
 * is a request, "the animation industry" is not.
 */
const ANIMATE_INSTRUCTION =
  /^\s*animate\b|\banimate\s+(this|that|it|the|my|these|those|him|her|them)\b/i;

/**
 * A noun phrase naming the thing being asked for — "a video of…", "a 10 second
 * clip", "another reel". This carries a request on its own, which is what lets
 * a bare "a 30s cinematic clip of a city at night" work.
 */
const VIDEO_NOUN_PHRASE = new RegExp(
  String.raw`\b(?:a|an|the|another|one)\s+` +
    String.raw`(?:\d+\s*(?:s|sec|secs|second|seconds)\s+)?` +
    String.raw`(?:[\w-]+\s+){0,3}?` +
    String.raw`(?:video|clip|animation|short|reel|movie|gif)\b` +
    // The noun has to end the phrase or introduce its subject. Without this,
    // "the animation industry is competitive" reads as an order for a video.
    String.raw`(?=\s+(?:of|showing|featuring|with|where|in|on|at)\b|\s*[,.:;!?]|\s*$)`,
  "i",
);

/**
 * Asking *about* video is not asking *for* one. An explicit verb-and-noun
 * request still wins, so "how do I make a video of a sunset" counts.
 */
const INFORMATIONAL =
  /^\s*(what|why|when|who|which|whose|explain|describe|tell me|do you|are you|is it|does)\b/i;

/** Mentions of a video that already exists, rather than one being asked for. */
const PAST_OR_REPORTED =
  /\b(watched|watching|saw|seen|uploaded|posted|downloaded|found)\b/i;

/** "a 30 second clip", "15s reel", "make it 20 seconds long". */
const DURATION =
  /\b(\d{1,3})\s*(?:s\b|secs?\b|seconds?\b)|\b(\d{1,3})\s*-?\s*second\b/i;

/**
 * The length the user asked for, when they named one. The provider still
 * enforces its own minimum, so this only has to report what was requested.
 */
export function detectRequestedDuration(text: string): number | undefined {
  const match = text.match(DURATION);
  if (!match) return undefined;
  const seconds = Number.parseInt(match[1] ?? match[2] ?? "", 10);
  // Anything longer than a few minutes is a typo, not a request.
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) {
    return undefined;
  }
  return seconds;
}

export type VideoGenerationIntent = {
  prompt: string;
  format: VideoFormat;
  /** Seconds the user asked for, if they said. */
  durationSeconds?: number;
};

export function detectVideoPrompt(text: string): VideoGenerationIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const normalized = normalizeMediaIntentTypos(trimmed);

  // An explicit command is unambiguous and skips every heuristic below.
  const command = normalized.match(VIDEO_COMMAND);
  if (command) {
    const body = trimmed.slice(command[0].length).trim();
    return {
      prompt: body || trimmed,
      format: formatFor(trimmed),
      durationSeconds: detectRequestedDuration(trimmed),
    };
  }

  const hasVerb = VIDEO_VERB.test(normalized);
  const hasNoun = VIDEO_NOUN.test(normalized);
  const explicitRequest = hasVerb && hasNoun;

  // Talking about a video you already have is not a request for a new one.
  if (!explicitRequest && PAST_OR_REPORTED.test(normalized)) return null;
  if (!explicitRequest && INFORMATIONAL.test(normalized)) return null;

  const isRequest =
    explicitRequest ||
    ANIMATE_INSTRUCTION.test(normalized) ||
    (hasNoun && VIDEO_NOUN_PHRASE.test(normalized));

  if (!isRequest) return null;

  return {
    prompt: trimmed,
    format: formatFor(trimmed),
    durationSeconds: detectRequestedDuration(trimmed),
  };
}

function formatFor(text: string): VideoFormat {
  return /\b(instagram|reel|reels)\b/i.test(text)
    ? "instagram_reels"
    : "youtube_shorts";
}
