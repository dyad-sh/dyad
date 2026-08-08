import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { z } from "zod";
import { generateText } from "ai";

import { createTypedHandler } from "./base";
import {
  socialMediaContracts,
  SocialPostSchema,
  type SocialConnectionsStatus,
  type SocialPlatform,
  type SocialPost,
} from "../types/social_media";
import { readSettings, writeSettings } from "../../main/settings";
import { getUserDataPath } from "../../paths/paths";
import { withLock } from "../utils/lock_utils";
import {
  isBlobConnected,
  isCloudStorageEnabled,
  uploadToBlob,
} from "../utils/vercel_blob";
import { getModelClient } from "../utils/get_model_client";
import { getChatAgentModel } from "@/lib/chat_agent_model";
import type {
  FacebookConnection,
  UserSettings,
  XConnection,
} from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("social_media_handlers");

const POSTS_FILE = "social-media-posts.json";
const POSTS_LOCK = "social-media-posts";
const GRAPH_API_BASE = "https://graph.facebook.com/v23.0";
const X_API_BASE = "https://api.twitter.com";
const X_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const REQUEST_TIMEOUT_MS = 60_000;
const SCHEDULER_INTERVAL_MS = 30_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // platform-side limits are lower anyway

// =============================================================================
// Post store (JSON file in userData until the real DB lands)
// =============================================================================

let postsCache: SocialPost[] | null = null;

function getPostsFilePath(): string {
  return path.join(getUserDataPath(), POSTS_FILE);
}

function loadPosts(): SocialPost[] {
  if (postsCache) {
    return postsCache;
  }
  try {
    const filePath = getPostsFilePath();
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const parsed = z.array(SocialPostSchema).safeParse(raw);
      if (parsed.success) {
        postsCache = parsed.data;
      } else {
        logger.warn("Social posts file failed validation; starting empty.");
        postsCache = [];
      }
    } else {
      postsCache = [];
    }
  } catch (error) {
    logger.error("Failed to read social posts file:", error);
    postsCache = [];
  }
  return postsCache;
}

async function savePosts(posts: SocialPost[]): Promise<void> {
  postsCache = posts;
  const filePath = getPostsFilePath();
  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(posts, null, 2);
  await fs.promises.writeFile(tmpPath, json);
  await fs.promises.rename(tmpPath, filePath);

  // Best-effort cloud backup of the post schedule to Meta HD (Vercel Blob).
  if (isCloudStorageEnabled() && isBlobConnected()) {
    try {
      await uploadToBlob(`social/${POSTS_FILE}`, Buffer.from(json, "utf8"), {
        contentType: "application/json",
        allowOverwrite: true,
      });
    } catch (e) {
      logger.error("Failed to back up social posts to Vercel Blob:", e);
    }
  }
}

function sortPosts(posts: SocialPost[]): SocialPost[] {
  // Upcoming first within scheduled, then by recency.
  return [...posts].sort(
    (a, b) => (b.scheduledFor ?? b.createdAt) - (a.scheduledFor ?? a.createdAt),
  );
}

async function mutatePost(
  id: string,
  patch: Partial<SocialPost>,
): Promise<SocialPost> {
  return withLock(POSTS_LOCK, async () => {
    const posts = loadPosts();
    const index = posts.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new DyadError("Post not found", DyadErrorKind.NotFound);
    }
    const updated: SocialPost = {
      ...posts[index],
      ...patch,
      updatedAt: Date.now(),
    };
    const next = [...posts];
    next[index] = updated;
    await savePosts(next);
    return updated;
  });
}

// =============================================================================
// Connections
// =============================================================================

function toConnectionsStatus(settings: UserSettings): SocialConnectionsStatus {
  const facebook = settings.socialMedia?.facebook;
  const x = settings.socialMedia?.x;
  return {
    facebook: facebook
      ? {
          connected: true,
          pageId: facebook.pageId,
          pageName: facebook.pageName,
          connectedAt: facebook.connectedAt,
        }
      : { connected: false },
    x: x
      ? {
          connected: true,
          username: x.username,
          connectedAt: x.connectedAt,
        }
      : { connected: false },
  };
}

