import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

const h = vi.hoisted(() => ({
  ipcListeners: new Map<string, Array<(...args: any[]) => void>>(),
  fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn((channel: string, fn: (...args: any[]) => void) => {
      const list = h.ipcListeners.get(channel) ?? [];
      list.push(fn);
      h.ipcListeners.set(channel, list);
    }),
  },
  BrowserWindow: { fromWebContents: h.fromWebContents },
  app: {
    getPath: vi.fn(() => "/tmp/dyad-preview-view-handlers-test"),
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

const manager = vi.hoisted(() => ({
  showPreviewView: vi.fn(),
  hidePreviewView: vi.fn(),
  setPreviewViewBounds: vi.fn(),
  previewViewGoBack: vi.fn(),
  previewViewGoForward: vi.fn(),
  previewViewReload: vi.fn(),
}));
vi.mock("@/main/preview_web_contents_view", () => manager);

import { getRegisteredHandlerForTesting } from "./base";
import { registerPreviewViewHandlers } from "./preview_view_handlers";
import {
  previewViewContracts,
  previewViewSendContracts,
} from "../types/preview_view";
import { configureTrustedRenderer } from "../utils/renderer_security";

const TRUSTED_URL = "http://localhost:5173/";
const BOUNDS = { x: 1, y: 2, width: 300, height: 400 };

const fakeWindow = { id: 1 } as unknown as BrowserWindow;

function createEvent(url = TRUSTED_URL) {
  const frame = { url, parent: null, processId: 1, routingId: 2 };
  return {
    sender: { mainFrame: frame },
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
}

function setBoundsListener() {
  const listeners =
    h.ipcListeners.get(previewViewSendContracts.setBounds.channel) ?? [];
  expect(listeners).toHaveLength(1);
  return listeners[0];
}

beforeEach(() => {
  configureTrustedRenderer({
    devServerUrl: "http://localhost:5173",
    packagedRendererUrl: "file:///app/renderer/main_window/index.html",
  });
  h.ipcListeners.clear();
  h.fromWebContents.mockReset().mockReturnValue(fakeWindow);
  for (const fn of Object.values(manager)) fn.mockReset();
  registerPreviewViewHandlers();
});

describe("preview view invoke handlers", () => {
  it("shows the view for the sender's window", async () => {
    const input = { url: "http://localhost:42101/", bounds: BOUNDS };

    await getRegisteredHandlerForTesting(previewViewContracts.show.channel)(
      createEvent(),
      input,
    );

    expect(manager.showPreviewView).toHaveBeenCalledWith(fakeWindow, input);
  });

  it.each([
    ["hide", previewViewContracts.hide.channel, "hidePreviewView"],
    ["back", previewViewContracts.goBack.channel, "previewViewGoBack"],
    ["forward", previewViewContracts.goForward.channel, "previewViewGoForward"],
    ["reload", previewViewContracts.reload.channel, "previewViewReload"],
  ] as const)("delegates %s to the manager", async (_name, channel, fn) => {
    await getRegisteredHandlerForTesting(channel)(createEvent(), undefined);

    expect(manager[fn]).toHaveBeenCalledWith(fakeWindow);
  });

  it("does nothing when the sender has no window", async () => {
    h.fromWebContents.mockReturnValue(null);

    await getRegisteredHandlerForTesting(previewViewContracts.hide.channel)(
      createEvent(),
      undefined,
    );

    expect(manager.hidePreviewView).not.toHaveBeenCalled();
  });
});

describe("preview view bounds channel", () => {
  it("forwards valid bounds from a trusted renderer", () => {
    setBoundsListener()(createEvent(), BOUNDS);

    expect(manager.setPreviewViewBounds).toHaveBeenCalledWith(
      fakeWindow,
      BOUNDS,
    );
  });

  it("drops malformed payloads without throwing", () => {
    const listener = setBoundsListener();

    expect(() => listener(createEvent(), { x: 1 })).not.toThrow();
    expect(() => listener(createEvent(), null)).not.toThrow();
    expect(() =>
      listener(createEvent(), { ...BOUNDS, width: Number.NaN }),
    ).not.toThrow();
    expect(manager.setPreviewViewBounds).not.toHaveBeenCalled();
  });

  it("drops bounds from an untrusted sender", () => {
    setBoundsListener()(createEvent("https://evil.example.com/"), BOUNDS);

    expect(manager.setPreviewViewBounds).not.toHaveBeenCalled();
  });
});
