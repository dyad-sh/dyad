import { atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

export type RebaseAction = "abort" | "continue" | "safe-push" | null;

export interface GithubSyncState {
  isSyncing: boolean;
  syncError: string | null;
  syncSuccess: boolean;
  conflicts: string[];
  rebaseInProgress: boolean;
  rebaseStatusMessage: string | null;
  rebaseAction: RebaseAction;
}

export const DEFAULT_GITHUB_SYNC_STATE: GithubSyncState = {
  isSyncing: false,
  syncError: null,
  syncSuccess: false,
  conflicts: [],
  rebaseInProgress: false,
  rebaseStatusMessage: null,
  rebaseAction: null,
};

// Sync state is held in a global atom keyed by appId so that it survives
// unmounts when the user navigates away from the Publish tab while a push
// is in flight. The IPC push operation runs in the main process and its
// completion callback updates this atom — the next time the component
// mounts it will reflect the final result (success/failure).
export const githubSyncStatesAtom = atom<Record<number, GithubSyncState>>({});

type SyncPatch =
  | Partial<GithubSyncState>
  | ((prev: GithubSyncState) => Partial<GithubSyncState>);

export function useGithubSyncState(appId: number | null) {
  const allStates = useAtomValue(githubSyncStatesAtom);
  const setAllStates = useSetAtom(githubSyncStatesAtom);

  const state = useMemo<GithubSyncState>(() => {
    if (appId == null) return DEFAULT_GITHUB_SYNC_STATE;
    return allStates[appId] ?? DEFAULT_GITHUB_SYNC_STATE;
  }, [allStates, appId]);

  const updateSyncState = useCallback(
    (patch: SyncPatch) => {
      if (appId == null) return;
      setAllStates((prev) => {
        const current = prev[appId] ?? DEFAULT_GITHUB_SYNC_STATE;
        const resolved = typeof patch === "function" ? patch(current) : patch;
        return {
          ...prev,
          [appId]: { ...current, ...resolved },
        };
      });
    },
    [appId, setAllStates],
  );

  return [state, updateSyncState] as const;
}
