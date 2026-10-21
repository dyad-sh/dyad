/**
 * proxy.js – zero-dependency worker-based HTTP/WS forwarder
 */

const { parentPort, workerData } = require("worker_threads");

const http = require("http");
const https = require("https");

const { URL } = require("url");
const fs = require("fs");
const path = require("path");

/* ──────────────────────────── worker code ─────────────────────────────── */
const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = workerData.port;
const PREVIEW_HOSTNAME = workerData.hostname;
// Keep this worker-side check aligned with shared/preview_hostname.ts's
// isAppPreviewHostname; the unbundled worker cannot import TypeScript.
if (
  typeof PREVIEW_HOSTNAME !== "string" ||
  (PREVIEW_HOSTNAME !== "localhost" &&
    (!/^app-([1-9]\d*)\.localhost$/.test(PREVIEW_HOSTNAME) ||
      !Number.isSafeInteger(Number(PREVIEW_HOSTNAME.split(".")[0].slice(4)))))
) {
  throw new Error("Invalid preview hostname");
}
let previewOrigin;
let rememberedOrigin = null; // e.g. "http://localhost:5173"
let rememberedBaseUrl = null;
const fixedHeaders = workerData?.fixedHeaders || {};
const authBootstrapToken = workerData?.authBootstrapToken;
// Shared-localhost previews share one cookie jar across ports, so apps that
// use the same cookie name (e.g. Neon Auth's session token) overwrite each
// other's sessions. When set (e.g. "dyad-a12."), HttpOnly cookies are renamed
// with this prefix at the browser boundary and restored on the way upstream.
// Page scripts cannot read HttpOnly cookies, so the app never sees the rename.
const COOKIE_NAMESPACE = workerData?.cookieNamespace;
if (
  COOKIE_NAMESPACE !== undefined &&
  (typeof COOKIE_NAMESPACE !== "string" ||
    !/^dyad-a[1-9]\d*\.$/.test(COOKIE_NAMESPACE))
) {
  throw new Error("Invalid cookie namespace");
}
const NAMESPACED_COOKIE_RE = /^dyad-a[1-9]\d*\./;
// Keep security prefixes first; moving __Host- behind the namespace disables
// Chromium's host-only and Path=/ enforcement (including script writes).
const COOKIE_SECURITY_PREFIX_RE = /^__(?:Host-Http-|Host-|Secure-|Http-)/i;

function namespaceCookieName(name) {
  const prefix = COOKIE_SECURITY_PREFIX_RE.exec(name)?.[0] ?? "";
  return prefix + COOKIE_NAMESPACE + name.slice(prefix.length);
}

/* ---------- pre-configure rememberedOrigin from workerData ------- */
{
  const fixed = workerData?.targetOrigin;
  if (fixed) {
    try {
      rememberedBaseUrl = new URL(fixed);
      rememberedOrigin = rememberedBaseUrl.origin;
      parentPort?.postMessage(
        `[proxy-worker] fixed upstream origin: ${rememberedOrigin}`,
      );
    } catch {
      throw new Error(
        `Invalid target origin "${fixed}". Must be absolute http/https URL.`,
      );
    }
  }
}

/* ---------- optional resources for HTML injection ---------------------- */

let stacktraceJsContent = null;
let dyadShimContent = null;
let dyadComponentSelectorClientContent = null;
let dyadRecorderClientContent = null;
let dyadAuthBootstrapContent = null;
let dyadScreenshotClientContent = null;
let htmlToImageContent = null;
let dyadVisualEditorClientContent = null;
let dyadLogsContent = null;

