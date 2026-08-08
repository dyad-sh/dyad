/**
 * Serving OpenWorker's own built UI from inside Meta Human OS.
 *
 * OpenWorker's GUI resolves its backend from three runtime globals —
 * `__COWORKER_HTTP__`, `__COWORKER_WS__`, `__COWORKER_API_TOKEN__` — which is
 * the same seam its Tauri shell uses to point the UI at a dynamically chosen
 * sidecar port. Injecting them lets us host the unmodified application rather
 * than fork it.
 *
 * It has to be served over http on a loopback origin: the agent server's CORS
 * policy only accepts `localhost` / `127.0.0.1` (and Tauri's own schemes), so a
 * custom Electron protocol would be refused by the API.
 */

import path from "node:path";

/** Content types for the handful of extensions a Vite build emits. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

export function contentTypeFor(filePath: string): string {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

/**
 * Resolves a request path to a file inside the build directory.
 *
 * Returns null for anything that escapes the root. The served tree is a static
 * build, but this server answers on a loopback port that any local process can
 * reach, so path traversal must not be able to read the rest of the disk.
 */
export function resolveAssetPath(
  root: string,
  requestPath: string,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath.split("?")[0]!.split("#")[0]!);
  } catch {
    return null;
  }
  // A NUL byte can truncate the path inside lower-level file APIs.
  if (decoded.includes("\0")) return null;

  const relative = decoded.replace(/^\/+/, "");
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relative || "index.html");

  // `startsWith` alone would let "/root-evil" through for root "/root".
  if (
    candidate !== resolvedRoot &&
    !candidate.startsWith(resolvedRoot + path.sep)
  ) {
    return null;
  }
  return candidate;
}

/**
 * A JS string literal that is safe inside an inline `<script>`.
 *
 * `JSON.stringify` leaves `/` alone, so a value containing `</script>` would
 * close the tag and everything after it would be parsed as HTML. Escaping `<`
 * removes that whole class of breakout.
 */
function jsLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Puts the backend coordinates in front of OpenWorker's bundle.
 *
 * The script goes immediately after `<head>` so the globals exist before any
 * module script runs and asks for them.
 */
export function injectRuntimeConfig(
  html: string,
  config: { httpBase: string; wsBase: string; token: string },
): string {
  const script =
    `<script>window.__COWORKER_HTTP__=${jsLiteral(config.httpBase)};` +
    `window.__COWORKER_WS__=${jsLiteral(config.wsBase)};` +
    `window.__COWORKER_API_TOKEN__=${jsLiteral(config.token)};</script>`;

  const headIndex = html.search(/<head[^>]*>/i);
  if (headIndex < 0) return script + html;
  const insertAt = html.indexOf(">", headIndex) + 1;
  return html.slice(0, insertAt) + script + html.slice(insertAt);
}

/**
 * Whether a request may be served.
 *
 * The launch token is written into the served HTML, so any local process that
 * could fetch the page could read the token. Requiring an unguessable path
 * prefix keeps the served tree addressable only by the window we handed the
 * URL to.
 */
export function isAuthorisedRequest(
  requestPath: string,
  nonce: string,
): boolean {
  return requestPath === `/${nonce}` || requestPath.startsWith(`/${nonce}/`);
}

/** Strips the nonce prefix, leaving the path within the build directory. */
export function stripNonce(requestPath: string, nonce: string): string {
  return requestPath.slice(`/${nonce}`.length) || "/";
}
