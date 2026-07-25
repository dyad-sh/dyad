import { useState } from "react";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { AppRunRemoteManager } from "./remote_manager";

function useOwnedAppRunManager(): AppRunRemoteManager {
  const [manager] = useState(() => new AppRunRemoteManager());
  return manager;
}

function useAppRunMount(manager: AppRunRemoteManager): void {
  useRegisterEntityDisposer("app", manager.disposeKey);
}

const appRunProvider = createMachineProvider<AppRunRemoteManager>({
  name: "AppRunRemote",
  useOwnedManager: useOwnedAppRunManager,
  useOnMount: useAppRunMount,
});

export const AppRunRemoteProvider = appRunProvider.Provider;
export const useAppRunRemoteManager = appRunProvider.useManager;