try {
  const htmlToImagePath = path.join(
    __dirname,
    "..",
    "node_modules",
    "html-to-image",
    "dist",
    "html-to-image.js",
  );
  htmlToImageContent = fs.readFileSync(htmlToImagePath, "utf-8");
  parentPort?.postMessage(
    `[proxy-worker] html-to-image.js loaded from: ${htmlToImagePath}`,
  );
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read html-to-image.js: ${error.message}`,
  );
}

try {
  const stackTraceLibPath = path.join(
    __dirname,
    "..",
    "node_modules",
    "stacktrace-js",
    "dist",
    "stacktrace.min.js",
  );
  stacktraceJsContent = fs.readFileSync(stackTraceLibPath, "utf-8");
  parentPort?.postMessage("[proxy-worker] stacktrace.js loaded.");
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read stacktrace.js: ${error.message}`,
  );
}

try {
  const dyadShimPath = path.join(__dirname, "dyad-shim.js");
  dyadShimContent = fs.readFileSync(dyadShimPath, "utf-8");
  parentPort?.postMessage("[proxy-worker] dyad-shim.js loaded.");
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad-shim.js: ${error.message}`,
  );
}

try {
  const dyadComponentSelectorClientPath = path.join(
    __dirname,
    "dyad-component-selector-client.js",
  );
  dyadComponentSelectorClientContent = fs.readFileSync(
    dyadComponentSelectorClientPath,
    "utf-8",
  );
  parentPort?.postMessage(
    "[proxy-worker] dyad-component-selector-client.js loaded.",
  );
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad-component-selector-client.js: ${error.message}`,
  );
}

try {
  const dyadRecorderClientPath = path.join(
    __dirname,
    "dyad-recorder-client.js",
  );
  dyadRecorderClientContent = fs.readFileSync(dyadRecorderClientPath, "utf-8");
  parentPort?.postMessage("[proxy-worker] dyad-recorder-client.js loaded.");
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad-recorder-client.js: ${error.message}`,
  );
}

try {
  const dyadAuthBootstrapPath = path.join(__dirname, "dyad-auth-bootstrap.js");
  dyadAuthBootstrapContent = fs.readFileSync(dyadAuthBootstrapPath, "utf-8");
  parentPort?.postMessage("[proxy-worker] dyad-auth-bootstrap.js loaded.");
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad-auth-bootstrap.js: ${error.message}`,
  );
}

try {
  const dyadScreenshotClientPath = path.join(
    __dirname,
    "dyad-screenshot-client.js",
  );
  dyadScreenshotClientContent = fs.readFileSync(
    dyadScreenshotClientPath,
    "utf-8",
  );
  parentPort?.postMessage("[proxy-worker] dyad-screenshot-client.js loaded.");
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad-screenshot-client.js: ${error.message}`,
  );
}

try {
  const dyadVisualEditorClientPath = path.join(
    __dirname,
    "dyad-visual-editor-client.js",
  );
  dyadVisualEditorClientContent = fs.readFileSync(
    dyadVisualEditorClientPath,
    "utf-8",
  );
  parentPort?.postMessage(
    "[proxy-worker] dyad-visual-editor-client.js loaded.",
  );
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad-visual-editor-client.js: ${error.message}`,
  );
}

try {
  const dyadLogsPath = path.join(__dirname, "dyad_logs.js");
  dyadLogsContent = fs.readFileSync(dyadLogsPath, "utf-8");
  parentPort?.postMessage("[proxy-worker] dyad_logs.js loaded.");
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad_logs.js: ${error.message}`,
  );
}

// Load Service Worker files
let dyadSwContent = null;
let dyadSwRegisterContent = null;

try {
  const dyadSwPath = path.join(__dirname, "dyad-sw.js");
  dyadSwContent = fs.readFileSync(dyadSwPath, "utf-8");
  parentPort?.postMessage("[proxy-worker] dyad-sw.js loaded.");
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad-sw.js: ${error.message}`,
  );
}

try {
  const dyadSwRegisterPath = path.join(__dirname, "dyad-sw-register.js");
  dyadSwRegisterContent = fs.readFileSync(dyadSwRegisterPath, "utf-8");
  parentPort?.postMessage("[proxy-worker] dyad-sw-register.js loaded.");
} catch (error) {
  parentPort?.postMessage(
    `[proxy-worker] Failed to read dyad-sw-register.js: ${error.message}`,
  );
}

