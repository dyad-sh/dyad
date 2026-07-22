import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/hooks/useSettings";
import {
  createPlanHandoffCommandRunner,
  type PlanHandoffDeps,
} from "./commands";
import { createPlanHandoffRegistry } from "./registry";

export type PlanHandoffManager = ReturnType<typeof createPlanHandoffRegistry>;

const PlanHandoffContext = createContext<PlanHandoffManager | null>(null);

export function PlanHandoffProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const dependencies = useRef<PlanHandoffDeps | null>(null);
  dependencies.current = {
    store,
    queryClient,
    navigate: (options) => void navigate(options),
    settings,
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

  const generation = useRef(0);
  useEffect(() => {
    const currentGeneration = ++generation.current;
    return () => {
      // StrictMode replays effect cleanup while retaining hook state.
      queueMicrotask(() => {
        if (generation.current === currentGeneration) manager.dispose();
      });
    };
  }, [manager]);

  return (
    <PlanHandoffContext.Provider value={manager}>
      {children}
    </PlanHandoffContext.Provider>
  );
}

export function usePlanHandoffManager(): PlanHandoffManager {
  const manager = useContext(PlanHandoffContext);
  if (!manager) {
    throw new Error("usePlanHandoffManager requires PlanHandoffProvider");
  }
  return manager;
}
