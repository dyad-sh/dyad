import { session } from "electron";
import { isAppPreviewHostname } from "../../../shared/preview_hostname";

/** Recording must never clear another app's cookies in the shared session. */
export async function clearPreviewStorage(origin: string): Promise<void> {
  const url = new URL(origin);
  if (!isAppPreviewHostname(url.hostname) || url.protocol !== "http:") {
    throw new Error("Cannot clear storage for an unrecognized preview origin");
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
    const cookieUrl = `${cookie.secure ? "https:" : "http:"}//${url.host}${cookie.path || "/"}`;
    await session.defaultSession.cookies.remove(cookieUrl, cookie.name);
  }
}
