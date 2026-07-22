import { useState } from "react";
import { useStore } from "jotai";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { AppRunManager } from "./manager";

function useOwnedAppRunManager(): AppRunManager {
  const store = useStore();
  const [manager] = useState(() => new AppRunManager(store));
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
