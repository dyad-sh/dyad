import { ipcMain, shell, dialog, app } from "electron";
import { db } from "@/db";
import { videoStudioVideos, imageStudioImages } from "@/db/schema";
import { readSettings } from "@/main/settings";
import { desc, eq, like, or } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { getModelClient } from "@/ipc/utils/get_model_client";

// ── Types ──────────────────────────────────────────────────────────────────────

interface GenerateVideoParams {
  provider: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  duration?: number;
  fps?: number;
  seed?: string;
  style?: string;
  sourceType?: string;
  referenceImageBase64?: string;
  referenceVideoId?: number;
  strength?: number;
  motionAmount?: number;
}

interface ListVideosParams {
  limit?: number;
  offset?: number;
  search?: string;
  provider?: string;
}

interface ExtractFramesParams {
  videoId: number;
  count?: number;
}

// ── Storage Directory ──────────────────────────────────────────────────────────

function getVideoStoreDir(): string {
  const dir = path.join(app.getPath("userData"), "video-studio");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getApiKey(providerName: string): string {
  const settings = readSettings();
  const prov = settings.providerSettings[providerName];
  const key = prov?.apiKey?.value;
  if (!key) throw new Error(`No API key configured for provider: ${providerName}`);
  return key;
}

// ── Video Saving Utility ───────────────────────────────────────────────────────

async function saveBinaryVideo(data: Buffer, filename: string): Promise<string> {
  const dir = getVideoStoreDir();
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, data);
  return filePath;
}

function uniqueVideoFilename(provider: string, ext = "mp4"): string {
  return `${provider}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
}

async function saveThumbnailFromUrl(videoUrl: string, provider: string): Promise<string | null> {
  // For providers that return a thumbnail URL along with video, we save it.
  // Otherwise we return null and the client-side player generates the thumb.
  try {
    const dir = getVideoStoreDir();
    const thumbFilename = `thumb_${provider}_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    const thumbPath = path.join(dir, thumbFilename);
    // Fetch first frame from the video URL as an image if available
    // For now, return null — thumbnails generated client-side
    void videoUrl;
    void thumbPath;
    return null;
  } catch {
    return null;
  }
}

// ── Provider Implementations ───────────────────────────────────────────────────

async function generateWithRunway(params: GenerateVideoParams): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const apiKey = getApiKey("runway");

  const body: Record<string, unknown> = {
    model: params.model || "gen3a_turbo",
    promptText: params.prompt,
    duration: params.duration ?? 5,
    ratio: `${params.width}:${params.height}`,
  };

  if (params.referenceImageBase64) {
    body.promptImage = params.referenceImageBase64.startsWith("data:")
      ? params.referenceImageBase64
      : `data:image/png;base64,${params.referenceImageBase64}`;
  }

  if (params.seed) body.seed = parseInt(params.seed, 10);

  const res = await fetch("https://api.runwayml.com/v1/image_to_video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Runway error: ${err}`);
  }

  const { id } = await res.json();

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`https://api.runwayml.com/v1/tasks/${id}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-11-06",
      },
    });
    const task = await pollRes.json();
    if (task.status === "SUCCEEDED") {
      const videoUrl = task.output?.[0];
      if (!videoUrl) throw new Error("Runway succeeded but no output URL");
      const videoRes = await fetch(videoUrl);
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      const filePath = await saveBinaryVideo(buffer, uniqueVideoFilename("runway"));
      const thumbnailPath = await saveThumbnailFromUrl(videoUrl, "runway");
      return { filePath, thumbnailPath };
    }
    if (task.status === "FAILED") {
      throw new Error(`Runway task failed: ${task.failure}`);
    }
  }

  throw new Error("Runway task timed out after 360 seconds");
}

async function generateWithFal(params: GenerateVideoParams): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const apiKey = getApiKey("fal");
  const model = params.model || "fal-ai/kling-video/v2/master/text-to-video";

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    duration: `${params.duration ?? 5}`,
    aspect_ratio: `${params.width}:${params.height}`,
  };

  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;

  if (params.referenceImageBase64) {
    body.image_url = params.referenceImageBase64.startsWith("data:")
      ? params.referenceImageBase64
      : `data:image/png;base64,${params.referenceImageBase64}`;
  }

  if (params.seed) body.seed = parseInt(params.seed, 10);

  const submitRes = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`Fal.ai submit error: ${err}`);
  }

  const { request_id, status_url } = await submitRes.json();
  const pollBase = status_url || `https://queue.fal.run/${model}/requests/${request_id}`;

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`${pollBase}/status`, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    const status = await pollRes.json();
    if (status.status === "COMPLETED") {
      const resultRes = await fetch(pollBase, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      const result = await resultRes.json();
      const videoUrl = result.video?.url;
      if (!videoUrl) throw new Error("Fal.ai completed but no video URL");
      const videoRes = await fetch(videoUrl);
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      const filePath = await saveBinaryVideo(buffer, uniqueVideoFilename("fal"));
      const thumbnailPath = await saveThumbnailFromUrl(videoUrl, "fal");
      return { filePath, thumbnailPath };
    }
    if (status.status === "FAILED") {
      throw new Error(`Fal.ai job failed: ${JSON.stringify(status.error)}`);
    }
  }

  throw new Error("Fal.ai job timed out after 360 seconds");
}