function requireFacebookConnection(settings: UserSettings): FacebookConnection {
  const facebook = settings.socialMedia?.facebook;
  if (!facebook?.pageAccessToken?.value) {
    throw new DyadError(
      "Facebook is not connected. Connect a Facebook Page in Settings → Integrations or the Social Media Agent first.",
      DyadErrorKind.Auth,
    );
  }
  return facebook;
}

function requireXConnection(settings: UserSettings): XConnection {
  const x = settings.socialMedia?.x;
  if (
    !x?.apiKey?.value ||
    !x.apiSecret?.value ||
    !x.accessToken?.value ||
    !x.accessTokenSecret?.value
  ) {
    throw new DyadError(
      "X is not connected. Connect your X account in Settings → Integrations or the Social Media Agent first.",
      DyadErrorKind.Auth,
    );
  }
  return x;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DyadError(
        "The request to the platform timed out. Please try again.",
        DyadErrorKind.External,
      );
    }
    throw new DyadError(
      "Could not reach the platform API. Check your internet connection.",
      DyadErrorKind.External,
    );
  } finally {
    clearTimeout(timeout);
  }
}

// =============================================================================
// Facebook (Graph API, Page access token)
// =============================================================================

async function readGraphError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {
      error?: { message?: string; code?: number };
    };
    if (json?.error?.message) {
      return json.error.message;
    }
  } catch {
    // fall through to the generic message
  }
  return `Facebook API error (HTTP ${response.status})`;
}

async function verifyFacebookPage(
  pageId: string,
  pageAccessToken: string,
): Promise<{ id: string; name?: string }> {
  const url = `${GRAPH_API_BASE}/${encodeURIComponent(
    pageId,
  )}?fields=id,name&access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new DyadError(await readGraphError(response), DyadErrorKind.Auth);
  }
  const json = (await response.json()) as { id?: string; name?: string };
  if (!json?.id) {
    throw new DyadError(
      "Facebook returned an unexpected response while verifying the Page.",
      DyadErrorKind.External,
    );
  }
  return { id: json.id, name: json.name };
}

function decodeDataUrlImage(image: string): { buffer: Buffer; mime: string } {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(image);
  if (!match) {
    throw new DyadError("Invalid image data.", DyadErrorKind.Validation);
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new DyadError(
      "The image is too large to upload (max 10 MB).",
      DyadErrorKind.Validation,
    );
  }
  return { buffer, mime: match[1] };
}

async function publishToFacebook(
  connection: FacebookConnection,
  post: SocialPost,
): Promise<{ externalId: string; externalUrl: string }> {
  const token = connection.pageAccessToken.value;
  const pageId = encodeURIComponent(connection.pageId);

  let response: Response;
  if (post.image) {
    const { buffer, mime } = decodeDataUrlImage(post.image);
    const form = new FormData();
    form.append(
      "source",
      new Blob([new Uint8Array(buffer)], { type: mime }),
      "post-image.png",
    );
    form.append("caption", post.content);
    form.append("access_token", token);
    response = await fetchWithTimeout(`${GRAPH_API_BASE}/${pageId}/photos`, {
      method: "POST",
      body: form,
    });
  } else {
    response = await fetchWithTimeout(`${GRAPH_API_BASE}/${pageId}/feed`, {
      method: "POST",
      body: new URLSearchParams({
        message: post.content,
        access_token: token,
      }),
    });
  }

  if (!response.ok) {
    throw new DyadError(await readGraphError(response), DyadErrorKind.External);
  }
  const json = (await response.json()) as { id?: string; post_id?: string };
  const externalId = json.post_id ?? json.id;
  if (!externalId) {
    throw new DyadError(
      "Facebook did not return a post id.",
      DyadErrorKind.External,
    );
  }
  return {
    externalId,
    externalUrl: `https://www.facebook.com/${externalId}`,
  };
}

// =============================================================================
// X / Twitter (OAuth 1.0a user context)
// =============================================================================

interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function xCredentials(connection: XConnection): XCredentials {
  return {
    apiKey: connection.apiKey.value,
    apiSecret: connection.apiSecret.value,
    accessToken: connection.accessToken.value,
    accessTokenSecret: connection.accessTokenSecret.value,
  };
}

/** RFC 3986 percent-encoding as required by OAuth 1.0a. */
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Builds an OAuth 1.0a HMAC-SHA1 Authorization header. `bodyParams` must only
 * be provided for form-urlencoded bodies; multipart and JSON bodies are
 * excluded from the signature base string per spec.
 */
