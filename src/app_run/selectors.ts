import type { RuntimeMode2 } from "@/lib/schemas";
import type { AppRunRemoteSnapshot } from "./transport";

export interface AppExit {
  appId: number;
  exitCode: number | null;
  timestamp: number;
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

export function selectRemoteAppExit(
  state: AppRunRemoteSnapshot,
): AppExit | null {
  return state.exit?.timestamp === null || !state.exit
    ? null
    : {
        appId: state.appId,
        exitCode: state.exit.exitCode,
        timestamp: state.exit.timestamp,
      };
}
