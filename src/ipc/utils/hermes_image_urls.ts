import { stripLocalImagePaths } from "@/lib/local_image_paths";

import {
  type HermesResponseContent,
  parseHermesResponseContent,
} from "./hermes_response";

/**
 * Turning an agent's local image paths into URLs this machine can fetch.
 *
 * A Hermes agent generates images onto its own disk and, left to itself, will
 * happily answer with something like
 * `/home/jarvis/.hermes/cache/images/gen_1234.png`. That path means nothing
 * here. Hermes now serves that same cache directory over HTTP at `/images`,
 * so the filename is all we need to build a URL that actually resolves.
 */

/** Image cache directories a Hermes-style agent writes to. */
const CACHE_IMAGE_PATH = new RegExp(
  String.raw`(?:file://)?/[^\s"'<>()\[\]]*?/cache/images/([^\s"'<>()\[\]/]+\.(?:png|jpe?g|gif|webp|avif|bmp|svg))`,
  "gi",
);

/**
 * Where an agent serves its images. An explicit setting wins; otherwise the
 * endpoint's origin plus `/images`, which is where Hermes mounts its cache.
 *
 * Returns undefined when neither yields a usable http(s) origin, so callers
 * can leave paths alone rather than invent a URL.
 */
export function resolveImageBaseUrl(
  endpoint: string | null | undefined,
  override?: string | null,
): string | undefined {
  const explicit = override?.trim();
  if (explicit) {
    return /^https?:\/\//i.test(explicit)
      ? explicit.replace(/\/+$/, "")
      : undefined;
  }

  const raw = endpoint?.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return undefined;
  try {
    return `${new URL(raw).origin}/images`;
  } catch {
    return undefined;
  }
}

/** The URL a cached image filename is served at. */
export function cachedImageUrl(baseUrl: string, fileName: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(fileName)}`;
}

export type RewrittenImagePaths = {
  /** The text with cache paths replaced by their URLs. */
  text: string;
  /** URLs discovered, in the order they appeared, without duplicates. */
  urls: string[];
};

/**
 * Rewrites `/…/cache/images/<file>` paths to `<baseUrl>/<file>`.
 *
 * Deliberately narrow: only paths that sit inside a `cache/images` directory
 * are touched. Rewriting every absolute path an agent mentions would produce
 * confident-looking URLs for files the server does not serve.
 */
export function rewriteCachedImagePaths(
  text: string,
  baseUrl: string | undefined,
): RewrittenImagePaths {
  if (!text || !baseUrl) return { text, urls: [] };

  const urls: string[] = [];
  const rewritten = text.replace(
    CACHE_IMAGE_PATH,
    (_match, fileName: string) => {
      const url = cachedImageUrl(baseUrl, fileName);
      if (!urls.includes(url)) urls.push(url);
      return url;
    },
  );

  return { text: rewritten, urls };
}

/** The same rewrite applied to every string inside a response payload. */
function rewriteDeep(value: unknown, baseUrl: string, urls: string[]): unknown {
  if (typeof value === "string") {
    const result = rewriteCachedImagePaths(value, baseUrl);
    for (const url of result.urls) {
      if (!urls.includes(url)) urls.push(url);
    }
    return result.text;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteDeep(entry, baseUrl, urls));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        rewriteDeep(entry, baseUrl, urls),
      ]),
    );
  }
  return value;
}

/**
 * Parses an agent reply, first mapping any cached-image paths onto the URLs
 * the agent serves them at.
 *
 * Rewriting before parsing is what makes a markdown image written against a
 * local path (`![x](/…/cache/images/x.png)`) resolve: by the time the parser
 * sees it, it is an ordinary https image. A path mentioned in plain prose has
 * no markdown around it, so it is collected separately and removed from the
 * text — the thumbnail already shows it, and a bare URL reads as noise.
 */
export function parseAgentReply(
  raw: unknown,
  additionalImages: unknown,
  baseUrl: string | undefined,
): HermesResponseContent {
  if (!baseUrl) {
    return parseHermesResponseContent(raw, additionalImages);
  }

  const rewrittenUrls: string[] = [];
  const rewritten = rewriteDeep(raw, baseUrl, rewrittenUrls);
  const parsed = parseHermesResponseContent(rewritten, additionalImages);

  const images = [...parsed.images];
  const leftover = rewrittenUrls.filter((url) => !images.includes(url));
  images.push(...leftover);

  return {
    text:
      leftover.length > 0
        ? stripLocalImagePaths(parsed.text, leftover)
        : parsed.text,
    images,
  };
}
