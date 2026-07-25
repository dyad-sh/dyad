import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { createScreenshotCommandAdapter } from "./commands";
import { ScreenshotManager } from "./manager";

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
  useRegisterEntityDisposer("app", manager.disposeKey);
}

const screenshotProvider = createMachineProvider({
  name: "Screenshot",
  useOwnedManager: useOwnedScreenshotManager,
  useOnMount: useScreenshotMount,
});

export const ScreenshotProvider = screenshotProvider.Provider;
export const useScreenshotManager = screenshotProvider.useManager;
