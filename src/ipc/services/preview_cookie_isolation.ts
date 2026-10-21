import { readSettings } from "@/main/settings";
import { DEFAULT_ENABLE_PREVIEW_COOKIE_ISOLATION } from "@/shared/settings_defaults";

let enabled: boolean | undefined;

/**
 * Captured during Electron startup, before any renderer can change settings.
 * All localhost proxies must use one mode for the entire Dyad process: mixing
 * modes lets a shared session reach an isolated app without its own cookie.
 */
export function isPreviewCookieIsolationEnabled(): boolean {
  return (enabled ??=
    readSettings().enablePreviewCookieIsolation ??
    DEFAULT_ENABLE_PREVIEW_COOKIE_ISOLATION);
}
