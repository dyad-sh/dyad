import type { RuntimeMode2 } from "@/lib/schemas";
import type { RunState } from "./state";
import type { AppRunRemoteSnapshot } from "./transport";

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

export type AppUrlState =
  | {
      appUrl: string;
      appId: number;
      originalUrl: string;
      mode: RuntimeMode2;
    }
  | {
      appUrl: null;
      appId: null;
      originalUrl: null;
      mode: null;
    };

export const EMPTY_APP_URL: AppUrlState = {
  appUrl: null,
  appId: null,
  originalUrl: null,
  mode: null,
};

/**
 * Selects only a live dev-server URL. Stopped and errored runs intentionally
 * drop the legacy atom's retained URL because every reader treats presence as
 * a dev-server-running signal.
 */
export function selectAppUrl(state: RunState): AppUrlState {
  if (
    (state.type !== "ready" && state.type !== "reloading") ||
    state.url === null
  ) {
    return EMPTY_APP_URL;
  }
  return {
    appUrl: state.url.appUrl,
    appId: state.appId,
    originalUrl: state.url.originalUrl,
    mode: state.url.mode,
  };
}

export function selectRemoteAppUrl(state: AppRunRemoteSnapshot): AppUrlState {
  if (
    (state.phase !== "ready" && state.phase !== "reloading") ||
    state.url === null
  ) {
    return EMPTY_APP_URL;
  }
  return {
    appUrl: state.url.appUrl,
    appId: state.appId,
    originalUrl: state.url.originalUrl,
    mode: state.url.mode,
  };
}
