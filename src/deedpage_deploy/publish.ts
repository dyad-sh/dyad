import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Publishing a built app to deed.page (https://deed.page/docs).
 *
 * deed.page needs no account. The first publish returns an owner token, which
 * later publishes send as a Bearer token to update the same site. Files go
 * through the manifest upload (plan, upload missing blobs, finalize), so the
 * size of a build is limited by the deed.page plan, not by one request body.
 */

export const DEEDPAGE_API_URL = "https://deed.page";
const REF = "partner_dyad";
const CLIENT = "dyad";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Folders a Vite, Next export, or similar build writes to, in order. */
export const BUILD_OUTPUT_DIRS = ["dist", "build", "out"] as const;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

export interface BuildFile {
  path: string;
  size: number;
  sha256: string;
  contentType: string;
  data: Buffer;
}

export interface DeedPagePublishResult {
  url: string;
  slug: string;
  version: string;
  /** Only set on a first publish without a token. */
  token?: string;
}

export function isValidDeedPageSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** For example `my-todo-app-k3j9x2`: readable, and unlikely to be taken. */
export function suggestDeedPageSlug(
  appName: string,
  random = Math.random().toString(36).slice(2, 8),
): string {
  const base =
    appName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "dyad-app";
  const suffix = random.toLowerCase().replace(/[^a-z0-9]/g, "") || "0";
  return `${base}-${suffix}`.slice(0, 63).replace(/-+$/, "");
}

/** The first build output folder that has an index.html, or null. */
export async function findBuildOutputDir(
  appPath: string,
): Promise<string | null> {
  for (const dir of BUILD_OUTPUT_DIRS) {
    const candidate = path.join(appPath, dir);
    try {
      const info = await fs.stat(path.join(candidate, "index.html"));
      if (info.isFile()) {
        return candidate;
      }
    } catch {
      // Not this one.
    }
  }
  return null;
}

/** Every regular file under `dir`, with site-relative POSIX paths. Symlinks are skipped. */
export async function collectBuildFiles(dir: string): Promise<BuildFile[]> {
  const files: BuildFile[] = [];
  async function walk(rel: string) {
    const entries = await fs.readdir(path.join(dir, rel), {
      withFileTypes: true,
    });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(next);
      } else if (entry.isFile()) {
        const data = await fs.readFile(path.join(dir, next));
        if (data.length > MAX_FILE_BYTES) {
          throw new Error(`${next} is larger than 100 MB.`);
        }
        files.push({
          path: next,
          size: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          contentType:
            CONTENT_TYPES[path.extname(next).toLowerCase()] ??
            "application/octet-stream",
          data,
        });
      }
    }
  }
  await walk("");
  return files;
}

interface UploadPlan {
  missing?: Array<{
    sha256: string;
    stored?: boolean;
    upload?: { url: string; method?: string; headers?: Record<string, string> };
  }>;
  finalize_url?: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Fall through to the generic message.
  }
  if (!response.ok || !body || body.ok === false) {
    const message =
      (body &&
        ((body.message_for_user as string) ||
          (body.message as string) ||
          (body.error as string))) ||
      `deed.page returned ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

/** Publish a build folder as a new version of https://<slug>.deed.page/. */
export async function publishBuildToDeedPage({
  dir,
  slug,
  token,
  fetchImpl = fetch,
}: {
  dir: string;
  slug: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<DeedPagePublishResult> {
  if (!isValidDeedPageSlug(slug)) {
    throw new Error(`"${slug}" is not a valid deed.page site name.`);
  }
  const files = await collectBuildFiles(dir);
  if (files.length === 0) {
    throw new Error("The build folder is empty.");
  }
  const auth: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const plan = await readJson<UploadPlan>(
    await fetchImpl(`${DEEDPAGE_API_URL}/v1/uploads?ref=${REF}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Client": CLIENT,
        ...auth,
      },
      body: JSON.stringify({
        slug,
        files: files.map((f) => ({
          path: f.path,
          sha256: f.sha256,
          size: f.size,
          content_type: f.contentType,
        })),
      }),
    }),
  );

  const bySha = new Map(files.map((f) => [f.sha256, f]));
  for (const blob of plan.missing ?? []) {
    if (blob.stored) continue;
    const file = bySha.get(blob.sha256);
    if (!file || !blob.upload?.url) {
      throw new Error("deed.page asked for a file that is not in the build.");
    }
    const response = await fetchImpl(blob.upload.url, {
      method: blob.upload.method ?? "PUT",
      headers: blob.upload.headers ?? {},
      body: new Uint8Array(file.data),
    });
    if (!response.ok) {
      throw new Error(
        `Uploading ${file.path} failed with status ${response.status}.`,
      );
    }
  }

  if (!plan.finalize_url) {
    throw new Error("deed.page did not return a finalize URL.");
  }
  const result = await readJson<{
    url?: string;
    slug?: string;
    version?: string;
    token?: string;
  }>(
    await fetchImpl(plan.finalize_url, {
      method: "POST",
      headers: { Accept: "application/json", "X-Client": CLIENT, ...auth },
    }),
  );
  if (!result.url) {
    throw new Error("deed.page did not return a URL.");
  }
  return {
    url: result.url,
    slug: result.slug ?? slug,
    version: result.version ?? "",
    token: result.token || undefined,
  };
}
