import { useState } from "react";

import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { PlanHandoffRemoteManager } from "./remote_manager";

function useOwnedPlanHandoffManager(): PlanHandoffRemoteManager {
  const [manager] = useState(() => new PlanHandoffRemoteManager());
  return manager;
}

function usePlanHandoffMount(manager: PlanHandoffRemoteManager): void {
  useRegisterEntityDisposer("chat", manager.disposeKey);
}

const planHandoffProvider = createMachineProvider<PlanHandoffRemoteManager>({
  name: "PlanHandoff",
  useOwnedManager: useOwnedPlanHandoffManager,
  useOnMount: usePlanHandoffMount,
});

export const PlanHandoffProvider = planHandoffProvider.Provider;
export const usePlanHandoffManager = planHandoffProvider.useManager;
