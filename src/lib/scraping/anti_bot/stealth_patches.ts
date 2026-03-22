/**
 * Stealth Patches — Anti-detection scripts injected via page.evaluateOnNewDocument.
 *
 * These patches make Playwright-controlled Chromium indistinguishable from
 * a real user's browser for most bot-detection systems including Cloudflare,
 * Akamai, DataDome, PerimeterX, and Imperva.
 */

import type { Page } from "playwright-core";
import type { StealthConfig } from "../types";

export interface StealthContext {
  page: Page;
  config: StealthConfig;
  userAgent: string;
}

/**
 * Apply all enabled stealth patches to the page.
 * Must be called BEFORE page.goto().
 */
export async function applyStealthPatches(ctx: StealthContext): Promise<void> {
  const { page, config } = ctx;

  if (config.spoofWebdriver) {
    await page.addInitScript(patchWebdriver);
  }
  if (config.spoofPlugins) {
    await page.addInitScript(patchPlugins);
  }
  if (config.spoofLanguages) {
    await page.addInitScript(patchLanguages);
  }
  if (config.spoofChrome) {
    await page.addInitScript(patchChrome);
  }
  if (config.spoofPermissions) {
    await page.addInitScript(patchPermissions);
  }
  if (config.randomizeCanvas) {
    await page.addInitScript(patchCanvas);
  }
  if (config.randomizeAudioContext) {
    await page.addInitScript(patchAudioContext);
  }
  if (config.spoofWebGL) {
    await page.addInitScript(patchWebGL);
  }
  if (config.spoofScreen) {
    await page.addInitScript(patchScreen);
  }
}

// ── Individual patch functions ──────────────────────────────────────────────

function patchWebdriver() {
  // Remove navigator.webdriver flag
  Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
  });

  // Also handle the deprecated __webdriver detection
  // @ts-ignore
  delete navigator.__proto__.webdriver;
}