function buildOAuth1Header(
  method: "GET" | "POST",
  url: string,
  creds: XCredentials,
  bodyParams: Record<string, string> = {},
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const parsedUrl = new URL(url);
  const allParams: Array<[string, string]> = [
    ...Object.entries(oauthParams),
    ...Array.from(parsedUrl.searchParams.entries()),
    ...Object.entries(bodyParams),
  ].map(([key, value]) => [percentEncode(key), percentEncode(value)]);
  allParams.sort(([aKey, aValue], [bKey, bValue]) =>
    aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
  );
  const paramString = allParams.map(([k, v]) => `${k}=${v}`).join("&");

  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
  const baseString = [
    method,
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(
    creds.accessTokenSecret,
  )}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  return `OAuth ${Object.entries(headerParams)
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ")}`;
}

async function readXError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {
      detail?: string;
      title?: string;
      errors?: Array<{ message?: string }>;
    };
    const message =
      json?.detail ?? json?.errors?.[0]?.message ?? json?.title ?? undefined;
    if (message) {
      return message;
    }
  } catch {
    // fall through to the generic message
  }
  if (response.status === 401) {
    return "X rejected the credentials (HTTP 401). Double-check the four keys and that your app has Read and Write permissions.";
  }
  if (response.status === 403) {
    return "X refused the request (HTTP 403). Your app may not have write access — set the app permissions to Read and Write, then regenerate the access token.";
  }
  return `X API error (HTTP ${response.status})`;
}

async function verifyXCredentials(
  creds: XCredentials,
): Promise<{ username?: string }> {
  const url = `${X_API_BASE}/2/users/me`;
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: buildOAuth1Header("GET", url, creds) },
  });
  if (!response.ok) {
    throw new DyadError(await readXError(response), DyadErrorKind.Auth);
  }
  const json = (await response.json()) as { data?: { username?: string } };
  return { username: json?.data?.username };
}

async function uploadXMedia(
  creds: XCredentials,
  image: string,
): Promise<string> {
  const { buffer, mime } = decodeDataUrlImage(image);
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(buffer)], { type: mime }),
    "post-image.png",
  );
  const response = await fetchWithTimeout(X_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: buildOAuth1Header("POST", X_UPLOAD_URL, creds) },
    body: form,
  });
  if (!response.ok) {
    throw new DyadError(await readXError(response), DyadErrorKind.External);
  }
  const json = (await response.json()) as {
    media_id_string?: string;
  };
  if (!json?.media_id_string) {
    throw new DyadError(
      "X did not return a media id for the uploaded image.",
      DyadErrorKind.External,
    );
  }
  return json.media_id_string;
}

async function publishToX(
  connection: XConnection,
  post: SocialPost,
): Promise<{ externalId: string; externalUrl: string }> {
  const creds = xCredentials(connection);

  let mediaId: string | undefined;
  if (post.image) {
    mediaId = await uploadXMedia(creds, post.image);
  }

  const url = `${X_API_BASE}/2/tweets`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: buildOAuth1Header("POST", url, creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: post.content,
      ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
    }),
  });
  if (!response.ok) {
    throw new DyadError(await readXError(response), DyadErrorKind.External);
  }
  const json = (await response.json()) as { data?: { id?: string } };
  const externalId = json?.data?.id;
  if (!externalId) {
    throw new DyadError("X did not return a post id.", DyadErrorKind.External);
  }
  const username = connection.username;
  return {
    externalId,
    externalUrl: username
      ? `https://x.com/${username}/status/${externalId}`
      : `https://x.com/i/web/status/${externalId}`,
  };
}

// =============================================================================
// Publishing + scheduler
// =============================================================================

const publishInFlight = new Set<string>();

