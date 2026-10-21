import { session, type Cookie } from "electron";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  getPreviewCookieNamespace,
  getCookiePreviewNamespace,
  isAppPreviewHostname,
  isPreviewNamespacedCookie,
} from "../../../shared/preview_hostname";

/**
 * App domains isolate cookies; legacy localhost cookies are shared across
 * ports, so other apps' namespaced sessions are left in place.
 */
export async function clearPreviewStorage(
  origin: string,
  appId: number,
): Promise<void> {
  const namespace = getPreviewCookieNamespace(appId);
  const url = URL.parse(origin);
  if (
    !url ||
    (!isAppPreviewHostname(url.hostname) && url.hostname !== "localhost") ||
    url.protocol !== "http:"
  ) {
    throw new DyadError(
      "Cannot clear storage for an unrecognized preview origin",
      DyadErrorKind.Validation,
    );
  }
  // Include the app's partitioned iframe storage, matching the frame origin
  // even when Dyad's file:// renderer is the top-level site. Keep cookies out:
  // clearData removes them at registrable-domain scope, which is too broad.
  await session.defaultSession.clearData({
    origins: [url.origin],
    originMatchingMode: "origin-in-all-contexts",
    dataTypes: ["localStorage", "indexedDB", "serviceWorkers", "cache"],
  });
  const cookies = await session.defaultSession.cookies.get({
    domain: url.hostname,
  });
  for (const cookie of cookies) {
    if (cookie.domain?.replace(/^\./, "") !== url.hostname) continue;
    if (
      url.hostname === "localhost" &&
      isPreviewNamespacedCookie(cookie.name) &&
      getCookiePreviewNamespace(cookie.name) !== namespace
    )
      continue;
    const cookieUrl = `${cookie.secure ? "https:" : "http:"}//${url.host}${cookie.path || "/"}`;
    await session.defaultSession.cookies.remove(cookieUrl, cookie.name);
  }
}

let sharedSessionCookieCleanup: Promise<void> | undefined;

/**
 * Removes HttpOnly cookies that shared-localhost previews stored under their
 * original names before the proxy namespaced them per app. Nothing records
 * which app set them, and the proxy cannot see HttpOnly in a Cookie header,
 * so it would forward another app's session to any app without its own
 * namespaced copy yet. The proxy namespaces every HttpOnly cookie it writes,
 * so one sweep per process is enough; a failed sweep is retried next call.
 * Isolation mode is fixed until Dyad restarts, so no unisolated proxy can
 * start while this sweep is pending or write new shared sessions afterward.
 */
export function clearSharedPreviewSessionCookies(): Promise<void> {
  sharedSessionCookieCleanup ??= removeSharedLocalhostCookies(
    (cookie) => !!cookie.httpOnly && !isPreviewNamespacedCookie(cookie.name),
  ).catch((error) => {
    sharedSessionCookieCleanup = undefined;
    throw error;
  });
  return sharedSessionCookieCleanup;
}

/**
 * Retires an app's namespaced cookies on deletion or before starting without
 * isolation. Otherwise hidden credentials could survive a sign-out in shared
 * mode and reappear after opting back in. Only HttpOnly cookies are namespaced
 * by the proxy, so script-readable cookies are left alone.
 */
export async function clearPreviewNamespacedCookies(
  appId: number,
): Promise<void> {
  const namespace = getPreviewCookieNamespace(appId);
  await removeSharedLocalhostCookies(
    (cookie) =>
      !!cookie.httpOnly && getCookiePreviewNamespace(cookie.name) === namespace,
  );
}

/** Removes localhost (not subdomain) cookies matching `shouldRemove`, on any port. */
async function removeSharedLocalhostCookies(
  shouldRemove: (cookie: Cookie) => boolean,
): Promise<void> {
  const cookies = await session.defaultSession.cookies.get({
    domain: "localhost",
  });
  for (const cookie of cookies) {
    if (
      cookie.domain?.replace(/^\./, "") !== "localhost" ||
      !shouldRemove(cookie)
    )
      continue;
    const cookieUrl = `${cookie.secure ? "https:" : "http:"}//localhost${cookie.path || "/"}`;
    await session.defaultSession.cookies.remove(cookieUrl, cookie.name);
  }
}
