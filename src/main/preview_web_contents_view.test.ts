import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

type Listener = (...args: any[]) => void;

const h = vi.hoisted(() => {
  class FakeEmitter {
    listeners = new Map<string, Listener[]>();

    on(event: string, fn: Listener) {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
      return this;
    }

    once(event: string, fn: Listener) {
      return this.on(event, fn);
    }

    removeListener(event: string, fn: Listener) {
      const list = this.listeners.get(event) ?? [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
      return this;
    }

    emit(event: string, ...args: any[]) {
      // Copy first: a listener may remove itself while the event is dispatched.
      for (const fn of (this.listeners.get(event) ?? []).slice()) fn(...args);
    }

    listenerCount(event: string) {
      return (this.listeners.get(event) ?? []).length;
    }
  }

  class FakeViewContents extends FakeEmitter {
    destroyed = false;
    loading = false;
    url = "";
    back = false;
    forward = false;
    screenshotSequence = 0;
    windowOpenHandler: ((details: { url: string }) => unknown) | null = null;
    session = {
      clearStorageData: vi.fn(async () => {}),
    };

    loadURL = vi.fn(async (url: string) => {
      this.url = url;
    });
    close = vi.fn(() => {
      this.destroyed = true;
    });
    reload = vi.fn();
    capturePage = vi.fn(async () => {
      const dataUrl = `data:image/png;base64,screenshot-${++this.screenshotSequence}`;
      return {
        isEmpty: () => false,
        toDataURL: () => dataUrl,
      };
    });
    setWindowOpenHandler = vi.fn(
      (fn: (details: { url: string }) => unknown) => {
        this.windowOpenHandler = fn;
      },
    );

    navigationHistory = {
      canGoBack: () => this.back,
      canGoForward: () => this.forward,
      goBack: vi.fn(),
      goForward: vi.fn(),
    };

    isDestroyed = () => this.destroyed;
    isLoading = () => this.loading;
    getURL = () => this.url;
  }

  const createdViews: FakeWebContentsView[] = [];

  class FakeWebContentsView {
    webContents = new FakeViewContents();
    setBounds = vi.fn();
    setVisible = vi.fn();
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
      createdViews.push(this);
    }
  }

  const shell = { openExternal: vi.fn(async () => {}) };

  return {
    FakeEmitter,
    FakeViewContents,
    FakeWebContentsView,
    createdViews,
    shell,
  };
});