async function publishPostById(id: string): Promise<SocialPost> {
  if (publishInFlight.has(id)) {
    throw new DyadError(
      "This post is already being published.",
      DyadErrorKind.Validation,
    );
  }
  const post = loadPosts().find((p) => p.id === id);
  if (!post) {
    throw new DyadError("Post not found", DyadErrorKind.NotFound);
  }
  if (post.status === "posted") {
    return post;
  }

  const settings = readSettings();
  publishInFlight.add(id);
  await mutatePost(id, { status: "posting", error: null });
  try {
    const result =
      post.platform === "facebook"
        ? await publishToFacebook(requireFacebookConnection(settings), post)
        : await publishToX(requireXConnection(settings), post);
    logger.log(`Published ${post.platform} post ${id} -> ${result.externalId}`);
    return await mutatePost(id, {
      status: "posted",
      postedAt: Date.now(),
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mutatePost(id, { status: "failed", error: message }).catch(() => {});
    throw error;
  } finally {
    publishInFlight.delete(id);
  }
}

async function processDueScheduledPosts(): Promise<void> {
  const now = Date.now();
  const due = loadPosts().filter(
    (post) =>
      post.status === "scheduled" &&
      post.scheduledFor != null &&
      post.scheduledFor <= now &&
      !publishInFlight.has(post.id),
  );
  for (const post of due) {
    try {
      await publishPostById(post.id);
    } catch (error) {
      logger.error(
        `Scheduled publish failed for ${post.platform} post ${post.id}:`,
        error,
      );
    }
  }
}

let schedulerStarted = false;

function startScheduler(): void {
  if (schedulerStarted) {
    return;
  }
  schedulerStarted = true;
  const timer = setInterval(() => {
    void processDueScheduledPosts();
  }, SCHEDULER_INTERVAL_MS);
  // Don't keep the process alive just for the scheduler.
  timer.unref?.();
}

// =============================================================================
// AI copy generation
// =============================================================================

const PLATFORM_COPY_GUIDE: Record<SocialPlatform, string> = {
  facebook: [
    "Platform: Facebook Page post.",
    "- Conversational and warm; 1-3 short paragraphs.",
    "- Hook in the first line, a clear call to action at the end.",
    "- At most 3 relevant hashtags, placed at the end.",
    "- Emojis are welcome but keep them tasteful (2-4 total).",
  ].join("\n"),
  x: [
    "Platform: X (Twitter) post.",
    "- HARD LIMIT: the post must be under 270 characters including spaces, hashtags and emojis.",
    "- Punchy, high-energy, scroll-stopping first words.",
    "- At most 2 hashtags. 0-2 emojis.",
  ].join("\n"),
};

function buildCopySystemPrompt(platform: SocialPlatform): string {
  return [
    "You are an elite social media copywriter and art director.",
    "Given the user's idea, write a ready-to-publish post and a matching image-generation prompt.",
    "",
    PLATFORM_COPY_GUIDE[platform],
    "",
    "The image prompt should describe a single striking, brand-quality visual (subject, style, lighting, mood) in under 80 words. Never include text overlays or logos in the image prompt.",
    "",
    'Respond with ONLY a JSON object, no markdown fences: {"content": "<the post text>", "imagePrompt": "<the image prompt>"}',
  ].join("\n");
}

function parseCopyResponse(
  raw: string,
  fallbackPrompt: string,
): { content: string; imagePrompt: string } {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
        content?: unknown;
        imagePrompt?: unknown;
      };
      const content =
        typeof parsed.content === "string" ? parsed.content.trim() : "";
      const imagePrompt =
        typeof parsed.imagePrompt === "string" ? parsed.imagePrompt.trim() : "";
      if (content) {
        return { content, imagePrompt: imagePrompt || fallbackPrompt };
      }
    } catch {
      // fall through to the raw-text fallback
    }
  }
  return { content: cleaned, imagePrompt: fallbackPrompt };
}

// =============================================================================
// Handlers
// =============================================================================

