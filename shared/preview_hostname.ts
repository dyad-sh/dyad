import { DyadError, DyadErrorKind } from "../src/errors/dyad_error";

/** Stable browser identity; unlike proxy ports, app IDs are never reduced modulo a range. */
export function getAppPreviewHostname(appId: number): string {
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new DyadError(
      "Preview app ID must be a positive safe integer",
      DyadErrorKind.Validation,
    );
  }
  return `app-${appId}.localhost`;
}

export function isAppPreviewHostname(hostname: string): boolean {
  const match = /^app-([1-9]\d*)\.localhost$/.exec(hostname);
  return !!match && Number.isSafeInteger(Number(match[1]));
}
