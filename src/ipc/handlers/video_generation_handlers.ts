import { fal } from "@fal-ai/client";
import log from "electron-log";

import { readSettings, writeSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { getEnvVar } from "../utils/read_env";
import {
  isBlobConnected,
  isCloudStorageEnabled,
  uploadToBlob,
} from "../utils/vercel_blob";
import {
  DEFAULT_VIDEO_MODEL,
  IMAGE_TO_VIDEO_MODEL,
  normalizeVideoDuration,
  VIDEO_FORMAT_META,
  VIDEO_MODELS,
  videoGenerationContracts,
} from "../types/video_generation";

const logger = log.scope("video_generation_handlers");

/**
 * Video models are slow — minutes, not seconds — but not unbounded. Past this
 * the job is not coming back and the user should be told rather than left
 * watching a spinner.
 */
const VIDEO_GENERATION_TIMEOUT_MS = 10 * 60_000;

class VideoTimeoutError extends Error {}

/** Rejects with VideoTimeoutError if the promise has not settled in time. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new VideoTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer),
  ) as Promise<T>;
}

function getFalKey(): string | undefined {
  const fromSettings =
    readSettings().providerSettings?.fal?.apiKey?.value?.trim();
  return fromSettings || getEnvVar("FAL_KEY") || getEnvVar("FAL_API_KEY");
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!match)
    throw new DyadError("Invalid image data.", DyadErrorKind.External);
  const buffer = Buffer.from(match[2], "base64");
  return new Blob([buffer], { type: match[1] });
}

export function registerVideoGenerationHandlers() {
  createTypedHandler(videoGenerationContracts.status, async () => ({
    connected: Boolean(getFalKey()),
  }));

  createTypedHandler(
    videoGenerationContracts.connectFal,
    async (_, { apiKey }) => {
      const key = apiKey.trim();
      if (!key) {
        throw new DyadError(
          "A fal API key is required.",
          DyadErrorKind.External,
        );
      }
      const settings = readSettings();
      writeSettings({
        providerSettings: {
          ...settings.providerSettings,
          fal: { apiKey: { value: key } },
        },
      });
      logger.log("Connected fal for video generation");
      return { connected: true };
    },
  );

  createTypedHandler(videoGenerationContracts.disconnectFal, async () => {
    const settings = readSettings();
    const providerSettings = { ...settings.providerSettings };
    delete providerSettings.fal;
    writeSettings({ providerSettings });
    logger.log("Disconnected fal");
    return { connected: false };
  });

  createTypedHandler(
    videoGenerationContracts.listModels,
    async () => VIDEO_MODELS,
  );

  createTypedHandler(videoGenerationContracts.generate, async (_, params) => {
    const key = getFalKey();
    if (!key) {
      throw new DyadError(
        "Connect fal to generate videos — add your fal API key.",
        DyadErrorKind.External,
      );
    }
    fal.config({ credentials: key });

    const meta = VIDEO_FORMAT_META[params.format];
    const duration = normalizeVideoDuration(params.duration);
    const useImage = Boolean(params.inputImage);
    const model = useImage
      ? IMAGE_TO_VIDEO_MODEL
      : params.model || DEFAULT_VIDEO_MODEL;

    // Bias the prompt toward the chosen short-form style.
    const prompt = `${params.prompt.trim()} — ${meta.hint}`;

    const input: Record<string, unknown> = { prompt, duration };
    if (useImage && params.inputImage) {
      try {
        const imageUrl = await fal.storage.upload(
          dataUrlToBlob(params.inputImage),
        );
        input.image_url = imageUrl;
      } catch (e) {
        throw new DyadError(
          `Could not upload the reference image to fal: ${
            e instanceof Error ? e.message : String(e)
          }`,
          DyadErrorKind.External,
        );
      }
    } else {
      // Vertical 9:16 for both YouTube Shorts and Instagram Reels.
      input.aspect_ratio = meta.aspectRatio;
    }

    let lastQueueStatus: string | undefined;
    let result: { data?: unknown };
    try {
      // fal.subscribe waits on a queued job and, left alone, waits forever: a
      // job that never leaves the queue used to leave the UI saying "this can
      // take a few minutes" indefinitely. Bound it, and report queue movement
      // so a slow job is distinguishable from a stuck one.
      result = await withTimeout(
        fal.subscribe(model, {
          input,
          logs: false,
          onQueueUpdate: (update) => {
            const status = (update as { status?: string })?.status;
            if (status && status !== lastQueueStatus) {
              lastQueueStatus = status;
              logger.log(`fal video ${model}: ${status}`);
            }
          },
        }),
        VIDEO_GENERATION_TIMEOUT_MS,
      );
    } catch (e) {
      if (e instanceof VideoTimeoutError) {
        logger.error(
          `fal video generation timed out after ${
            VIDEO_GENERATION_TIMEOUT_MS / 60_000
          } minutes (${model}), last status: ${lastQueueStatus ?? "none"}`,
        );
        throw new DyadError(
          `Video generation timed out after ${
            VIDEO_GENERATION_TIMEOUT_MS / 60_000
          } minutes. The job may still be running on fal — check your fal dashboard before retrying so you are not billed twice.`,
          DyadErrorKind.External,
        );
      }
      logger.error(`fal video generation failed (${model}):`, e);
      throw new DyadError(
        `Video generation failed — ${
          e instanceof Error ? e.message : String(e)
        }`,
        DyadErrorKind.External,
      );
    }

    const data = result.data as { video?: { url?: string } } | undefined;
    const videoUrl = data?.video?.url;
    if (!videoUrl) {
      throw new DyadError(
        "fal did not return a video URL.",
        DyadErrorKind.External,
      );
    }

    // Best-effort: persist the video to Meta HD (Vercel Blob).
    if (isCloudStorageEnabled() && isBlobConnected()) {
      try {
        const resp = await fetch(videoUrl);
        const buffer = Buffer.from(await resp.arrayBuffer());
        const safe =
          params.prompt
            .slice(0, 40)
            .replace(/[^a-zA-Z0-9]+/g, "_")
            .replace(/^_|_$/g, "")
            .toLowerCase() || "video";
        await uploadToBlob(
          `videos/${params.format}_${safe}_${Date.now()}.mp4`,
          buffer,
          { contentType: "video/mp4", addRandomSuffix: true },
        );
      } catch (e) {
        logger.error("Failed to back up video to Vercel Blob:", e);
      }
    }

    return { videoUrl, model, format: params.format };
  });
}
