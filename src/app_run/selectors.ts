import type { RunState } from "./state";

export interface AppExit {
  appId: number;
  exitCode: number | null;
  timestamp: number;
}

/** Select the process-exit read model from a stopped run snapshot. */
export function selectAppExit(state: RunState): AppExit | null {
  if (state.type !== "stopped" || state.timestamp === null) return null;
  return {
    appId: state.appId,
    exitCode: state.exitCode,
    timestamp: state.timestamp,
  };
}
