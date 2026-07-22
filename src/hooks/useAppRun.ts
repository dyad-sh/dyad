import { useAppRunManager } from "@/app_run/AppRunProvider";
import type { RunState } from "@/app_run/state";
import { useKeyedController } from "@/state_machines/react";

const NO_APP_ID = -1;

/**
 * Subscribes to the run-state machine snapshot for an app. Returns the
 * idle state when no app is selected.
 */
export function useAppRunState(appId: number | null): RunState {
  const manager = useAppRunManager();
  return useKeyedController(manager, appId ?? NO_APP_ID);
}
