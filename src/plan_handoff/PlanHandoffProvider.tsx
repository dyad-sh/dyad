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
import { PlanHandoffRemoteManager } from "./remote_manager";
import { readPlanDocument } from "@/hooks/usePlanDocument";

export type LegacyPlanHandoffManager = ReturnType<
  typeof createPlanHandoffRegistry
>;
export type PlanHandoffManager =
  | PlanHandoffRemoteManager
  | LegacyPlanHandoffManager;

interface PlanHandoffProviderProps {
  /** @deprecated Retained only for cutover test harnesses. */
  chatStream?: PlanHandoffDeps["chatStream"];
}

function useOwnedPlanHandoffManager(
  props: PlanHandoffProviderProps,
): PlanHandoffManager {
  const store = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dependencies = useRef<PlanHandoffDeps | null>(null);
  dependencies.current = props.chatStream
    ? {
        store,
        getPlanData: (chatId) => readPlanDocument(store, chatId),
        queryClient,
        navigate: (options) => void navigate(options),
        chatStream: props.chatStream,
      }
    : null;
  const [manager] = useState<PlanHandoffManager>(() =>
    props.chatStream
      ? createPlanHandoffRegistry(
          createPlanHandoffCommandRunner(() => {
            const current = dependencies.current;
            if (!current) {
              throw new Error("Plan handoff dependencies are not initialised");
            }
            return current;
          }),
        )
      : new PlanHandoffRemoteManager(),
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
