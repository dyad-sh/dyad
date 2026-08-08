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
