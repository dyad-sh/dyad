import { useCallback, useEffect, useRef } from "react";
import type { ScreenshotPostMessage } from "./commands";
import { useScreenshotManager } from "./ScreenshotProvider";
import type { ScreenshotEvent } from "./state";

export type ScreenshotAdapterEvent =
  | { type: "IFRAME_LOADED" }
  | { type: "SELECTOR_READY" }
  | {
      type: "RESPONSE";
      requestId: string;
      ok: boolean;
      dataUrl?: string;
    };

export function useScreenshot(input: {
  appId: number | null;
  postMessage: ScreenshotPostMessage;
}) {
  const { appId, postMessage } = input;
  const manager = useScreenshotManager();
  const postMessageRef = useRef(postMessage);
  postMessageRef.current = postMessage;

  useEffect(() => {
    if (appId === null) return;
    const detach = manager.commands.attach(appId, (message) =>
      postMessageRef.current(message),
    );
    return () => {
      detach();
      manager.send(appId, { type: "APP_HIDDEN" });
    };
  }, [appId, manager]);

  return useCallback(
    (event: ScreenshotAdapterEvent) => {
      if (appId === null) return;
      manager.send(appId, event as ScreenshotEvent);
    },
    [appId, manager],
  );
}