/* ---------------------- helper: need to inject? ------------------------ */
function needsInjection(pathname) {
  // Inject for routes without a file extension (e.g., "/foo", "/foo/bar", "/")
  const ext = path.extname(pathname).toLowerCase();
  return ext === "" || ext === ".html";
}

function injectHTML(buf) {
  let txt = buf.toString("utf8");
  // These are strings that were used since the first version of the dyad shim.
  // If the dyad shim is used from legacy apps which came pre-baked with the shim
  // as a vite plugin, then do not inject the shim twice to avoid weird behaviors.
  const legacyAppWithShim =
    txt.includes("window-error") && txt.includes("unhandled-rejection");

  const scripts = [];
  // Both injected bridges read the same per-proxy capability before any app
  // script runs. Escape at the HTML boundary even though today's token is a
  // UUID so a future token-source change cannot create an attribute injection.
  const escapedProxyToken = String(authBootstrapToken || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (!legacyAppWithShim) {
    if (stacktraceJsContent) {
      scripts.push(`<script>${stacktraceJsContent}</script>`);
    } else {
      scripts.push(
        '<script>console.warn("[proxy-worker] stacktrace.js was not injected.");</script>',
      );
    }

    if (dyadShimContent) {
      scripts.push(`<script>${dyadShimContent}</script>`);
    } else {
      scripts.push(
        '<script>console.warn("[proxy-worker] dyad shim was not injected.");</script>',
      );
    }
  }
  if (dyadComponentSelectorClientContent) {
    scripts.push(`<script>${dyadComponentSelectorClientContent}</script>`);
  } else {
    scripts.push(
      '<script>console.warn("[proxy-worker] dyad component selector client was not injected.");</script>',
    );
  }
  if (dyadRecorderClientContent) {
    scripts.push(
      `<script data-dyad-recorder-token="${escapedProxyToken}">${dyadRecorderClientContent}</script>`,
    );
  } else {
    scripts.push(
      '<script>console.warn("[proxy-worker] dyad recorder client was not injected.");</script>',
    );
  }
  if (dyadAuthBootstrapContent) {
    scripts.push(
      `<script data-dyad-auth-token="${escapedProxyToken}">${dyadAuthBootstrapContent}</script>`,
    );
  } else {
    scripts.push(
      '<script>console.warn("[proxy-worker] dyad auth bootstrap was not injected.");</script>',
    );
  }
  if (htmlToImageContent) {
    scripts.push(`<script>${htmlToImageContent}</script>`);
    parentPort?.postMessage(
      "[proxy-worker] html-to-image script injected into HTML.",
    );
  } else {
    scripts.push(
      '<script>console.error("[proxy-worker] html-to-image was not injected - library not loaded.");</script>',
    );
    parentPort?.postMessage(
      "[proxy-worker] WARNING: html-to-image not injected!",
    );
  }
  if (dyadScreenshotClientContent) {
    scripts.push(`<script>${dyadScreenshotClientContent}</script>`);
  } else {
    scripts.push(
      '<script>console.warn("[proxy-worker] dyad screenshot client was not injected.");</script>',
    );
  }
  if (dyadVisualEditorClientContent) {
    scripts.push(`<script>${dyadVisualEditorClientContent}</script>`);
  } else {
    scripts.push(
      '<script>console.warn("[proxy-worker] dyad visual editor client was not injected.");</script>',
    );
  }
  if (dyadLogsContent) {
    scripts.push(`<script>${dyadLogsContent}</script>`);
  } else {
    scripts.push(
      '<script>console.warn("[proxy-worker] dyad_logs.js was not injected.");</script>',
    );
  }
  if (dyadSwRegisterContent) {
    scripts.push(`<script>${dyadSwRegisterContent}</script>`);
  } else {
    scripts.push(
      '<script>console.warn("[proxy-worker] dyad-sw-register.js was not injected.");</script>',
    );
  }
  const allScripts = scripts.join("\n");

  const headRegex = /<head[^>]*>/i;
  if (headRegex.test(txt)) {
    txt = txt.replace(headRegex, `$&\n${allScripts}`);
  } else {
    txt = allScripts + "\n" + txt;
    parentPort?.postMessage(
      "[proxy-worker] Warning: <head> tag not found – scripts prepended.",
    );
  }
  return Buffer.from(txt, "utf8");
}

/* ---------------- helper: build upstream URL from request -------------- */
function buildTargetURL(clientReq) {
  if (!rememberedOrigin || !rememberedBaseUrl)
    throw new Error("No upstream configured.");

  const incomingUrl = new URL(clientReq.url, rememberedOrigin);
  const basePath = rememberedBaseUrl.pathname.replace(/\/$/, "");
  let incomingPath = incomingUrl.pathname;

  if (
    basePath &&
    (incomingPath === basePath || incomingPath.startsWith(`${basePath}/`))
  ) {
    incomingPath = incomingPath.slice(basePath.length) || "/";
  }

  const targetPath =
    incomingPath === "/"
      ? rememberedBaseUrl.pathname
      : `${basePath}${incomingPath}`;

  return new URL(
    `${targetPath}${incomingUrl.search}`,
    rememberedBaseUrl.origin,
  );
}

/* ----------------------------------------------------------------------- */
/* Cookie rewriting for the embedded preview iframe                        */
/*                                                                         */
/* In a packaged build the Dyad shell loads from file://, a cross-site     */
/* top-level ancestor to the http://localhost preview. That makes the      */
/* request's "site for cookies" cross-site, so the browser withholds       */
/* default Lax/Strict cookies and auth sessions fail to stick. (Dev mode   */
/* hides this: the shell runs on http://localhost, same-site with the      */
/* preview.)                                                               */
/*                                                                         */
/* Fix: rewrite every forwarded Set-Cookie to                              */
/* `SameSite=None; Secure` so it's sent inside the iframe.                 */
/* (Secure is required by SameSite=None and honored over localhost.)       */
/* ----------------------------------------------------------------------- */
function rewriteCookieForIframe(cookieStr) {
  if (!cookieStr || typeof cookieStr !== "string") return cookieStr;
  // filter(Boolean) drops empty segments from leading/trailing/double semicolons
  // so we never emit a malformed header like "...; ; Secure".
  const parts = cookieStr
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return cookieStr;
  const nameValue = parts[0];
  // Host-only cookies isolate previews, including deletion cookies. Keep the
  // existing iframe SameSite handling for the packaged file:// shell.
  const attrs = parts.slice(1).filter((p) => {
    const name = cookieAttributeName(p);
    return (
      name !== "samesite" &&
      name !== "domain" &&
      name !== "secure" &&
      name !== "partitioned"
    );
  });
  attrs.push("Secure", "SameSite=None");
  return [nameValue, ...attrs].join("; ");
}

/* Browsers match attributes by name and ignore a flag attribute's value, so
   `HttpOnly=false` still sets HttpOnly. */
function cookieAttributeName(attr) {
  return attr.split("=", 1)[0].trim().toLowerCase();
}

const EXPIRY_ATTR_RE = /^(max-age|expires)\s*=\s*(.*)$/i;
const COOKIE_DATE_DELIMITER_RE = /[\x09\x20-\x2F\x3B-\x40\x5B-\x60\x7B-\x7E]+/;
const COOKIE_DATE_MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/* RFC 6265 §5.1.1 cookie-date parsing, which accepts dates such as
   `Wed@09@Jun@2021@10:18:14@GMT` that Date.parse rejects. Returns NaN for a
   date the browser would ignore. */
function parseCookieDate(value) {
  let time;
  let day;
  let month;
  let year;
  for (const token of value.split(COOKIE_DATE_DELIMITER_RE)) {
    if (!token) continue;
    const monthIndex = COOKIE_DATE_MONTHS.indexOf(
      token.slice(0, 3).toLowerCase(),
    );
    let match;
    if (
      time === undefined &&
      (match = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\D|$)/.exec(token))
    ) {
      time = match.slice(1, 4).map(Number);
    } else if (
      day === undefined &&
      (match = /^(\d{1,2})(?:\D|$)/.exec(token))
    ) {
      day = Number(match[1]);
    } else if (month === undefined && monthIndex !== -1) {
      month = monthIndex;
    } else if (
      year === undefined &&
      (match = /^(\d{2,4})(?:\D|$)/.exec(token))
    ) {
      year = Number(match[1]);
    }
  }
  if (
    time === undefined ||
    day === undefined ||
    month === undefined ||
    year === undefined
  )
    return NaN;
  if (year >= 70 && year <= 99) year += 1900;
  else if (year <= 69) year += 2000;
  const [hour, minute, second] = time;
  if (
    day < 1 ||
    day > 31 ||
    year < 1601 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return NaN;
  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  // Reject days past the end of the month, e.g. 31 Feb.
  return date.getUTCDate() === day ? date.getTime() : NaN;
}

/* RFC 6265 §5.3: the last of each attribute wins, and a valid Max-Age
   overrides Expires. A Max-Age that is not an integer, or an Expires that is
   not a cookie-date, is ignored. */
function isExpiringCookie(attrs) {
  let maxAge;
  let expiresAt;
  for (const p of attrs) {
    const match = EXPIRY_ATTR_RE.exec(p);
    if (!match) continue;
    const value = match[2].trim();
    if (match[1].toLowerCase() === "expires") {
      const parsed = parseCookieDate(value);
      if (!Number.isNaN(parsed)) expiresAt = parsed;
    } else if (/^-?\d+$/.test(value)) maxAge = Number(value);
  }
  if (maxAge !== undefined) return maxAge <= 0;
  return expiresAt !== undefined && expiresAt <= Date.now();
}

/* An unconditional deletion of `name` at the same path as `attrs`. */
function cookieDeletion(name, attrs) {
  return [
    `${name}=`,
    ...attrs.filter((p) => !EXPIRY_ATTR_RE.test(p)),
    "Max-Age=0",
  ].join("; ");
}

/**
 * Returns the Set-Cookie strings the browser should receive for one upstream
 * cookie. HttpOnly cookies are moved into this app's namespace. A deletion
 * also clears the legacy shared copy, otherwise subsequent requests can
 * fall back to the old session after the namespaced session is removed.
 */
function namespaceSetCookie(cookieStr) {
  if (!COOKIE_NAMESPACE) return [cookieStr];
  const [nameValue, ...attrs] = cookieStr.split("; ");
  const eq = nameValue.indexOf("=");
  if (eq <= 0) return [cookieStr];
  const name = nameValue.slice(0, eq);
  const namespaced = [
    namespaceCookieName(name) + nameValue.slice(eq),
    ...attrs,
  ].join("; ");
  if (isExpiringCookie(attrs)) {
    // Emit the shared-name copy as an unconditional deletion so a
    // misjudged expiry can never store a live session under the shared name.
    return [cookieDeletion(name, attrs), namespaced];
  }
  if (attrs.some((p) => cookieAttributeName(p) === "httponly"))
    return [namespaced];
  // A cookie that was HttpOnly and is now script-readable must retire this
  // app's namespaced copy, which would otherwise win on the way upstream.
  return [cookieDeletion(namespaceCookieName(name), attrs), cookieStr];
}

/* Rewrites the Set-Cookie header (an array in Node) in place on `headers`. */
function rewriteSetCookieHeaders(headers) {
  const sc = headers["set-cookie"];
  if (!sc) return headers;
  const list = Array.isArray(sc) ? sc : [sc];
  headers["set-cookie"] = list
    .map(rewriteCookieForIframe)
    .flatMap((cookie) =>
      typeof cookie === "string" ? namespaceSetCookie(cookie) : [cookie],
    );
  return headers;
}

/**
 * Restores this app's namespaced cookies before forwarding upstream and drops
 * every other app's. A namespaced cookie wins over a shared cookie of the same
 * name, which may be a stale session left by another app before namespacing.
 */
function rewriteRequestCookies(headers) {
  if (!COOKIE_NAMESPACE || !headers.cookie) return headers;
  const pairs = String(headers.cookie)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const restored = [];
  const restoredNames = new Set();
  const shared = [];
  for (const pair of pairs) {
    const prefix = COOKIE_SECURITY_PREFIX_RE.exec(pair)?.[0] ?? "";
    const unprefixed = pair.slice(prefix.length);
    if (unprefixed.startsWith(COOKIE_NAMESPACE)) {
      const originalNameValue = unprefixed.slice(COOKIE_NAMESPACE.length);
      // Never restore old cookies whose browser-visible name lost a security
      // prefix: scripts could have shadowed those at a narrower path.
      if (!prefix && COOKIE_SECURITY_PREFIX_RE.test(originalNameValue))
        continue;
      const original = prefix + originalNameValue;
      // Keep same-name copies (e.g. different paths), as the browser would.
      restoredNames.add(original.split("=", 1)[0]);
      restored.push(original);
    } else if (!NAMESPACED_COOKIE_RE.test(unprefixed)) {
      shared.push(pair);
    }
  }
  const forwarded = [
    ...restored,
    ...shared.filter((pair) => !restoredNames.has(pair.split("=", 1)[0])),
  ];
  if (forwarded.length) headers.cookie = forwarded.join("; ");
  else delete headers.cookie;
  return headers;
}

const PROXY_FRAME_ANCESTORS_CSP =
  "frame-ancestors 'self' file: http://localhost:* http://127.0.0.1:* http://[::1]:*";

function appendHeader(headers, name, value) {
  const lowerName = name.toLowerCase();
  const existingName =
    Object.keys(headers).find((key) => key.toLowerCase() === lowerName) ??
    lowerName;
  const existing = headers[existingName];

  if (existing === undefined) {
    headers[existingName] = value;
  } else if (Array.isArray(existing)) {
    headers[existingName] = [...existing, value];
  } else {
    headers[existingName] = [existing, value];
  }

  return headers;
}

function applyProxyFrameAncestorsCsp(headers) {
  // Separate CSP header means app-supplied policies keep enforcing unchanged.
  return appendHeader(
    headers,
    "content-security-policy",
    PROXY_FRAME_ANCESTORS_CSP,
  );
}

/* ----------------------------------------------------------------------- */
/* 1. Plain HTTP request / response                                        */
/* ----------------------------------------------------------------------- */

// Every app's namespaced cookies reach every shared-localhost port, so the
// Cookie header grows with the number of signed-in apps. Accept Chromium's
// whole per-host jar (180 cookies of up to 4 KiB) rather than Node's 16 KiB
// default; rewriteRequestCookies() drops other apps' before forwarding.
const MAX_REQUEST_HEADER_BYTES = 1024 * 1024;

const server = http.createServer(
  { maxHeaderSize: MAX_REQUEST_HEADER_BYTES },
  handleHttpRequest,
);

function handleHttpRequest(clientReq, clientRes) {
  if (!hasPreviewAuthority(clientReq)) {
    clientRes.writeHead(421, { "content-type": "text/plain" });
    clientRes.end("This preview belongs to a different app hostname.");
    return;
  }
  // Special handling for Service Worker file
  if (clientReq.url === "/dyad-sw.js") {
    if (dyadSwContent) {
      clientRes.writeHead(200, {
        "content-type": "application/javascript",
        "service-worker-allowed": "/",
        "cache-control": "no-cache",
      });
      clientRes.end(dyadSwContent);
      return;
    } else {
      clientRes.writeHead(404, { "content-type": "text/plain" });
      clientRes.end("Service Worker file not found");
      return;
    }
  }

  let target;
  try {
    target = buildTargetURL(clientReq);
  } catch (err) {
    clientRes.writeHead(400, { "content-type": "text/plain" });
    return void clientRes.end("Bad request: " + err.message);
  }

  const isTLS = target.protocol === "https:";
  const lib = isTLS ? https : http;

  /* Copy request headers but rewrite Host / Origin / Referer */
  const headers = { ...clientReq.headers, host: target.host, ...fixedHeaders };
  rewriteRequestCookies(headers);
  if (headers.origin) headers.origin = target.origin;
  if (headers.referer) {
    try {
      const ref = new URL(headers.referer);
      headers.referer = target.origin + ref.pathname + ref.search;
    } catch {
      delete headers.referer;
    }
  }
  if (needsInjection(target.pathname)) {
    // Request uncompressed content from upstream
    delete headers["accept-encoding"];
    // Avoid getting cached resources.
    delete headers["if-none-match"];
  }

  const upOpts = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isTLS ? 443 : 80),
    path: target.pathname + target.search,
    method: clientReq.method,
    headers,
  };

  const upReq = lib.request(upOpts, (upRes) => {
    rewriteRedirect(upRes.headers);
    const wantsInjection = needsInjection(target.pathname);
    // Only inject when upstream indicates HTML content
    const contentTypeHeader = upRes.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]
      : contentTypeHeader || "";
    const isHtml =
      typeof contentType === "string" &&
      contentType.toLowerCase().includes("text/html");
    const inject = wantsInjection && isHtml;

    if (!inject) {
      rewriteSetCookieHeaders(upRes.headers);
      applyProxyFrameAncestorsCsp(upRes.headers);
      clientRes.writeHead(upRes.statusCode, upRes.headers);
      return void upRes.pipe(clientRes);
    }

    const chunks = [];
    upRes.on("data", (c) => chunks.push(c));
    upRes.on("end", () => {
      try {
        const merged = Buffer.concat(chunks);
        const patched = injectHTML(merged);

        const hdrs = {
          ...upRes.headers,
          "content-length": Buffer.byteLength(patched),
        };
        // If we injected content, it's no longer encoded in the original way
        delete hdrs["content-encoding"];
        delete hdrs["transfer-encoding"];
        // Also, remove ETag as content has changed
        delete hdrs["etag"];
        // Never cache an injected document. The scripts above are stamped with
        // this proxy instance's capability token, and a restart mints a new one
        // — so a cached copy carries a token the proxy no longer honors, and
        // recorder control and `dyad-auth-login` messages sent with it are
        // rejected with nothing on screen explaining why. `last-modified` and
        // `expires` go too: left behind they still permit heuristic freshness
        // and conditional revalidation into the same stale document.
        delete hdrs["last-modified"];
        delete hdrs["expires"];
        hdrs["cache-control"] = "no-store, must-revalidate";
        rewriteSetCookieHeaders(hdrs);
        applyProxyFrameAncestorsCsp(hdrs);

        clientRes.writeHead(upRes.statusCode, hdrs);
        clientRes.end(patched);
      } catch (e) {
        clientRes.writeHead(500, { "content-type": "text/plain" });
        clientRes.end("Injection failed: " + e.message);
      }
    });
  });

  clientReq.pipe(upReq);
  upReq.on("error", (e) => {
    clientRes.writeHead(502, { "content-type": "text/plain" });
    clientRes.end("Upstream error: " + e.message);
  });
}

