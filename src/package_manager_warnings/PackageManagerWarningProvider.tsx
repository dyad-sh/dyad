import { useState } from "react";
import {
  createMachineProvider,
  useKeyedController,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { PackageManagerWarningStore } from "./store";

function useOwnedStore(): PackageManagerWarningStore {
  const [store] = useState(() => new PackageManagerWarningStore());
  return store;
}

function useStoreMount(store: PackageManagerWarningStore): void {
  useRegisterEntityDisposer("app", store.clearAllForApp);
}

const provider = createMachineProvider({
  name: "PackageManagerWarning",
  useOwnedManager: useOwnedStore,
  useOnMount: useStoreMount,
});

export const PackageManagerWarningProvider = provider.Provider;
export const usePackageManagerWarningStore = provider.useManager;

export function usePackageManagerWarning(appId: number | null) {
  const store = usePackageManagerWarningStore();
  const warning = useKeyedController(store, appId ?? -1);
  return appId === null ? undefined : warning;
}