function patchPlugins() {
  // Override navigator.plugins with realistic Chrome plugin list
  Object.defineProperty(navigator, "plugins", {
    get: () => {
      const plugins = [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
        { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
      ];
      const pluginArray = Object.create(PluginArray.prototype);
      for (let i = 0; i < plugins.length; i++) {
        const p = Object.create(Plugin.prototype);
        Object.defineProperties(p, {
          name: { value: plugins[i].name, enumerable: true },
          filename: { value: plugins[i].filename, enumerable: true },
          description: { value: plugins[i].description, enumerable: true },
          length: { value: 0, enumerable: true },
        });
        Object.defineProperty(pluginArray, i, { value: p, enumerable: true });
      }
      Object.defineProperty(pluginArray, "length", { value: plugins.length, enumerable: true });
      return pluginArray;
    },
  });

  // Match mimeTypes to plugins
  Object.defineProperty(navigator, "mimeTypes", {
    get: () => {
      const mimeTypes = Object.create(MimeTypeArray.prototype);
      Object.defineProperty(mimeTypes, "length", { value: 2, enumerable: true });
      return mimeTypes;
    },
  });
}

function patchLanguages() {
  Object.defineProperty(navigator, "languages", {
    get: () => ["en-US", "en"],
  });
  Object.defineProperty(navigator, "language", {
    get: () => "en-US",
  });
}

function patchChrome() {
  // Create a convincing window.chrome object
  // @ts-ignore
  if (!window.chrome) {
    // @ts-ignore
    window.chrome = {};
  }
  // @ts-ignore
  window.chrome.runtime = {
    // @ts-ignore
    PlatformOs: { MAC: "mac", WIN: "win", ANDROID: "android", CROS: "cros", LINUX: "linux", OPENBSD: "openbsd" },
    // @ts-ignore
    PlatformArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64", MIPS: "mips", MIPS64: "mips64" },
    // @ts-ignore
    PlatformNaclArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64", MIPS: "mips", MIPS64: "mips64" },
    // @ts-ignore
    RequestUpdateCheckStatus: { THROTTLED: "throttled", NO_UPDATE: "no_update", UPDATE_AVAILABLE: "update_available" },
    // @ts-ignore
    OnInstalledReason: { INSTALL: "install", UPDATE: "update", CHROME_UPDATE: "chrome_update", SHARED_MODULE_UPDATE: "shared_module_update" },
    // @ts-ignore
    OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
    connect: () => {},
    sendMessage: () => {},
    id: undefined,
  };

  // @ts-ignore
  window.chrome.loadTimes = function () {
    return {
      commitLoadTime: Date.now() / 1000 - Math.random() * 5,
      connectionInfo: "h2",
      finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 2,
      finishLoadTime: Date.now() / 1000 - Math.random(),
      firstPaintAfterLoadTime: 0,
      firstPaintTime: Date.now() / 1000 - Math.random() * 3,
      navigationType: "Other",
      npnNegotiatedProtocol: "h2",
      requestTime: Date.now() / 1000 - Math.random() * 5,
      startLoadTime: Date.now() / 1000 - Math.random() * 5,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    };
  };

  // @ts-ignore
  window.chrome.csi = function () {
    return {
      onloadT: Date.now(),
      startE: Date.now() - Math.floor(Math.random() * 1000),
      pageT: Math.random() * 5000,
      tran: 15,
    };
  };
}

function patchPermissions() {
  // Override Permissions.query to not reveal automation
  const originalQuery = window.Permissions?.prototype?.query;
  if (originalQuery) {
    // @ts-ignore
    window.Permissions.prototype.query = function (params: any) {
      if (params?.name === "notifications") {
        return Promise.resolve({ state: "denied", onchange: null } as PermissionStatus);
      }
      return originalQuery.call(this, params);
    };
  }
}

function patchCanvas() {
  // Add subtle noise to canvas fingerprint
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

  // Generate a consistent per-session noise seed
  const noiseSeed = Math.floor(Math.random() * 1000000);

  HTMLCanvasElement.prototype.toDataURL = function (...args: any[]) {
    const ctx = this.getContext("2d");
    if (ctx) {
      // Add imperceptible noise to a random pixel
      const x = noiseSeed % (this.width || 1);
      const y = noiseSeed % (this.height || 1);
      const pixel = ctx.getImageData(x, y, 1, 1);
      pixel.data[0] = (pixel.data[0] + (noiseSeed % 3)) % 256;
      ctx.putImageData(pixel, x, y);
    }
    return originalToDataURL.apply(this, args as any);
  };

  HTMLCanvasElement.prototype.toBlob = function (...args: any[]) {
    const ctx = this.getContext("2d");
    if (ctx) {
      const x = noiseSeed % (this.width || 1);
      const y = noiseSeed % (this.height || 1);
      const pixel = ctx.getImageData(x, y, 1, 1);
      pixel.data[1] = (pixel.data[1] + (noiseSeed % 5)) % 256;
      ctx.putImageData(pixel, x, y);
    }
    return originalToBlob.apply(this, args as any);
  };

  CanvasRenderingContext2D.prototype.getImageData = function (...args: any[]) {
    const imageData = originalGetImageData.apply(this, args as any);
    // Add subtle noise to a few pixels
    for (let i = 0; i < 4; i++) {
      const idx = ((noiseSeed + i * 7) % (imageData.data.length / 4)) * 4;
      imageData.data[idx] = (imageData.data[idx] + (noiseSeed % 2)) % 256;
    }
    return imageData;
  };
}

function patchAudioContext() {
  // Add noise to AudioContext fingerprinting
  const origGetFloatFrequencyData = AnalyserNode?.prototype?.getFloatFrequencyData;
  if (origGetFloatFrequencyData) {
    AnalyserNode.prototype.getFloatFrequencyData = function (array: Float32Array) {
      origGetFloatFrequencyData.call(this, array as any);
      for (let i = 0; i < array.length; i++) {
        array[i] += (Math.random() - 0.5) * 0.001;
      }
    };
  }

  const origGetChannelData = AudioBuffer?.prototype?.getChannelData;
  if (origGetChannelData) {
    AudioBuffer.prototype.getChannelData = function (channel: number) {
      const data = origGetChannelData.call(this, channel);
      // Add tiny noise to prevent fingerprinting
      for (let i = 0; i < Math.min(data.length, 10); i++) {
        data[i] += (Math.random() - 0.5) * 0.00001;
      }
      return data;
    };
  }
}

function patchWebGL() {
  const getParameter = WebGLRenderingContext?.prototype?.getParameter;
  if (!getParameter) return;

  const UNMASKED_VENDOR = 0x9245;
  const UNMASKED_RENDERER = 0x9246;

  const vendors = [
    "Google Inc. (NVIDIA)",
    "Google Inc. (Intel)",
    "Google Inc. (AMD)",
  ];
  const renderers = [
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  ];

  const idx = Math.floor(Math.random() * vendors.length);

  WebGLRenderingContext.prototype.getParameter = function (param: number) {
    if (param === UNMASKED_VENDOR) return vendors[idx];
    if (param === UNMASKED_RENDERER) return renderers[idx];
    return getParameter.call(this, param);
  };

  // Do the same for WebGL2
  const getParameter2 = WebGL2RenderingContext?.prototype?.getParameter;
  if (getParameter2) {
    WebGL2RenderingContext.prototype.getParameter = function (param: number) {
      if (param === UNMASKED_VENDOR) return vendors[idx];
      if (param === UNMASKED_RENDERER) return renderers[idx];
      return getParameter2.call(this, param);
    };
  }
}

function patchScreen() {
  // Spoof screen properties to realistic values
  const screenProps: Record<string, number> = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
  };

  for (const [prop, value] of Object.entries(screenProps)) {
    Object.defineProperty(screen, prop, { get: () => value });
  }

  // Spoof deviceMemory
  Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });

  // Spoof hardwareConcurrency
  Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });

  // Spoof connection info
  // @ts-ignore
  if (navigator.connection) {
    // @ts-ignore
    Object.defineProperty(navigator.connection, "rtt", { get: () => 50 });
    // @ts-ignore
    Object.defineProperty(navigator.connection, "downlink", { get: () => 10 });
  }
}
