import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAppPreviewHostname } from "../../../shared/preview_hostname";

/** Provider allowlists accept only the exact origin owned by this app. */
export function assertAppPreviewOrigin(appId: number, origin: string): void {
  const url = URL.parse(origin);
  if (
    !url ||
    url.protocol !== "http:" ||
    url.hostname !== getAppPreviewHostname(appId) ||
    !url.port ||
    url.origin !== origin
  ) {
    throw new DyadError("Invalid app preview origin", DyadErrorKind.Validation);
  }
}
