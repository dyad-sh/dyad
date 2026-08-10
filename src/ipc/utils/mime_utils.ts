export const MIME_TYPE_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function getMimeType(ext: string): string {
  return MIME_TYPE_MAP[ext] || "application/octet-stream";
}

/**
 * Image formats the library gallery can display but that are not accepted as
 * app media uploads (MIME_TYPE_MAP is the upload allowlist, so it stays small).
 */
const EXTRA_GALLERY_IMAGE_MIME_TYPE_MAP: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".svg": "image/svg+xml",
};

export const VIDEO_MIME_TYPE_MAP: Record<string, string> = {
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export const GALLERY_MIME_TYPE_MAP: Record<string, string> = {
  ...MIME_TYPE_MAP,
  ...EXTRA_GALLERY_IMAGE_MIME_TYPE_MAP,
  ...VIDEO_MIME_TYPE_MAP,
};

/**
 * Classifies a file extension for the media library. Returns null for anything
 * the gallery cannot render.
 */
export function getMediaKind(ext: string): "image" | "video" | null {
  const lower = ext.toLowerCase();
  if (VIDEO_MIME_TYPE_MAP[lower]) return "video";
  if (MIME_TYPE_MAP[lower] || EXTRA_GALLERY_IMAGE_MIME_TYPE_MAP[lower]) {
    return "image";
  }
  return null;
}

export function getGalleryMimeType(ext: string): string {
  return GALLERY_MIME_TYPE_MAP[ext.toLowerCase()] || "application/octet-stream";
}