/* ----------------------------------------------------------------------- */
/* 2. WebSocket / generic Upgrade tunnelling                             */
/* ----------------------------------------------------------------------- */

server.on("upgrade", (req, socket, _head) => {
  // Chromium tears down HMR sockets during navigation/reload. Once upgraded,
  // raw sockets no longer have HTTP's error handling; a reset must only close
  // this tunnel, never crash the app's proxy worker.
  let upstreamSocket;
  socket.on("error", () => {
    upstreamSocket?.destroy();
    socket.destroy();
  });
  socket.on("close", () => upstreamSocket?.destroy());
  if (!hasPreviewAuthority(req)) {
    socket.end("HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\n\r\n");
    return;
  }
  // Browser WebSockets carry cookies without CORS preflight. Never turn a
  // foreign Origin into a trusted upstream Origin. Non-browser clients may
  // omit Origin, but browsers (including HMR) must use this preview's origin.
  if (req.headers.origin && req.headers.origin !== previewOrigin) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  let target;
  try {
    target = buildTargetURL(req);
  } catch (err) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n" + err.message);
    return socket.destroy();
  }

  const isTLS = target.protocol === "https:";
  const headers = { ...req.headers, host: target.host, ...fixedHeaders };
  rewriteRequestCookies(headers);
  if (headers.origin) headers.origin = target.origin;

  const upReq = (isTLS ? https : http).request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isTLS ? 443 : 80),
    path: target.pathname + target.search,
    method: "GET",
    headers,
  });

  upReq.on("upgrade", (upRes, upSocket, upHead) => {
    upstreamSocket = upSocket;
    upSocket.on("error", () => socket.destroy());
    upSocket.on("close", () => socket.destroy());
    if (socket.destroyed) {
      upSocket.destroy();
      return;
    }
    rewriteSetCookieHeaders(upRes.headers);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        Object.entries(upRes.headers)
          .flatMap(([k, v]) =>
            (Array.isArray(v) ? v : [v]).map((value) => `${k}: ${value}`),
          )
          .join("\r\n") +
        "\r\n\r\n",
    );
    if (upHead && upHead.length) socket.write(upHead);
    if (_head && _head.length) upSocket.write(_head);

    upSocket.pipe(socket).pipe(upSocket);
  });

  upReq.on("error", () => socket.destroy());
  upReq.end();
});