vi.mock("electron", () => ({
  WebContentsView: h.FakeWebContentsView,
  shell: h.shell,
  app: {
    getPath: vi.fn(() => "/tmp/dyad-preview-view-test"),
    getAppPath: vi.fn(() => process.cwd()),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

import {
  beginPreviewAutomation,
  getPreviewViewStatus,
  hidePreviewView,
  isSupportedPreviewUrl,
  waitForPreviewView,
  previewViewGoBack,
  previewViewGoForward,
  previewViewReload,
  resetPreviewViewsForTesting,
  setPreviewViewBounds,
  setPreviewViewOverlayActive,
  showPreviewView,
} from "./preview_web_contents_view";
import { previewViewEvents } from "@/ipc/types/preview_view";

const APP_URL = "http://localhost:42101/";
const BOUNDS = { x: 10, y: 20, width: 300, height: 400 };

let nextWebContentsId = 1;

class FakeHostContents extends h.FakeEmitter {
  id = nextWebContentsId++;
  sent: Array<{ channel: string; payload: unknown }> = [];
  destroyed = false;

  send = (channel: string, payload: unknown) => {
    this.sent.push({ channel, payload });
  };
  isDestroyed = () => this.destroyed;
  isCrashed = () => false;
}

class FakeWindow extends h.FakeEmitter {
  webContents = new FakeHostContents();
  destroyed = false;
  contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  };

  isDestroyed = () => this.destroyed;
}

function createWindow() {
  const window = new FakeWindow();
  return { window, asBrowserWindow: window as unknown as BrowserWindow };
}

function latestView() {
  return h.createdViews[h.createdViews.length - 1];
}

function sentOn(window: FakeWindow, channel: string) {
  return window.webContents.sent.filter((entry) => entry.channel === channel);
}

beforeEach(() => {
  resetPreviewViewsForTesting();
  h.createdViews.length = 0;
  h.shell.openExternal.mockClear();
});

describe("isSupportedPreviewUrl", () => {
  it("accepts http and https and rejects everything else", () => {
    expect(isSupportedPreviewUrl("http://localhost:42101/")).toBe(true);
    expect(isSupportedPreviewUrl("https://example.com")).toBe(true);
    expect(isSupportedPreviewUrl("file:///etc/passwd")).toBe(false);
    expect(isSupportedPreviewUrl("javascript:alert(1)")).toBe(false);
    expect(isSupportedPreviewUrl("not a url")).toBe(false);
  });
});

describe("showPreviewView", () => {
  it("creates a locked-down view, attaches it, and loads the URL", () => {
    const { window, asBrowserWindow } = createWindow();

    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });

    expect(h.createdViews).toHaveLength(1);
    const view = latestView();
    expect(view.options).toEqual({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        partition: expect.stringMatching(
          /^dyad-preview-test-\d+-[0-9a-f-]{36}$/,
        ),
      },
    });
    expect(window.contentView.addChildView).toHaveBeenCalledWith(view);
    expect(view.setBounds).toHaveBeenCalledWith(BOUNDS);
    expect(view.webContents.loadURL).toHaveBeenCalledWith(APP_URL);
  });

  it("rounds and clamps bounds", () => {
    const { asBrowserWindow } = createWindow();

    showPreviewView(asBrowserWindow, {
      url: APP_URL,
      bounds: { x: 10.4, y: 20.6, width: 300.5, height: -5 },
    });

    expect(latestView().setBounds).toHaveBeenCalledWith({
      x: 10,
      y: 21,
      width: 301,
      height: 0,
    });
  });

  it("is idempotent for the same URL and replays navigation state instead", () => {
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });

    const view = latestView();
    view.webContents.url = APP_URL;
    view.webContents.back = true;
    window.webContents.sent.length = 0;

    showPreviewView(asBrowserWindow, {
      url: APP_URL,
      bounds: { ...BOUNDS, width: 500 },
    });

    expect(h.createdViews).toHaveLength(1);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(view.setBounds).toHaveBeenLastCalledWith({ ...BOUNDS, width: 500 });
    expect(sentOn(window, previewViewEvents.navigationState.channel)).toEqual([
      {
        channel: previewViewEvents.navigationState.channel,
        payload: {
          url: APP_URL,
          canGoBack: true,
          canGoForward: false,
          isLoading: false,
        },
      },
    ]);
  });

  it("reuses the view but navigates when the URL changes", () => {
    const { asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();

    showPreviewView(asBrowserWindow, {
      url: "http://localhost:42102/",
      bounds: BOUNDS,
    });

    expect(h.createdViews).toHaveLength(1);
    expect(view.webContents.loadURL).toHaveBeenNthCalledWith(
      2,
      "http://localhost:42102/",
    );
  });

  it("rejects URLs that are not http(s)", () => {
    const { asBrowserWindow } = createWindow();

    expect(() =>
      showPreviewView(asBrowserWindow, {
        url: "file:///etc/passwd",
        bounds: BOUNDS,
      }),
    ).toThrow(/Unsupported preview URL/);
    expect(h.createdViews).toHaveLength(0);
  });

  it("keeps separate views per window", () => {
    const first = createWindow();
    const second = createWindow();

    showPreviewView(first.asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    showPreviewView(second.asBrowserWindow, { url: APP_URL, bounds: BOUNDS });

    expect(h.createdViews).toHaveLength(2);
    expect(first.window.contentView.addChildView).toHaveBeenCalledWith(
      h.createdViews[0],
    );
    expect(second.window.contentView.addChildView).toHaveBeenCalledWith(
      h.createdViews[1],
    );
    const firstPartition = (
      h.createdViews[0].options as {
        webPreferences: { partition: string };
      }
    ).webPreferences.partition;
    const secondPartition = (
      h.createdViews[1].options as {
        webPreferences: { partition: string };
      }
    ).webPreferences.partition;
    expect(firstPartition).not.toBe(secondPartition);
    expect(firstPartition).not.toMatch(/^persist:/);
    expect(secondPartition).not.toMatch(/^persist:/);
  });
});

