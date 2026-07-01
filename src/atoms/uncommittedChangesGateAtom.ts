import { atom } from "jotai";
import type { UncommittedChangesStrategy } from "@/ipc/types";

/**
 * How the user chose to resolve uncommitted changes before reverting. The
 * actual commit/discard is performed by the revert handler on `main` (see
 * version_handlers `revertVersion`), not by the dialog — this avoids committing
 * onto a detached preview HEAD.
 */
export type UncommittedChangesResolution =
  | {
      action: Extract<UncommittedChangesStrategy, "commit">;
      commitMessage: string;
    }
  | { action: Extract<UncommittedChangesStrategy, "discard"> };

/**
 * State for the app-wide "commit or discard before reverting" gate dialog.
 *
 * When a revert is requested while the worktree is dirty, `useVersions` opens
 * this dialog and waits: `onResolve` is called with the user's choice, and
 * `onCancel` if they back out. See consumers in `UncommittedChangesGateDialog`
 * and `useVersions`.
 */
export interface UncommittedChangesGateState {
  open: boolean;
  appId: number | null;
  onResolve: ((resolution: UncommittedChangesResolution) => void) | null;
  onCancel: (() => void) | null;
}

export const uncommittedChangesGateAtom = atom<UncommittedChangesGateState>({
  open: false,
  appId: null,
  onResolve: null,
  onCancel: null,
});
