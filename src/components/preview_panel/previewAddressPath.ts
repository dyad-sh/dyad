export const PREVIEW_ADDRESS_PATH_ERROR =
  "Enter a relative preview path like /about.";

export type PreviewAddressPathNormalizationResult =
  | { type: "empty" }
  | { type: "valid"; path: string }
  | { type: "invalid"; message: string };

export function formatPreviewAddressPath(url: string | null | undefined) {
  if (!url) {
    return "/";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
  } catch {
    return "/";
  }
}

export function normalizePreviewAddressPath(
  value: string,
): PreviewAddressPathNormalizationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { type: "empty" };
  }

  if (
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)
  ) {
    return { type: "invalid", message: PREVIEW_ADDRESS_PATH_ERROR };
  }

  const path =
    trimmed.startsWith("/") ||
    trimmed.startsWith("?") ||
    trimmed.startsWith("#")
      ? trimmed
      : `/${trimmed}`;
  const normalizedPath =
    path.startsWith("?") || path.startsWith("#") ? `/${path}` : path;

  try {
    const parsed = new URL(normalizedPath, "http://preview.local");
    if (parsed.origin !== "http://preview.local") {
      return { type: "invalid", message: PREVIEW_ADDRESS_PATH_ERROR };
    }
    return {
      type: "valid",
      path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
    };
  } catch {
    return { type: "invalid", message: PREVIEW_ADDRESS_PATH_ERROR };
  }
}