describe("hidePreviewView", () => {
  it("detaches before closing and forgets the view", () => {
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();

    hidePreviewView(asBrowserWindow);

    expect(window.contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
    expect(view.webContents.session.clearStorageData).toHaveBeenCalledTimes(1);
    expect(
      window.contentView.removeChildView.mock.invocationCallOrder[0],
    ).toBeLessThan(view.webContents.close.mock.invocationCallOrder[0]);
    expect(view.webContents.close.mock.invocationCallOrder[0]).toBeLessThan(
      view.webContents.session.clearStorageData.mock.invocationCallOrder[0],
    );

    // Later bounds updates must not reach the dead view.
    setPreviewViewBounds(asBrowserWindow, { ...BOUNDS, width: 999 });
    expect(view.setBounds).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when nothing is showing", () => {
    const { window, asBrowserWindow } = createWindow();

    expect(() => hidePreviewView(asBrowserWindow)).not.toThrow();
    expect(window.contentView.removeChildView).not.toHaveBeenCalled();
  });

  it("removes the host listeners it registered", () => {
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });

    expect(window.webContents.listenerCount("did-start-navigation")).toBe(1);
    expect(window.listenerCount("closed")).toBe(1);

    hidePreviewView(asBrowserWindow);

    expect(window.webContents.listenerCount("did-start-navigation")).toBe(0);
    expect(window.listenerCount("closed")).toBe(0);
  });

  it("lets a later show create a fresh view", () => {
    const { asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    hidePreviewView(asBrowserWindow);

    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });

    expect(h.createdViews).toHaveLength(2);
    expect(latestView().webContents.loadURL).toHaveBeenCalledWith(APP_URL);
  });
});

describe("preview screenshots and renderer overlays", () => {
  it("captures once per second and replaces the native surface while an overlay is open", async () => {
    vi.useFakeTimers();
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(view.webContents.capturePage).toHaveBeenCalledTimes(1);
    expect(sentOn(window, previewViewEvents.screenshotUpdated.channel)).toEqual(
      [
        {
          channel: previewViewEvents.screenshotUpdated.channel,
          payload: {
            dataUrl: "data:image/png;base64,screenshot-1",
          },
        },
      ],
    );

    setPreviewViewOverlayActive(asBrowserWindow, true);

    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(
      sentOn(window, previewViewEvents.screenshotUpdated.channel),
    ).toHaveLength(2);

    // The cached renderer image keeps refreshing while the native surface is
    // hidden, without allowing the WebContentsView to flash back on top.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(view.webContents.capturePage).toHaveBeenCalledTimes(3);
    expect(view.webContents.capturePage).toHaveBeenLastCalledWith(undefined, {
      stayHidden: true,
    });

    setPreviewViewOverlayActive(asBrowserWindow, false);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(view.webContents.capturePage).toHaveBeenCalledTimes(4);
    expect(
      sentOn(window, previewViewEvents.screenshotUpdated.channel).at(-1),
    ).toEqual({
      channel: previewViewEvents.screenshotUpdated.channel,
      payload: { dataUrl: "data:image/png;base64,screenshot-4" },
    });

    vi.useRealTimers();
  });

  it("stops capturing and drops the cached screenshot when the view is destroyed", async () => {
    vi.useFakeTimers();
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();

    await vi.advanceTimersByTimeAsync(1_000);
    hidePreviewView(asBrowserWindow);
    window.webContents.sent.length = 0;
    await vi.advanceTimersByTimeAsync(2_000);

    expect(view.webContents.capturePage).toHaveBeenCalledTimes(1);
    setPreviewViewOverlayActive(asBrowserWindow, true);
    expect(sentOn(window, previewViewEvents.screenshotUpdated.channel)).toEqual(
      [],
    );

    vi.useRealTimers();
  });
});

