import { useCallback } from "react";
import { useSetAtom } from "jotai";

import {
  clearStagedDiffAtom,
  closeCommitDialogAtom,
  type CommitDialogSource,
} from "@/atoms/commitAtoms";
import { useCommitChanges } from "@/hooks/useCommitChanges";
import { useFixPreCommitWithAI } from "@/hooks/useFixPreCommitWithAI";

export function useCommitDialogRecovery({
  appId,
  source,
  commitMessage,
  onDialogEnded,
}: {
  appId: number;
  source: CommitDialogSource;
  commitMessage: string;
  onDialogEnded?: () => void;
}) {
  const commit = useCommitChanges();
  const aiFix = useFixPreCommitWithAI();
  const closeCommitDialog = useSetAtom(closeCommitDialogAtom);
  const clearStagedDiff = useSetAtom(clearStagedDiffAtom);

  const dismissDialog = useCallback(() => {
    onDialogEnded?.();
    commit.resetCommitError();
    closeCommitDialog({ source, appId });
  }, [appId, closeCommitDialog, commit, onDialogEnded, source]);

  const handleCommit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message) return false;

    try {
      await commit.commitChanges({ appId, message });
    } catch {
      // useCommitChanges surfaces ordinary errors via a toast and exposes hook
      // failures inline. Keep the dialog open in either case.
      return false;
    }

    onDialogEnded?.();
    closeCommitDialog({ source, appId });
    clearStagedDiff(appId);
    return true;
  }, [
    appId,
    clearStagedDiff,
    closeCommitDialog,
    commit,
    commitMessage,
    onDialogEnded,
    source,
  ]);

  const handleFixPreCommitWithAI = useCallback(async () => {
    if (!commit.preCommitError || !aiFix.isAvailable) return false;
    const started = await aiFix.fixPreCommitWithAI({
      appId,
      commitMessage: commitMessage.trim(),
      failureOutput: commit.preCommitError.message,
    });
    if (!started) return false;

    onDialogEnded?.();
    commit.resetCommitError();
    closeCommitDialog({ source, appId });
    return true;
  }, [
    aiFix,
    appId,
    closeCommitDialog,
    commit,
    commitMessage,
    onDialogEnded,
    source,
  ]);

  return {
    ...commit,
    dismissDialog,
    handleCommit,
    handleFixPreCommitWithAI,
    isStartingAiFix: aiFix.isStarting,
    canFixPreCommitWithAI: aiFix.isAvailable && !aiFix.isAvailabilityLoading,
  };
}
