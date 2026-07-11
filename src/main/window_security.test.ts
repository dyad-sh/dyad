import { describe, expect, it } from "vitest";
import {
  getWindowOpenHandlerResponse,
  isAllowedMainWindowNavigation,
  securePreviewPopupOptions,
  shouldBlockMainWindowNavigation,
} from "./window_security";

const DEV_SERVER_URL = "http://localhost:5173";
const PACKAGED_RENDERER_URL = "file:///app/renderer/main_window/index.html";

function popupDetails(
  overrides: Partial<{
    features: string;
    frameName: string;
    referrerUrl: string;
    url: string;
  }> = {},
) {
  return {
    features: overrides.features ?? "popup,width=520,height=720",
    frameName: overrides.frameName ?? "oauth-popup",
    referrer: {
      policy: "strict-origin-when-cross-origin" as const,
      url: overrides.referrerUrl ?? "http://localhost:3210/login",
    },
    url: overrides.url ?? "https://accounts.example/authorize",
  };
}

describe("main window navigation security", () => {
  it("allows the configured Vite origin and blocks attacker navigation", () => {
    expect(
      isAllowedMainWindowNavigation(
        "http://localhost:5173/notes",
        DEV_SERVER_URL,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(true);
    expect(
      isAllowedMainWindowNavigation(
        "https://attacker.example/payload",
        DEV_SERVER_URL,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(false);
    expect(
      isAllowedMainWindowNavigation(
        "http://localhost:5174/notes",
        DEV_SERVER_URL,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(false);
  });

  it("requires the exact packaged file location", () => {
    expect(
      isAllowedMainWindowNavigation(
        `${PACKAGED_RENDERER_URL}?theme=dark#notes`,
        undefined,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(true);
    expect(
      isAllowedMainWindowNavigation(
        "file:///tmp/payload.html",
        undefined,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(false);
    expect(
      isAllowedMainWindowNavigation(
        "https://attacker.example/app/renderer/main_window/index.html",
        undefined,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(false);
    expect(
      isAllowedMainWindowNavigation(
        "file://attacker.example/app/renderer/main_window/index.html",
        undefined,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(false);
  });

  it("ignores subframe redirects but blocks untrusted main-frame navigation", () => {
    expect(
      shouldBlockMainWindowNavigation(
        "https://preview.example/redirected",
        false,
        DEV_SERVER_URL,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(false);
    expect(
      shouldBlockMainWindowNavigation(
        "https://attacker.example/payload",
        true,
        DEV_SERVER_URL,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(true);
    expect(
      shouldBlockMainWindowNavigation(
        "http://localhost:5173/settings",
        true,
        DEV_SERVER_URL,
        PACKAGED_RENDERER_URL,
      ),
    ).toBe(false);
  });
});

describe("preview popup security", () => {
  it.each([
    ["oauth-popup", "popup,width=520,height=720"],
    ["_blank", "noopener,width=520,height=720"],
    ["payment", "popup,nodeIntegration=no,contextIsolation=yes"],
  ])(
    "allows HTTP(S) preview popup target %s with forced unprivileged preferences",
    (frameName, features) => {
      const response = getWindowOpenHandlerResponse(
        popupDetails({ frameName, features }),
        DEV_SERVER_URL,
      );

      expect(response.action).toBe("allow");
      expect(response.overrideBrowserWindowOptions?.webPreferences).toEqual(
        expect.objectContaining({
          allowRunningInsecureContent: false,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          nodeIntegrationInWorker: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        }),
      );
    },
  );

  it.each([
    ["the development renderer", "http://localhost:5173/settings"],
    ["a packaged renderer route", "file:///chat?chatId=42"],
    [
      "release notes",
      "https://www.dyad.sh/docs/releases/0.30.0?hideHeader=true",
    ],
    ["a missing referrer", ""],
  ])("denies popups referred by %s", (_label, referrerUrl) => {
    expect(
      getWindowOpenHandlerResponse(
        popupDetails({ referrerUrl }),
        DEV_SERVER_URL,
      ),
    ).toEqual({ action: "deny" });
  });

  it.each([
    ["about:blank", "_blank", "popup"],
    ["file:///tmp/payload.html", "_blank", "popup"],
    ["https://accounts.example/authorize", "_top", "popup"],
    ["https://accounts.example/authorize", "_unfencedTop", "popup"],
    [
      "https://accounts.example/authorize",
      "oauth-popup",
      "popup,nodeIntegration=yes",
    ],
    [
      "https://accounts.example/authorize",
      "oauth-popup",
      "popup,contextIsolation=no",
    ],
    [
      "https://accounts.example/authorize",
      "oauth-popup",
      "popup,preload=/tmp/payload.js",
    ],
  ])(
    "denies ambiguous or privileged popup request %#",
    (url, frameName, features) => {
      expect(
        getWindowOpenHandlerResponse(
          popupDetails({ url, frameName, features }),
          DEV_SERVER_URL,
        ),
      ).toEqual({ action: "deny" });
    },
  );

  it("removes inherited preload access before constructing a popup", () => {
    const secured = securePreviewPopupOptions({
      title: "OAuth",
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
        preload: "/app/privileged-preload.js",
      },
    });

    expect(secured.title).toBe("OAuth");
    expect(secured.webPreferences).not.toHaveProperty("preload");
    expect(secured.webPreferences).toEqual(
      expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      }),
    );
  });
});
