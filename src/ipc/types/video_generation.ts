import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/** Vertical short-form formats (both 9:16). */
export const VIDEO_FORMATS = ["youtube_shorts", "instagram_reels"] as const;
export const VideoFormatSchema = z.enum(VIDEO_FORMATS);
export type VideoFormat = z.infer<typeof VideoFormatSchema>;

export const VIDEO_FORMAT_META: Record<
  VideoFormat,
  { label: string; aspectRatio: "9:16"; maxDuration: string; hint: string }
> = {
  youtube_shorts: {
    label: "YouTube Shorts",
    aspectRatio: "9:16",
    maxDuration: "10",
    hint: "Punchy vertical hook, fast pacing, bold framing.",
  },
  instagram_reels: {
    label: "Instagram Reels",
    aspectRatio: "9:16",
    maxDuration: "10",
    hint: "Trendy vertical reel, aesthetic, smooth motion.",
  },
};

/**
 * Shortest clip we will ask for. Providers default to 5s, which is too short
 * to be usable as a Short or a Reel, so requests are raised to this floor.
 */
export const MIN_VIDEO_DURATION_SECONDS = 10;

/** The duration to send to the provider, never below the floor. */
export function normalizeVideoDuration(duration?: string | number): string {
  const requested =
    typeof duration === "number" ? duration : Number.parseFloat(duration ?? "");
  if (!Number.isFinite(requested) || requested < MIN_VIDEO_DURATION_SECONDS) {
    return String(MIN_VIDEO_DURATION_SECONDS);
  }
  return String(Math.round(requested));
}

/** Default fal text-to-video model. */
export const DEFAULT_VIDEO_MODEL =
  "fal-ai/kling-video/v1/standard/text-to-video";
/** fal image-to-video (animate a still) model. */
export const IMAGE_TO_VIDEO_MODEL =
  "fal-ai/kling-video/v1/standard/image-to-video";

export const VideoModelSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type VideoModel = z.infer<typeof VideoModelSchema>;

export const VIDEO_MODELS: VideoModel[] = [
  { id: DEFAULT_VIDEO_MODEL, name: "Kling 1.0" },
  { id: "fal-ai/luma-dream-machine", name: "Luma Dream Machine" },
  { id: "fal-ai/minimax/video-01", name: "MiniMax Video 01" },
];

export const GenerateVideoParamsSchema = z.object({
  prompt: z.string(),
  format: VideoFormatSchema,
  model: z.string().optional(),
  /** Optional reference image (data URL) to animate via image-to-video. */
  inputImage: z.string().optional(),
  duration: z.string().optional(),
});
export type GenerateVideoParams = z.infer<typeof GenerateVideoParamsSchema>;

export const GenerateVideoResponseSchema = z.object({
  videoUrl: z.string(),
  model: z.string(),
  format: VideoFormatSchema,
});
export type GenerateVideoResponse = z.infer<typeof GenerateVideoResponseSchema>;

export const VideoStatusSchema = z.object({ connected: z.boolean() });

export const videoGenerationContracts = {
  status: defineContract({
    channel: "video:status",
    input: z.void(),
    output: VideoStatusSchema,
  }),

  connectFal: defineContract({
    channel: "video:connect-fal",
    input: z.object({ apiKey: z.string() }),
    output: VideoStatusSchema,
  }),

  disconnectFal: defineContract({
    channel: "video:disconnect-fal",
    input: z.void(),
    output: VideoStatusSchema,
  }),

  listModels: defineContract({
    channel: "video:list-models",
    input: z.void(),
    output: z.array(VideoModelSchema),
  }),

  generate: defineContract({
    channel: "video:generate",
    input: GenerateVideoParamsSchema,
    output: GenerateVideoResponseSchema,
  }),
} as const;

export const videoGenerationClient = createClient(videoGenerationContracts);
