import { useSyncExternalStore } from "react";
import { useStore } from "jotai";
import { getAppRunController } from "@/app_run/registry";
import type { RunState } from "@/app_run/state";

const IDLE_STATE: RunState = { type: "idle" };
const noopSubscribe = () => () => {};
const getIdleSnapshot = () => IDLE_STATE;

/**
 * Subscribes to the run-state machine snapshot for an app. Returns the
 * idle state when no app is selected.
 */
export function useAppRunState(appId: number | null): RunState {
  const store = useStore();
  const controller = appId === null ? null : getAppRunController(store, appId);
  return useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : getIdleSnapshot,
  );
}
