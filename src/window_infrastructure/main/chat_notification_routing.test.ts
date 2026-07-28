import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type { WindowSessionId } from "../types";
import { WindowRegistry, type WindowEndpoint } from "./window_registry";
import {
  chatNotificationTarget,
  revealWindow,
} from "./chat_notification_routing";

const session = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}` as WindowSessionId;

function endpoint(id: number): WindowEndpoint {
  return {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
  };
}

describe("chat notification window routing", () => {
  it("keeps the single-window identity when multi-window is disabled", () => {
    const windows = new WindowRegistry();
    windows.register(endpoint(1), session(1));

    expect(
      chatNotificationTarget(windows, { kind: "chat", id: 7 }, false),
    ).toBe(session(1));
  });

  it("opens a new window when enabled windows do not show the chat", () => {
    const windows = new WindowRegistry();
    windows.register(endpoint(1), session(1));
    windows.register(endpoint(2), session(2));

    expect(
      chatNotificationTarget(windows, { kind: "chat", id: 7 }, true),
    ).toBeNull();
  });

  it("restores, shows, and focuses a minimized target", () => {
    const window = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    } as unknown as BrowserWindow;

    revealWindow(window);

    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });
});
