import { useState } from "react";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { AppRunRemoteManager } from "./remote_manager";
import type { AppRunManager } from "./manager";

type AppRunProviderManager = AppRunRemoteManager | AppRunManager;

function useOwnedAppRunManager(): AppRunProviderManager {
  const [manager] = useState(() => new AppRunRemoteManager());
  return manager;
}

function useAppRunMount(manager: AppRunProviderManager): void {
  useRegisterEntityDisposer("app", manager.disposeKey);
}

const appRunProvider = createMachineProvider<AppRunProviderManager>({
  name: "AppRun",
  useOwnedManager: useOwnedAppRunManager,
  useOnMount: useAppRunMount,
});

export const AppRunProvider = appRunProvider.Provider;
export const useAppRunManager = appRunProvider.useManager;