describe("host window lifecycle", () => {
  it("destroys the view when the window closes", () => {
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();

    window.emit("closed");

    expect(view.webContents.close).toHaveBeenCalledTimes(1);
    setPreviewViewBounds(asBrowserWindow, BOUNDS);
    expect(view.setBounds).toHaveBeenCalledTimes(1);
  });

  it("destroys the view when the host renderer navigates away", () => {
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();

    // Same-document navigation in the host must not tear the view down.
    window.webContents.emit(
      "did-start-navigation",
      {},
      "http://localhost:5173/#x",
      true,
      true,
    );
    expect(view.webContents.close).not.toHaveBeenCalled();

    window.webContents.emit(
      "did-start-navigation",
      {},
      "http://localhost:5173/",
      false,
      true,
    );
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
  });
});

describe("navigation events", () => {
  it("forwards navigation state to the host renderer", () => {
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();

    view.webContents.url = "http://localhost:42101/about";
    view.webContents.back = true;
    view.webContents.loading = true;
    window.webContents.sent.length = 0;

    view.webContents.emit("did-navigate");

    expect(sentOn(window, previewViewEvents.navigationState.channel)).toEqual([
      {
        channel: previewViewEvents.navigationState.channel,
        payload: {
          url: "http://localhost:42101/about",
          canGoBack: true,
          canGoForward: false,
          isLoading: true,
        },
      },
    ]);
  });

  it("reports main-frame load failures but ignores aborts and subframes", () => {
    const { window, asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();
    window.webContents.sent.length = 0;

    view.webContents.emit(
      "did-fail-load",
      {},
      -3,
      "ERR_ABORTED",
      APP_URL,
      true,
    );
    view.webContents.emit(
      "did-fail-load",
      {},
      -102,
      "ERR_CONNECTION_REFUSED",
      APP_URL,
      false,
    );
    expect(sentOn(window, previewViewEvents.loadFailed.channel)).toHaveLength(
      0,
    );

    view.webContents.emit(
      "did-fail-load",
      {},
      -102,
      "ERR_CONNECTION_REFUSED",
      APP_URL,
      true,
    );

    expect(sentOn(window, previewViewEvents.loadFailed.channel)).toEqual([
      {
        channel: previewViewEvents.loadFailed.channel,
        payload: {
          errorCode: -102,
          errorDescription: "ERR_CONNECTION_REFUSED",
          url: APP_URL,
        },
      },
    ]);
  });

  it("drives history through navigationHistory only when possible", () => {
    const { asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const contents = latestView().webContents;

    previewViewGoBack(asBrowserWindow);
    expect(contents.navigationHistory.goBack).not.toHaveBeenCalled();

    contents.back = true;
    contents.forward = true;
    previewViewGoBack(asBrowserWindow);
    previewViewGoForward(asBrowserWindow);
    previewViewReload(asBrowserWindow);

    expect(contents.navigationHistory.goBack).toHaveBeenCalledTimes(1);
    expect(contents.navigationHistory.goForward).toHaveBeenCalledTimes(1);
    expect(contents.reload).toHaveBeenCalledTimes(1);
  });

  it("ignores navigation commands when no view is showing", () => {
    const { asBrowserWindow } = createWindow();
    expect(() => previewViewReload(asBrowserWindow)).not.toThrow();
  });
});

describe("automation (preview test runs)", () => {
  function showAndAutomate() {
    const created = createWindow();
    showPreviewView(created.asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const view = latestView();
    const destroyed = vi.fn();
    const automation = beginPreviewAutomation(created.asBrowserWindow, {
      onViewDestroyed: destroyed,
    });
    return { ...created, view, destroyed, automation };
  }

  it("refuses to start when no view is showing", () => {
    const { asBrowserWindow } = createWindow();
    expect(beginPreviewAutomation(asBrowserWindow)).toBeNull();
  });

  it("keeps the page alive when the renderer hides mid-run", () => {
    const { asBrowserWindow, view } = showAndAutomate();

    hidePreviewView(asBrowserWindow);

    expect(view.webContents.close).not.toHaveBeenCalled();
    expect(view.setVisible).toHaveBeenCalledWith(false);
    expect(getPreviewViewStatus(asBrowserWindow).exists).toBe(true);
  });

  it("re-shows the hidden view when the renderer comes back", () => {
    const { asBrowserWindow, view } = showAndAutomate();
    hidePreviewView(asBrowserWindow);

    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });

    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);
  });

  it("destroys a still-hidden view once the run ends", () => {
    const { asBrowserWindow, view, automation } = showAndAutomate();
    hidePreviewView(asBrowserWindow);

    automation!.end();

    expect(view.webContents.close).toHaveBeenCalledTimes(1);
    expect(getPreviewViewStatus(asBrowserWindow).exists).toBe(false);
  });

  it("leaves a visible view alone once the run ends", () => {
    const { asBrowserWindow, view, automation } = showAndAutomate();

    automation!.end();
    automation!.end(); // idempotent

    expect(view.webContents.close).not.toHaveBeenCalled();
    expect(getPreviewViewStatus(asBrowserWindow).automationActive).toBe(false);
  });

  it("reports a view destroyed out from under the run", () => {
    const { window, view, destroyed } = showAndAutomate();

    window.emit("closed");

    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
  });

  it("stops spraying the system browser while a test drives the page", () => {
    const { view } = showAndAutomate();
    const contents = view.webContents;
    const event = { preventDefault: vi.fn() };

    contents.emit("will-navigate", event, "https://example.com", false, true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(h.shell.openExternal).not.toHaveBeenCalled();

    expect(
      contents.windowOpenHandler?.({ url: "https://example.com" }),
    ).toEqual({ action: "deny" });
    expect(h.shell.openExternal).not.toHaveBeenCalled();
  });
});

describe("waitForPreviewView", () => {
  it("resolves once the view is showing the run's origin", async () => {
    const { asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });

    // Trailing slashes and paths differ between the two sides; origin is what
    // matters.
    await expect(
      waitForPreviewView(asBrowserWindow, { url: "http://localhost:42101" }),
    ).resolves.toEqual({ ok: true });
  });

  it("reports that no preview is open when it times out empty", async () => {
    vi.useFakeTimers();
    const { asBrowserWindow } = createWindow();

    const pending = waitForPreviewView(asBrowserWindow, {
      url: APP_URL,
      timeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1500);

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "the native preview isn't open",
    });
    vi.useRealTimers();
  });

  it("reports what the preview is showing instead", async () => {
    vi.useFakeTimers();
    const { asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, {
      url: "http://localhost:42999/",
      bounds: BOUNDS,
    });

    const pending = waitForPreviewView(asBrowserWindow, {
      url: APP_URL,
      timeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1500);

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "it is showing http://localhost:42999/",
    });
    vi.useRealTimers();
  });
});

