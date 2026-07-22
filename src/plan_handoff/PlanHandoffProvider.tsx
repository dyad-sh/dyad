import { useRef, useState } from "react";
import { useStore } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import {
  createPlanHandoffCommandRunner,
  type PlanHandoffDeps,
} from "./commands";
import { createPlanHandoffRegistry } from "./registry";

export type PlanHandoffManager = ReturnType<typeof createPlanHandoffRegistry>;

interface PlanHandoffProviderProps {
  chatStream: PlanHandoffDeps["chatStream"];
}

function useOwnedPlanHandoffManager({
  chatStream,
}: PlanHandoffProviderProps): PlanHandoffManager {
  const store = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dependencies = useRef<PlanHandoffDeps | null>(null);
  dependencies.current = {
    store,
    queryClient,
    navigate: (options) => void navigate(options),
    chatStream,
  };
  const [manager] = useState(() =>
    createPlanHandoffRegistry(
      createPlanHandoffCommandRunner(() => {
        const current = dependencies.current;
        if (!current) {
          throw new Error("Plan handoff dependencies are not initialised");
        }
        return current;
      }),
    ),
  );
  return manager;
}

function usePlanHandoffMount(manager: PlanHandoffManager): void {
  useRegisterEntityDisposer("chat", manager.disposeKey);
}

const planHandoffProvider = createMachineProvider<
  PlanHandoffManager,
  PlanHandoffProviderProps
>({
  name: "PlanHandoff",
  useOwnedManager: useOwnedPlanHandoffManager,
  useOnMount: usePlanHandoffMount,
});

export const PlanHandoffProvider = planHandoffProvider.Provider;
export const usePlanHandoffManager = planHandoffProvider.useManager;
