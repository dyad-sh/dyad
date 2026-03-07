export const MIME_TYPE_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export function getMimeType(ext: string): string {
  return MIME_TYPE_MAP[ext] || "application/octet-stream";
}

/**
 * Sanitize SVG content by stripping elements and attributes that could
 * execute scripts in Electron (e.g., <script>, on* handlers, javascript: URIs).
 */
export function sanitizeSvgContent(raw: string): string {
  return (
    raw
      // Remove <script> elements (including multiline)
      .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
      // Remove self-closing <script/> tags
      .replace(/<script\s*\/>/gi, "")
      // Remove <foreignObject> elements (can embed arbitrary HTML)
      .replace(/<foreignObject[\s>][\s\S]*?<\/foreignObject>/gi, "")
      // Remove on* event handler attributes
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // Remove javascript: URIs in href and xlink:href attributes
      .replace(
        /((?:xlink:)?href\s*=\s*(?:"|'))javascript:[^"']*("|')/gi,
        "$1#$2",
      )
      // Remove data: URIs in href and xlink:href attributes (defense-in-depth)
      .replace(
        /((?:xlink:)?href\s*=\s*(?:"|'))data:[^"']*("|')/gi,
        "$1#$2",
      )
  );
}