export function registerSocialMediaHandlers() {
  startScheduler();

  createTypedHandler(socialMediaContracts.getConnections, async () => {
    return toConnectionsStatus(readSettings());
  });

  createTypedHandler(
    socialMediaContracts.connectFacebook,
    async (_, params) => {
      const page = await verifyFacebookPage(
        params.pageId.trim(),
        params.pageAccessToken.trim(),
      );
      const settings = readSettings();
      writeSettings({
        socialMedia: {
          ...settings.socialMedia,
          facebook: {
            pageId: page.id,
            pageName: page.name,
            pageAccessToken: { value: params.pageAccessToken.trim() },
            connectedAt: Date.now(),
          },
        },
      });
      logger.log(`Connected Facebook Page ${page.id} (${page.name ?? "?"})`);
      return toConnectionsStatus(readSettings());
    },
  );

  createTypedHandler(socialMediaContracts.connectX, async (_, params) => {
    const creds: XCredentials = {
      apiKey: params.apiKey.trim(),
      apiSecret: params.apiSecret.trim(),
      accessToken: params.accessToken.trim(),
      accessTokenSecret: params.accessTokenSecret.trim(),
    };
    const { username } = await verifyXCredentials(creds);
    const settings = readSettings();
    writeSettings({
      socialMedia: {
        ...settings.socialMedia,
        x: {
          apiKey: { value: creds.apiKey },
          apiSecret: { value: creds.apiSecret },
          accessToken: { value: creds.accessToken },
          accessTokenSecret: { value: creds.accessTokenSecret },
          username,
          connectedAt: Date.now(),
        },
      },
    });
    logger.log(`Connected X account @${username ?? "unknown"}`);
    return toConnectionsStatus(readSettings());
  });

  createTypedHandler(socialMediaContracts.disconnect, async (_, params) => {
    const settings = readSettings();
    const socialMedia = { ...settings.socialMedia };
    delete socialMedia[params.platform];
    writeSettings({ socialMedia });
    logger.log(`Disconnected ${params.platform}`);
    return toConnectionsStatus(readSettings());
  });

  createTypedHandler(socialMediaContracts.listPosts, async () => {
    return sortPosts(loadPosts());
  });

  createTypedHandler(socialMediaContracts.createPost, async (_, params) => {
    return withLock(POSTS_LOCK, async () => {
      const now = Date.now();
      const post: SocialPost = {
        id: `smp_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        platform: params.platform,
        content: params.content,
        image: params.image ?? null,
        prompt: params.prompt ?? null,
        status: params.scheduledFor != null ? "scheduled" : "draft",
        scheduledFor: params.scheduledFor ?? null,
        postedAt: null,
        externalId: null,
        externalUrl: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      await savePosts([post, ...loadPosts()]);
      logger.log(`Created ${post.status} ${post.platform} post ${post.id}`);
      return post;
    });
  });

  createTypedHandler(socialMediaContracts.updatePost, async (_, params) => {
    const existing = loadPosts().find((p) => p.id === params.id);
    if (!existing) {
      throw new DyadError("Post not found", DyadErrorKind.NotFound);
    }
    if (existing.status === "posted" || existing.status === "posting") {
      throw new DyadError(
        "Published posts cannot be edited.",
        DyadErrorKind.Validation,
      );
    }
    const patch: Partial<SocialPost> = {};
    if (params.content !== undefined) patch.content = params.content;
    if (params.image !== undefined) patch.image = params.image;
    if (params.scheduledFor !== undefined) {
      patch.scheduledFor = params.scheduledFor;
    }
    if (params.status !== undefined) {
      patch.status = params.status;
      patch.error = null;
    } else if (params.scheduledFor != null && existing.status === "failed") {
      // Re-arming a failed post by rescheduling clears the failure.
      patch.status = "scheduled";
      patch.error = null;
    }
    return mutatePost(params.id, patch);
  });

  createTypedHandler(socialMediaContracts.deletePost, async (_, params) => {
    return withLock(POSTS_LOCK, async () => {
      const posts = loadPosts();
      const next = posts.filter((p) => p.id !== params.id);
      if (next.length === posts.length) {
        return { deleted: false };
      }
      await savePosts(next);
      logger.log(`Deleted social post ${params.id}`);
      return { deleted: true };
    });
  });

  createTypedHandler(
    socialMediaContracts.generatePostCopy,
    async (_, params) => {
      const settings = readSettings();
      const selectedModel = getChatAgentModel(settings);
      const { modelClient } = await getModelClient(selectedModel, settings);

      const { text } = await generateText({
        model: modelClient.model,
        system: buildCopySystemPrompt(params.platform),
        prompt: params.prompt,
        temperature: 0.8,
        maxOutputTokens: 1024,
        maxRetries: 1,
      });

      const parsed = parseCopyResponse(text, params.prompt);
      if (!parsed.content) {
        throw new DyadError(
          "The model returned an empty post. Try rephrasing your prompt.",
          DyadErrorKind.External,
        );
      }
      return parsed;
    },
  );

  createTypedHandler(socialMediaContracts.publishPost, async (_, params) => {
    return publishPostById(params.id);
  });
}
