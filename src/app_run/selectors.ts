import type { RunState } from "./state";

export interface AppExit {
  appId: number;
  exitCode: number | null;
  timestamp: number;
}

const appExitByStoppedState = new WeakMap<object, AppExit>();

/** Select the process-exit read model from a stopped run snapshot. */
export function selectAppExit(state: RunState): AppExit | null {
  if (state.type !== "stopped" || state.timestamp === null) return null;
  const cached = appExitByStoppedState.get(state);
  if (cached) return cached;
  const appExit = {
    appId: state.appId,
    exitCode: state.exitCode,
    timestamp: state.timestamp,
  };
  appExitByStoppedState.set(state, appExit);
  return appExit;
}
