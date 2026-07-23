import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { pendingScreenshotAppIdsAtom } from "@/atoms/previewAtoms";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { createScreenshotCommandAdapter } from "./commands";
import { ScreenshotManager } from "./manager";
import type { ScreenshotCaptureSource } from "./state";

function useOwnedScreenshotManager(): ScreenshotManager {
  const queryClient = useQueryClient();
  const [manager] = useState(
    () =>
      new ScreenshotManager(
        createScreenshotCommandAdapter({
          clock: systemClock,
          idSource: uuidIdSource,
          queryClient,
        }),
      ),
  );
  return manager;
}

function useScreenshotMount(manager: ScreenshotManager): void {
  const store = useStore();
  useRegisterEntityDisposer("app", manager.disposeKey);

  useEffect(() => {
    const consume = () => {
      const inbox = store.get(pendingScreenshotAppIdsAtom);
      if (inbox.size === 0) return;
      for (const [appId, source] of inbox) {
        manager.send(appId, { type: "CAPTURE_REQUESTED", source });
      }
      store.set(pendingScreenshotAppIdsAtom, (current) => {
        let next: Map<number, ScreenshotCaptureSource> | null = null;
        for (const [appId, source] of inbox) {
          if (current.get(appId) !== source) continue;
          next ??= new Map(current);
          next.delete(appId);
        }
        return next ?? current;
      });
    };
    consume();
    return store.sub(pendingScreenshotAppIdsAtom, consume);
  }, [manager, store]);
}

const screenshotProvider = createMachineProvider({
  name: "Screenshot",
  useOwnedManager: useOwnedScreenshotManager,
  useOnMount: useScreenshotMount,
});

export const ScreenshotProvider = screenshotProvider.Provider;
export const useScreenshotManager = screenshotProvider.useManager;
