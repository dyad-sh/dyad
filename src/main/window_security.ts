import type {
  BrowserWindowConstructorOptions,
  HandlerDetails,
  WindowOpenHandlerResponse,
} from "electron";

const RELEASE_NOTES_ORIGINS = new Set([
  "https://dyad.sh",
  "https://www.dyad.sh",
]);
const RESERVED_FRAME_NAMES = new Set([
  "_parent",
  "_self",
  "_top",
  "_unfencedtop",
]);
const TRUE_FEATURE_VALUES = new Set(["1", "true", "yes"]);
const FALSE_FEATURE_VALUES = new Set(["0", "false", "no"]);

type WindowOpenDetails = Pick<
  HandlerDetails,
  "features" | "frameName" | "referrer" | "url"
>;

export function isAllowedMainWindowNavigation(
  targetUrl: string,
  devServerUrl: string | undefined,
  packagedRendererUrl: string,
): boolean {
  if (devServerUrl) {
    try {
      return new URL(targetUrl).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  try {
    const target = new URL(targetUrl);
    const packaged = new URL(packagedRendererUrl);
    return (
      target.protocol === "file:" &&
      target.protocol === packaged.protocol &&
      target.host === "" &&
      target.host === packaged.host &&
      target.pathname === packaged.pathname
    );
  } catch {
    return false;
  }
}

export function shouldBlockMainWindowNavigation(
  targetUrl: string,
  isMainFrame: boolean,
  devServerUrl: string | undefined,
  packagedRendererUrl: string,
): boolean {
  return (
    isMainFrame &&
    !isAllowedMainWindowNavigation(targetUrl, devServerUrl, packagedRendererUrl)
  );
}

function featureBoolean(value: string | undefined): boolean | null {
  if (value === undefined || value === "") {
    return true;
  }
  const normalizedValue = value.trim().toLowerCase();
  if (TRUE_FEATURE_VALUES.has(normalizedValue)) {
    return true;
  }
  if (FALSE_FEATURE_VALUES.has(normalizedValue)) {
    return false;
  }
  return null;
}

function requestsUnsafePopupPreferences(features: string): boolean {
  for (const feature of features.split(",")) {
    const [rawName, ...rawValueParts] = feature.split("=");
    const name = rawName.trim().toLowerCase();
    const value = featureBoolean(rawValueParts.join("="));

    if (name === "preload") {
      return true;
    }
    if (
      [
        "allowrunninginsecurecontent",
        "nodeintegration",
        "nodeintegrationinsubframes",
        "nodeintegrationinworker",
        "webviewtag",
      ].includes(name) &&
      value !== false
    ) {
      return true;
    }
    if (
      ["contextisolation", "sandbox", "websecurity"].includes(name) &&
      value !== true
    ) {
      return true;
    }
  }
  return false;
}

function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isPreviewReferrer(
  referrerUrl: string,
  devServerUrl: string | undefined,
): boolean {
  if (!isHttpUrl(referrerUrl)) {
    return false;
  }
  const referrer = new URL(referrerUrl);
  if (RELEASE_NOTES_ORIGINS.has(referrer.origin)) {
    return false;
  }
  if (devServerUrl) {
    try {
      if (referrer.origin === new URL(devServerUrl).origin) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Electron does not expose the initiating WebFrameMain to this handler. Treat
 * a request as a preview popup only when the browser supplies a non-Dyad HTTP
 * referrer, the target is another HTTP(S) document, and the request does not
 * ask Electron for privileged window features. Missing referrers fail closed.
 */
export function getWindowOpenHandlerResponse(
  details: WindowOpenDetails,
  devServerUrl: string | undefined,
): WindowOpenHandlerResponse {
  const normalizedFrameName = details.frameName.trim().toLowerCase();
  if (
    RESERVED_FRAME_NAMES.has(normalizedFrameName) ||
    /[\0\r\n]/.test(details.frameName) ||
    !isHttpUrl(details.url) ||
    !isPreviewReferrer(details.referrer.url, devServerUrl) ||
    requestsUnsafePopupPreferences(details.features)
  ) {
    return { action: "deny" };
  }

  return {
    action: "allow",
    overrideBrowserWindowOptions: {
      webPreferences: {
        allowRunningInsecureContent: false,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    },
  };
}

/**
 * The options Electron passes to createWindow can contain inherited main
 * window preferences. Remove the privileged preload explicitly, then force
 * the security settings again before constructing the preview popup.
 */
export function securePreviewPopupOptions(
  options: BrowserWindowConstructorOptions,
): BrowserWindowConstructorOptions {
  const { preload: _privilegedPreload, ...inheritedPreferences } =
    options.webPreferences ?? {};
  return {
    ...options,
    webPreferences: {
      ...inheritedPreferences,
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  };
}
