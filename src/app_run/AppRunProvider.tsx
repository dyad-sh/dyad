import { useState } from "react";
import { useStore } from "jotai";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { AppRunManager } from "./manager";
import { usePreviewErrorFacade } from "@/app_wiring/preview_error_facade";
import { usePackageManagerWarningStore } from "@/package_manager_warnings/PackageManagerWarningProvider";

function useOwnedAppRunManager(): AppRunManager {
  const store = useStore();
  const previewErrors = usePreviewErrorFacade();
  const packageWarnings = usePackageManagerWarningStore();
  const [manager] = useState(
    () =>
      new AppRunManager(store, undefined, undefined, {
        previewErrors,
        packageWarnings,
      }),
  );
  return manager;
}

function useAppRunMount(manager: AppRunManager): void {
  useRegisterEntityDisposer("app", manager.disposeKey);
}

const appRunProvider = createMachineProvider({
  name: "AppRun",
  useOwnedManager: useOwnedAppRunManager,
  useOnMount: useAppRunMount,
});

export const AppRunProvider = appRunProvider.Provider;
export const useAppRunManager = appRunProvider.useManager;