/* ----------------------------------------------------------------------- */

// Prefer the deterministic port (LISTEN_PORT). If it is already in use, scan
// the fallback band upward instead of evicting whatever already holds the port.
const FALLBACK_PORT_START = workerData?.fallbackPortStart || LISTEN_PORT + 1;
const MAX_PORT_ATTEMPTS = workerData?.maxPortAttempts || 50;

function listenWithFallback(port, nextFallback, attemptsLeft) {
  function onError(err) {
    if (err && err.code === "EADDRINUSE" && attemptsLeft > 1) {
      parentPort?.postMessage(
        `[proxy-worker] port ${port} in use, trying ${nextFallback}`,
      );
      listenWithFallback(nextFallback, nextFallback + 1, attemptsLeft - 1);
      return;
    }
    parentPort?.postMessage(
      `proxy-server-error code=${err?.code || "UNKNOWN"} base=${LISTEN_PORT} lastTried=${port}`,
    );
  }

  server.once("error", onError);
  server.listen(port, LISTEN_HOST, () => {
    server.removeListener("error", onError);
    const boundPort = server.address()?.port ?? port;
    previewOrigin = `http://${PREVIEW_HOSTNAME}:${boundPort}`;
    parentPort?.postMessage(`proxy-server-start url=${previewOrigin}`);
  });
}

listenWithFallback(LISTEN_PORT, FALLBACK_PORT_START, MAX_PORT_ATTEMPTS);

function hasPreviewAuthority(req) {
  // Never forward cookies received through localhost, another app's name, or
  // a conflicting absolute-form request target.
  if (
    !previewOrigin ||
    req.headers.host?.toLowerCase() !== new URL(previewOrigin).host
  ) {
    return false;
  }
  try {
    return new URL(req.url, previewOrigin).origin === previewOrigin;
  } catch {
    return false;
  }
}

function rewriteRedirect(headers) {
  // Relative redirects already resolve on the public origin (and must retain
  // their request-relative path semantics).
  if (!headers.location || !/^(https?:)?\/\//i.test(headers.location)) return;
  try {
    const location = new URL(headers.location, rememberedOrigin);
    if (location.origin === rememberedOrigin) {
      headers.location =
        previewOrigin + location.pathname + location.search + location.hash;
    }
  } catch {
    // Leave malformed upstream redirects to the browser.
  }
}