describe("view security", () => {
  it("denies popups and opens http(s) ones in the system browser", () => {
    const { asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const contents = latestView().webContents;

    expect(
      contents.windowOpenHandler?.({ url: "https://example.com/docs" }),
    ).toEqual({ action: "deny" });
    expect(h.shell.openExternal).toHaveBeenCalledWith(
      "https://example.com/docs",
    );

    h.shell.openExternal.mockClear();
    expect(contents.windowOpenHandler?.({ url: "file:///etc/passwd" })).toEqual(
      {
        action: "deny",
      },
    );
    expect(h.shell.openExternal).not.toHaveBeenCalled();
  });

  it("keeps same-origin navigation inside the view", () => {
    const { asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const contents = latestView().webContents;
    const event = { preventDefault: vi.fn() };

    contents.emit(
      "will-navigate",
      event,
      "http://localhost:42101/about",
      false,
      true,
    );

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(h.shell.openExternal).not.toHaveBeenCalled();
  });

  it("blocks off-origin navigation and hands it to the system browser", () => {
    const { asBrowserWindow } = createWindow();
    showPreviewView(asBrowserWindow, { url: APP_URL, bounds: BOUNDS });
    const contents = latestView().webContents;
    const event = { preventDefault: vi.fn() };

    contents.emit("will-navigate", event, "https://example.com", false, true);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(h.shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });
});
