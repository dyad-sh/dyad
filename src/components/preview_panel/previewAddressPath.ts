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

/**
 * The preview's current route, but only while it is still on the app's own
 * origin — otherwise undefined. Used as the recorder's starting-route hint,
 * where an off-origin path would generate a `page.goto` to somewhere the user
 * never was.
 */
export function sameOriginStartPath(
  currentHistoryUrl: string | null | undefined,
  appUrl: string | null | undefined,
): string | undefined {
  if (!currentHistoryUrl || !appUrl) return undefined;
  try {
    if (new URL(currentHistoryUrl).origin !== new URL(appUrl).origin) {
      return undefined;
    }
  } catch {
    // An unparseable URL on either side means we can't prove same-origin, and
    // guessing is what this guard exists to prevent.
    return undefined;
  }
  return formatPreviewAddressPath(currentHistoryUrl) || undefined;
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
