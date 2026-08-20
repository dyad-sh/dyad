import { BrowserWindow, nativeTheme } from "electron";

import { safeSend } from "../utils/safe_sender";
import { systemContracts, systemEvents } from "../types/system";
import { createTypedHandler } from "./base";

function getNativeThemeState() {
  return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
}

function publishNativeThemeState(): void {
  const state = getNativeThemeState();
  for (const window of BrowserWindow.getAllWindows()) {
    safeSend(
      window.webContents,
      systemEvents.nativeThemeUpdated.channel,
      state,
    );
  }
}

export function registerNativeThemeHandlers(): void {
  createTypedHandler(systemContracts.getNativeThemeState, async () =>
    getNativeThemeState(),
  );
  nativeTheme.on("updated", publishNativeThemeState);
}