async function generateWithReplicate(params: GenerateVideoParams): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const apiKey = getApiKey("replicate");
  const modelVersion = params.model || "cjwbw/cogvideox-5b:latest";

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    num_frames: Math.round((params.duration ?? 5) * (params.fps ?? 24)),
    width: params.width,
    height: params.height,
    fps: params.fps ?? 24,
  };

  if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
  if (params.seed) input.seed = parseInt(params.seed, 10);

  if (params.referenceImageBase64) {
    input.image = params.referenceImageBase64.startsWith("data:")
      ? params.referenceImageBase64
      : `data:image/png;base64,${params.referenceImageBase64}`;
    input.strength = params.strength ?? 0.75;
  }

  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: modelVersion,
      input,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Replicate create error: ${err}`);
  }

  const prediction = await createRes.json();
  const pollUrl = prediction.urls?.get;
  if (!pollUrl) throw new Error("Replicate returned no poll URL");

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const status = await pollRes.json();
    if (status.status === "succeeded") {
      const videoUrl = Array.isArray(status.output) ? status.output[0] : status.output;
      if (!videoUrl) throw new Error("Replicate succeeded but no output URL");
      const videoRes = await fetch(videoUrl);
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      const filePath = await saveBinaryVideo(buffer, uniqueVideoFilename("replicate"));
      const thumbnailPath = await saveThumbnailFromUrl(videoUrl, "replicate");
      return { filePath, thumbnailPath };
    }
    if (status.status === "failed") {
      throw new Error(`Replicate job failed: ${status.error}`);
    }
  }

  throw new Error("Replicate job timed out after 360 seconds");
}

async function generateWithLuma(params: GenerateVideoParams): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const apiKey = getApiKey("luma");

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model: params.model || "ray2",
    resolution: params.width >= 1920 ? "1080p" : params.width >= 1280 ? "720p" : "540p",
    duration: `${params.duration ?? 5}s`,
  };

  if (params.referenceImageBase64) {
    body.keyframes = {
      frame0: {
        type: "image",
        url: params.referenceImageBase64.startsWith("data:")
          ? params.referenceImageBase64
          : `data:image/png;base64,${params.referenceImageBase64}`,
      },
    };
  }

  // Extend from existing video
  if (params.sourceType === "extend" && params.referenceVideoId) {
    const existing = await db
      .select()
      .from(videoStudioVideos)
      .where(eq(videoStudioVideos.id, params.referenceVideoId))
      .limit(1);
    if (existing[0]) {
      const videoData = fs.readFileSync(existing[0].filePath);
      const b64 = videoData.toString("base64");
      body.keyframes = {
        frame0: {
          type: "video",
          url: `data:video/mp4;base64,${b64}`,
        },
      };
    }
  }

  const res = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Luma AI error: ${err}`);
  }

  const { id } = await res.json();

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const gen = await pollRes.json();
    if (gen.state === "completed") {
      const videoUrl = gen.assets?.video;
      if (!videoUrl) throw new Error("Luma completed but no video URL");
      const videoRes = await fetch(videoUrl);
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      const filePath = await saveBinaryVideo(buffer, uniqueVideoFilename("luma"));
      const thumbUrl = gen.assets?.thumbnail;
      let thumbnailPath: string | null = null;
      if (thumbUrl) {
        const thumbRes = await fetch(thumbUrl);
        const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
        const thumbFile = `thumb_luma_${Date.now()}.jpg`;
        const dir = getVideoStoreDir();
        thumbnailPath = path.join(dir, thumbFile);
        fs.writeFileSync(thumbnailPath, thumbBuf);
      }
      return { filePath, thumbnailPath };
    }
    if (gen.state === "failed") {
      throw new Error(`Luma generation failed: ${gen.failure_reason}`);
    }
  }

  throw new Error("Luma generation timed out after 360 seconds");
}

