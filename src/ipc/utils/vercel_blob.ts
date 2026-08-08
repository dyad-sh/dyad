import { copy, del, get, list, put } from "@vercel/blob";

import { readSettings } from "@/main/settings";

type BlobAccess = "public" | "private";

// The store's access mode (public vs private) isn't known up front, so it's
// detected on the first write and remembered for the session.
let detectedAccess: BlobAccess | null = null;

function isAccessMismatch(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /private store|public access|private access|access (?:level|mode|configured)/i.test(
    msg,
  );
}

/**
 * Run a Blob write under the right access mode. Tries the detected mode (or
 * public, then private), remembering whichever the store accepts.
 */
async function withAccess<T>(
  fn: (access: BlobAccess) => Promise<T>,
): Promise<T> {
  const order: BlobAccess[] = detectedAccess
    ? [detectedAccess]
    : ["public", "private"];
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    try {
      const result = await fn(order[i]);
      detectedAccess = order[i];
      return result;
    } catch (e) {
      lastErr = e;
      if (!isAccessMismatch(e) || i === order.length - 1) throw e;
    }
  }
  throw lastErr;
}

/** Decrypted store read/write token, or undefined when not connected. */
export function getBlobToken(): string | undefined {
  // readSettings() already decrypts stored secrets, so use the value directly.
  const token = readSettings().vercelBlob?.token;
  return token?.value || undefined;
}

export function isBlobConnected(): boolean {
  return Boolean(getBlobToken());
}

/** Cloud writes are opt-in even when a Blob token has been connected. */
export function isCloudStorageEnabled(): boolean {
  return readSettings().storage?.destination === "cloud";
}

/** Validate a token by performing a tiny list call against the store. */
export async function verifyBlobToken(token: string): Promise<void> {
  await list({ token, limit: 1 });
}

export type UploadedBlob = { url: string; pathname: string };

/**
 * Upload bytes to the connected store, matching its access mode (public or
 * private — detected automatically and remembered for the session).
 */
export async function uploadToBlob(
  pathname: string,
  data: Buffer | Uint8Array | ArrayBuffer | string,
  opts?: {
    contentType?: string;
    /** Append a random suffix to avoid collisions (default false). */
    addRandomSuffix?: boolean;
    /** Allow overwriting an existing blob at the same pathname. */
    allowOverwrite?: boolean;
  },
): Promise<UploadedBlob> {
  const token = getBlobToken();
  if (!token) {
    throw new Error("Vercel Blob is not connected. Add a token in Settings.");
  }
  const result = await withAccess((access) =>
    put(pathname, data as Buffer, {
      access,
      token,
      addRandomSuffix: opts?.addRandomSuffix ?? false,
      ...(opts?.allowOverwrite ? { allowOverwrite: true } : {}),
      ...(opts?.contentType ? { contentType: opts.contentType } : {}),
    }),
  );
  return { url: result.url, pathname: result.pathname };
}

/**
 * Fetch a blob's bytes as a base64 data URL. Works for private stores (whose
 * URLs can't be loaded directly in <img>/<video>), and for public ones. Reads
 * try both access modes on any failure since the mode is reset across restarts.
 */
export async function getBlobContent(
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const token = getBlobToken();
  if (!token) throw new Error("Vercel Blob is not connected.");
  const order: BlobAccess[] = detectedAccess
    ? [detectedAccess]
    : ["public", "private"];
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    const isLast = i === order.length - 1;
    try {
      const result = await get(url, { access: order[i], token });
      if (!result) {
        if (!isLast) continue; // try the other mode before giving up
        return null;
      }
      detectedAccess = order[i];
      const buffer = Buffer.from(
        await new Response(result.stream).arrayBuffer(),
      );
      const contentType =
        result.blob?.contentType || "application/octet-stream";
      return { buffer, contentType };
    } catch (e) {
      lastErr = e;
      if (isLast) throw e;
    }
  }
  throw lastErr;
}

export async function getBlobDataUrl(url: string): Promise<string | null> {
  const content = await getBlobContent(url);
  if (!content) return null;
  return `data:${content.contentType};base64,${content.buffer.toString("base64")}`;
}

/** Fetch a blob's raw bytes (works for private stores too). */
export async function getBlobBuffer(url: string): Promise<Buffer | null> {
  const content = await getBlobContent(url);
  return content ? content.buffer : null;
}

/** Create a virtual folder by writing a `.keep` marker file. */
export async function createBlobFolder(folder: string): Promise<void> {
  const clean = folder.replace(/^\/+|\/+$/g, "");
  if (!clean) throw new Error("Folder name is required.");
  await uploadToBlob(`${clean}/.keep`, "\n", {
    allowOverwrite: true,
    contentType: "text/plain",
  });
}

/** Delete every blob under a folder prefix. */
export async function deleteBlobFolder(prefix: string): Promise<void> {
  const token = getBlobToken();
  if (!token) throw new Error("Vercel Blob is not connected.");
  const clean = prefix.replace(/^\/+|\/+$/g, "");
  if (!clean) throw new Error("Folder is required.");
  const { blobs } = await list({ token, prefix: `${clean}/` });
  if (blobs.length > 0) {
    await del(
      blobs.map((b) => b.url),
      { token },
    );
  }
}

/** Rename a folder by copying every blob under it to the new prefix. */
export async function renameBlobFolder(
  from: string,
  to: string,
): Promise<void> {
  const token = getBlobToken();
  if (!token) throw new Error("Vercel Blob is not connected.");
  const fromClean = from.replace(/^\/+|\/+$/g, "");
  const toClean = to.replace(/^\/+|\/+$/g, "");
  if (!fromClean || !toClean) throw new Error("Folder name is required.");
  if (fromClean === toClean) return;

  const fromPrefix = `${fromClean}/`;
  const { blobs } = await list({ token, prefix: fromPrefix });
  for (const b of blobs) {
    const rest = b.pathname.slice(fromPrefix.length);
    await withAccess((access) =>
      copy(b.url, `${toClean}/${rest}`, {
        access,
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
      }),
    );
  }
  if (blobs.length > 0) {
    await del(
      blobs.map((b) => b.url),
      { token },
    );
  }
}

/**
 * Rename/move a single blob: copy it to the new pathname, then delete the old
 * one. Matches the store's access mode. Callers must ensure the destination
 * differs from the source — copying onto the same path then deleting would lose
 * the file.
 */
export async function renameBlob(
  fromUrl: string,
  toPathname: string,
): Promise<UploadedBlob> {
  const token = getBlobToken();
  if (!token) throw new Error("Vercel Blob is not connected.");
  const clean = toPathname.replace(/^\/+/, "");
  if (!clean) throw new Error("File name is required.");
  const result = await withAccess((access) =>
    copy(fromUrl, clean, {
      access,
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
    }),
  );
  await del(fromUrl, { token });
  return { url: result.url, pathname: result.pathname };
}

export type BlobListItem = {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: string;
};

export async function listBlobs(prefix?: string): Promise<BlobListItem[]> {
  const token = getBlobToken();
  if (!token) throw new Error("Vercel Blob is not connected.");
  const { blobs } = await list({ token, ...(prefix ? { prefix } : {}) });
  return blobs.map((b) => ({
    pathname: b.pathname,
    url: b.url,
    size: b.size,
    uploadedAt:
      b.uploadedAt instanceof Date
        ? b.uploadedAt.toISOString()
        : String(b.uploadedAt),
  }));
}

export async function deleteBlob(url: string): Promise<void> {
  const token = getBlobToken();
  if (!token) throw new Error("Vercel Blob is not connected.");
  await del(url, { token });
}
