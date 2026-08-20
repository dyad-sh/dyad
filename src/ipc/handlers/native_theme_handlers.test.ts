import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const h = vi.hoisted(() => ({
  shouldUseDarkColors: true,
  listener: undefined as (() => void) | undefined,
  windows: [] as Array<{ webContents: unknown }>,
  on: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/dyad-native-theme-test"),
    getAppPath: vi.fn(() => process.cwd()),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => h.windows },
  nativeTheme: {
    get shouldUseDarkColors() {
      return h.shouldUseDarkColors;
    },
    on: h.on,
  },
}));

import { getRegisteredHandlerForTesting } from "./base";
import { registerNativeThemeHandlers } from "./native_theme_handlers";
import { systemContracts, systemEvents } from "../types/system";

beforeAll(() => {
  h.on.mockImplementation((event: string, listener: () => void) => {
    if (event === "updated") h.listener = listener;
  });
  registerNativeThemeHandlers();
});

beforeEach(() => {
  h.shouldUseDarkColors = true;
  h.windows = [];
});

describe("native theme handlers", () => {
  it("returns Electron's resolved native theme", async () => {
    const result = await getRegisteredHandlerForTesting(
      systemContracts.getNativeThemeState.channel,
    )({} as IpcMainInvokeEvent, undefined);

    expect(result).toEqual({ shouldUseDarkColors: true });
  });

  it("publishes native theme changes to every live Dyad window", () => {
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    h.windows = [
      {
        webContents: {
          isDestroyed: () => false,
          isCrashed: () => false,
          send: firstSend,
        },
      },
      {
        webContents: {
          isDestroyed: () => false,
          isCrashed: () => false,
          send: secondSend,
        },
      },
    ];
    h.shouldUseDarkColors = false;

    h.listener?.();

    const expected = [
      systemEvents.nativeThemeUpdated.channel,
      { shouldUseDarkColors: false },
    ];
    expect(firstSend).toHaveBeenCalledWith(...expected);
    expect(secondSend).toHaveBeenCalledWith(...expected);
  });
});