async function generateWithStabilityAI(params: GenerateVideoParams): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const apiKey = getApiKey("stabilityai");

  if (!params.referenceImageBase64) {
    throw new Error("Stability AI video generation requires a reference image (image-to-video only)");
  }

  // Convert base64 to blob for FormData
  const base64Data = params.referenceImageBase64.replace(/^data:image\/\w+;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, "base64");
  const blob = new Blob([imageBuffer], { type: "image/png" });

  const formData = new FormData();
  formData.append("image", blob, "reference.png");
  formData.append("seed", params.seed ?? "0");
  formData.append("cfg_scale", "2.5");
  formData.append("motion_bucket_id", String(params.motionAmount ?? 127));

  const res = await fetch("https://api.stability.ai/v2beta/image-to-video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stability AI error: ${err}`);
  }

  const { id } = await res.json();

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`https://api.stability.ai/v2beta/image-to-video/result/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "video/*" },
    });

    if (pollRes.status === 200) {
      const buffer = Buffer.from(await pollRes.arrayBuffer());
      const filePath = await saveBinaryVideo(buffer, uniqueVideoFilename("stabilityai"));
      return { filePath, thumbnailPath: null };
    }
    if (pollRes.status !== 202) {
      const err = await pollRes.text();
      throw new Error(`Stability AI poll error: ${err}`);
    }
  }

  throw new Error("Stability AI video generation timed out after 360 seconds");
}

async function generateWithGoogleVeo(params: GenerateVideoParams): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const apiKey = getApiKey("google");
  const model = params.model || "veo-002";

  const instance: Record<string, unknown> = {
    prompt: params.prompt,
  };

  if (params.referenceImageBase64) {
    const base64Data = params.referenceImageBase64.replace(/^data:image\/\w+;base64,/, "");
    instance.image = { bytesBase64Encoded: base64Data };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [instance],
        parameters: {
          aspectRatio: `${params.width}:${params.height}`,
          durationSeconds: params.duration ?? 5,
          personGeneration: "allow_adult",
        },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Veo error: ${err}`);
  }

  const { name } = await res.json();
  if (!name) throw new Error("Google Veo returned no operation name");

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}?key=${apiKey}`,
    );
    const op = await pollRes.json();
    if (op.done) {
      const videoUri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) throw new Error("Google Veo completed but no video URI");
      const videoRes = await fetch(`${videoUri}&key=${apiKey}`);
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      const filePath = await saveBinaryVideo(buffer, uniqueVideoFilename("google"));
      return { filePath, thumbnailPath: null };
    }
    if (op.error) {
      throw new Error(`Google Veo failed: ${op.error.message}`);
    }
  }

  throw new Error("Google Veo timed out after 600 seconds");
}

async function generateWithOpenAI(params: GenerateVideoParams): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const apiKey = getApiKey("openai");

  const body: Record<string, unknown> = {
    model: params.model || "sora",
    prompt: params.prompt,
    n: 1,
    size: `${params.width}x${params.height}`,
    duration: params.duration ?? 5,
  };

  if (params.referenceImageBase64) {
    body.image = params.referenceImageBase64.startsWith("data:")
      ? params.referenceImageBase64
      : `data:image/png;base64,${params.referenceImageBase64}`;
  }

  if (params.style) body.style = params.style;

  const res = await fetch("https://api.openai.com/v1/videos/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Sora error: ${err}`);
  }

  const result = await res.json();

  // Sora may return a direct URL or require polling
  let videoUrl = result.data?.[0]?.url;
  if (!videoUrl && result.id) {
    // Poll for completion
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const pollRes = await fetch(`https://api.openai.com/v1/videos/generations/${result.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const pollData = await pollRes.json();
      if (pollData.status === "succeeded") {
        videoUrl = pollData.data?.[0]?.url;
        break;
      }
      if (pollData.status === "failed") {
        throw new Error(`OpenAI Sora generation failed: ${pollData.error?.message ?? "Unknown error"}`);
      }
    }
  }

  if (!videoUrl) throw new Error("OpenAI Sora returned no video URL");

  const videoRes = await fetch(videoUrl);
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  const filePath = await saveBinaryVideo(buffer, uniqueVideoFilename("openai"));
  return { filePath, thumbnailPath: null };
}

// ── Provider Dispatch ──────────────────────────────────────────────────────────

async function dispatchGenerate(params: GenerateVideoParams): Promise<{ filePath: string; thumbnailPath: string | null }> {
  switch (params.provider) {
    case "runway":
      return generateWithRunway(params);
    case "fal":
      return generateWithFal(params);
    case "replicate":
      return generateWithReplicate(params);
    case "luma":
      return generateWithLuma(params);
    case "stabilityai":
      return generateWithStabilityAI(params);
    case "google":
      return generateWithGoogleVeo(params);
    case "openai":
      return generateWithOpenAI(params);
    default:
      throw new Error(`Unsupported video provider: ${params.provider}`);
  }
}

// ── Provider Catalog ───────────────────────────────────────────────────────────

interface ProviderModel {
  id: string;
  label: string;
  supportsImg2Video?: boolean;
  supportsVideoExtend?: boolean;
  supportsVideo2Video?: boolean;
  maxDurationSeconds?: number;
  defaultFps?: number;
}

function getProviderCatalog(): Record<string, { label: string; models: ProviderModel[] }> {
  return {
    runway: {
      label: "Runway",
      models: [
        { id: "gen3a_turbo", label: "Gen-3 Alpha Turbo", supportsImg2Video: true, maxDurationSeconds: 10, defaultFps: 24 },
        { id: "gen4_turbo", label: "Gen-4 Turbo", supportsImg2Video: true, maxDurationSeconds: 10, defaultFps: 24 },
      ],
    },
    fal: {
      label: "Fal.ai",
      models: [
        { id: "fal-ai/kling-video/v2/master/text-to-video", label: "Kling v2 (Text)", maxDurationSeconds: 10, defaultFps: 24 },
        { id: "fal-ai/kling-video/v2/master/image-to-video", label: "Kling v2 (Image)", supportsImg2Video: true, maxDurationSeconds: 10, defaultFps: 24 },
        { id: "fal-ai/minimax-video/video-01-live", label: "Minimax Video-01 Live", maxDurationSeconds: 6, defaultFps: 24 },
        { id: "fal-ai/minimax-video/video-01", label: "Minimax Video-01", maxDurationSeconds: 6, defaultFps: 24 },
        { id: "fal-ai/cogvideox-5b", label: "CogVideoX 5B", maxDurationSeconds: 6, defaultFps: 16 },
        { id: "fal-ai/hunyuan-video", label: "HunyuanVideo", maxDurationSeconds: 5, defaultFps: 24 },
      ],
    },
    replicate: {
      label: "Replicate",
      models: [
        { id: "cjwbw/cogvideox-5b:latest", label: "CogVideoX 5B", maxDurationSeconds: 6, defaultFps: 16 },
        { id: "stability-ai/stable-video-diffusion:latest", label: "Stable Video Diffusion", supportsImg2Video: true, maxDurationSeconds: 4, defaultFps: 14 },
        { id: "tencent/hunyuan-video:latest", label: "HunyuanVideo", maxDurationSeconds: 5, defaultFps: 24 },
      ],
    },
    luma: {
      label: "Luma AI",
      models: [
        { id: "ray2", label: "Ray 2", supportsImg2Video: true, supportsVideoExtend: true, maxDurationSeconds: 9, defaultFps: 24 },
        { id: "ray2-flash", label: "Ray 2 Flash", supportsImg2Video: true, supportsVideoExtend: true, maxDurationSeconds: 9, defaultFps: 24 },
      ],
    },
    stabilityai: {
      label: "Stability AI",
      models: [
        { id: "svd", label: "Stable Video Diffusion", supportsImg2Video: true, maxDurationSeconds: 4, defaultFps: 14 },
        { id: "svd-xt", label: "SVD-XT (Extended)", supportsImg2Video: true, maxDurationSeconds: 4, defaultFps: 14 },
      ],
    },
    google: {
      label: "Google Veo",
      models: [
        { id: "veo-002", label: "Veo 2", supportsImg2Video: true, maxDurationSeconds: 8, defaultFps: 24 },
        { id: "veo-003", label: "Veo 3", supportsImg2Video: true, maxDurationSeconds: 8, defaultFps: 24 },
      ],
    },
    openai: {
      label: "OpenAI Sora",
      models: [
        { id: "sora", label: "Sora", supportsImg2Video: true, maxDurationSeconds: 20, defaultFps: 24 },
      ],
    },
  };
}

// ── Handler Registration ───────────────────────────────────────────────────────

export function registerVideoStudioHandlers() {
  // ── Generate ─────────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:generate", async (_, params: GenerateVideoParams) => {
    if (!params.prompt?.trim()) throw new Error("Prompt is required");
    if (!params.provider) throw new Error("Provider is required");

    const sourceType = params.sourceType ?? "text-to-video";

    const { filePath, thumbnailPath } = await dispatchGenerate(params);

    const [row] = await db
      .insert(videoStudioVideos)
      .values({
        prompt: params.prompt.trim(),
        negativePrompt: params.negativePrompt?.trim() || null,
        provider: params.provider,
        model: params.model || "",
        width: params.width,
        height: params.height,
        duration: params.duration ?? 5,
        fps: params.fps ?? 24,
        format: "mp4",
        filePath,
        thumbnailPath,
        seed: params.seed || null,
        style: params.style || null,
        sourceType,
        sourceId: params.referenceVideoId ?? null,
        metadata: {
          strength: params.strength,
          motionAmount: params.motionAmount,
          hasReferenceImage: !!params.referenceImageBase64,
        },
      })
      .returning();

    return row;
  });

  // ── List ──────────────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:list", async (_, params?: ListVideosParams) => {
    const limit = params?.limit ?? 100;
    const offset = params?.offset ?? 0;

    const conditions = [];
    if (params?.search) {
      conditions.push(like(videoStudioVideos.prompt, `%${params.search}%`));
    }
    if (params?.provider) {
      conditions.push(eq(videoStudioVideos.provider, params.provider));
    }

    const whereClause = conditions.length > 0 ? or(...conditions) : undefined;

    return db
      .select()
      .from(videoStudioVideos)
      .where(whereClause)
      .orderBy(desc(videoStudioVideos.createdAt))
      .limit(limit)
      .offset(offset);
  });

  // ── Get ───────────────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:get", async (_, id: number) => {
    const rows = await db
      .select()
      .from(videoStudioVideos)
      .where(eq(videoStudioVideos.id, id))
      .limit(1);
    if (!rows[0]) throw new Error(`Video not found: ${id}`);
    return rows[0];
  });

  // ── Delete ────────────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:delete", async (_, id: number) => {
    const rows = await db
      .select()
      .from(videoStudioVideos)
      .where(eq(videoStudioVideos.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Video not found: ${id}`);

    // Remove files
    try {
      if (fs.existsSync(row.filePath)) fs.unlinkSync(row.filePath);
    } catch { /* ignore */ }
    try {
      if (row.thumbnailPath && fs.existsSync(row.thumbnailPath)) fs.unlinkSync(row.thumbnailPath);
    } catch { /* ignore */ }

    await db.delete(videoStudioVideos).where(eq(videoStudioVideos.id, id));
    return { success: true };
  });

  // ── Save to Disk ──────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:save-to-disk", async (_, id: number) => {
    const rows = await db
      .select()
      .from(videoStudioVideos)
      .where(eq(videoStudioVideos.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Video not found: ${id}`);

    const ext = path.extname(row.filePath) || ".mp4";
    const result = await dialog.showSaveDialog({
      defaultPath: `video_${id}${ext}`,
      filters: [{ name: "Video", extensions: ["mp4", "webm", "mov"] }],
    });

    if (result.canceled || !result.filePath) return { saved: false };
    fs.copyFileSync(row.filePath, result.filePath);
    return { saved: true, dest: result.filePath };
  });

  // ── Open in Folder ────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:open-in-folder", async (_, id: number) => {
    const rows = await db
      .select()
      .from(videoStudioVideos)
      .where(eq(videoStudioVideos.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Video not found: ${id}`);
    shell.showItemInFolder(row.filePath);
  });

  // ── Available Providers ───────────────────────────────────────────────────
  ipcMain.handle("video-studio:available-providers", async () => {
    const settings = readSettings();
    const catalog = getProviderCatalog();
    const result: { id: string; label: string; models: ProviderModel[] }[] = [];

    for (const [providerId, info] of Object.entries(catalog)) {
      const providerKey = providerId;
      const setting = settings.providerSettings[providerKey];
      const hasKey = !!setting?.apiKey?.value;
      if (hasKey) {
        result.push({
          id: providerId,
          label: info.label,
          models: info.models,
        });
      }
    }

    return result;
  });

  // ── Read Video ────────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:read-video", async (_, id: number) => {
    const rows = await db
      .select()
      .from(videoStudioVideos)
      .where(eq(videoStudioVideos.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Video not found: ${id}`);
    if (!fs.existsSync(row.filePath)) throw new Error(`Video file missing: ${row.filePath}`);

    const buffer = fs.readFileSync(row.filePath);
    const ext = path.extname(row.filePath).replace(".", "") || "mp4";
    return `data:video/${ext};base64,${buffer.toString("base64")}`;
  });

  // ── Read Thumbnail ────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:read-thumbnail", async (_, id: number) => {
    const rows = await db
      .select()
      .from(videoStudioVideos)
      .where(eq(videoStudioVideos.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Video not found: ${id}`);

    if (row.thumbnailPath && fs.existsSync(row.thumbnailPath)) {
      const buffer = fs.readFileSync(row.thumbnailPath);
      return `data:image/jpeg;base64,${buffer.toString("base64")}`;
    }

    // No cached thumbnail — return empty string so client generates one
    return "";
  });

  // ── Enhance Prompt ────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:enhance-prompt", async (_, prompt: string) => {
    if (!prompt.trim()) throw new Error("Prompt is required");

    const settings = readSettings();
    const { modelClient } = await getModelClient(settings.selectedModel, settings);

    const { text } = await generateText({
      model: modelClient.model,
      system: `You are an expert AI video prompt engineer. Your task is to enhance the user's video generation prompt to produce the best possible results.

Rules:
- Expand the prompt with specific cinematic details: camera movement (dolly, pan, tilt, tracking shot, crane shot), lighting (golden hour, harsh overhead, soft diffused), motion dynamics (slow motion, time-lapse, smooth flow)
- Add temporal pacing cues: "begins with...", "transitions to...", "ends on..."
- Include texture and atmosphere details: fog, particles, reflections, depth of field, lens flare
- Specify movement quality: fluid, dynamic, gentle, dramatic, energetic
- Keep it under 200 words
- Return ONLY the enhanced prompt — no explanations or markdown`,
      prompt: `Enhance this video prompt:\n\n${prompt.trim()}`,
      maxOutputTokens: 400,
    });

    return text.trim();
  });

  // ── Extract Frames ────────────────────────────────────────────────────────
  ipcMain.handle("video-studio:extract-frames", async (_, params: ExtractFramesParams) => {
    const rows = await db
      .select()
      .from(videoStudioVideos)
      .where(eq(videoStudioVideos.id, params.videoId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Video not found: ${params.videoId}`);

    // We return the video path + metadata so the client can extract frames via canvas.
    // For server-side multi-frame extraction, ffmpeg would be needed.
    // This returns the video data URL for client-side processing.
    const buffer = fs.readFileSync(row.filePath);
    const ext = path.extname(row.filePath).replace(".", "") || "mp4";
    const dataUrl = `data:video/${ext};base64,${buffer.toString("base64")}`;

    return {
      videoDataUrl: dataUrl,
      duration: row.duration,
      fps: row.fps,
      requestedFrames: params.count ?? 1,
    };
  });
}
