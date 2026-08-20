import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/ipc/types";
import type { CommitProgress } from "@/ipc/types/github";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";
import { useScreenshotManager } from "@/screenshot/ScreenshotProvider";
import { GIT_ERROR_CODES } from "@/shared/git_error_codes";

function isPreCommitFailure(error: Error | null): boolean {
  return (
    error !== null &&
    (error as Error & { code?: string }).code ===
      GIT_ERROR_CODES.PRE_COMMIT_FAILED
  );
}

function isCommitCancelled(error: Error): boolean {
  return (
    (error as Error & { code?: string }).code ===
    GIT_ERROR_CODES.COMMIT_CANCELLED
  );
}

export function useCommitChanges() {
  const queryClient = useQueryClient();
  const screenshotManager = useScreenshotManager();
  const [commitProgress, setCommitProgress] = useState<CommitProgress | null>(
    null,
  );
  const [isCancellingCommit, setIsCancellingCommit] = useState(false);
  const activeCommitRef = useRef<{
    appId: number;
    operationId: string;
  } | null>(null);
  const inFlightCommitRef = useRef<{
    appId: number;
    message: string;
    promise: Promise<string>;
  } | null>(null);

  useEffect(() => {
    return ipc.events.git.onCommitProgress((progress) => {
      const active = activeCommitRef.current;
      if (
        active?.appId === progress.appId &&
        active.operationId === progress.operationId
      ) {
        setCommitProgress(progress);
      }
    });
  }, []);

  const {
    mutateAsync: mutateCommitChanges,
    isPending: isCommitting,
    error: commitError,
    reset: resetCommitError,
  } = useMutation({
    mutationFn: async ({
      appId,
      message,
      operationId,
    }: {
      appId: number;
      message: string;
      operationId: string;
    }) => {
      return ipc.git.commitChanges({ appId, message, operationId });
    },
    onSuccess: (_, { appId }) => {
      showSuccess("Changes committed successfully");
      screenshotManager.requestCapture(appId, "commit");
      // Invalidate uncommitted files query
      queryClient.invalidateQueries({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId }),
      });
      // Also invalidate versions query to update version count
      queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId }),
      });
    },
    onError: (error: Error) => {
      if (!isPreCommitFailure(error) && !isCommitCancelled(error)) {
        showError(`Failed to commit: ${error.message}`);
      }
    },
  });

  const commitChanges = useCallback(
    ({ appId, message }: { appId: number; message: string }) => {
      const inFlight = inFlightCommitRef.current;
      if (inFlight) {
        if (inFlight.appId === appId && inFlight.message === message) {
          return inFlight.promise;
        }
        const error = new Error("Another commit is already in progress.");
        showError(error.message);
        return Promise.reject(error);
      }

      const operationId = `commit:${globalThis.crypto.randomUUID()}`;
      activeCommitRef.current = { appId, operationId };
      setCommitProgress(null);

      const run = async () => {
        try {
          return await mutateCommitChanges({ appId, message, operationId });
        } finally {
          if (activeCommitRef.current?.operationId === operationId) {
            activeCommitRef.current = null;
            inFlightCommitRef.current = null;
            setCommitProgress(null);
            setIsCancellingCommit(false);
          }
        }
      };
      const promise = run();
      inFlightCommitRef.current = { appId, message, promise };
      return promise;
    },
    [mutateCommitChanges],
  );

  const cancelCommit = useCallback(async () => {
    const active = activeCommitRef.current;
    if (!active || isCancellingCommit) return;

    setIsCancellingCommit(true);
    try {
      await ipc.git.cancelCommit(active);
    } catch (error) {
      setIsCancellingCommit(false);
      showError(
        error instanceof Error ? error.message : "Failed to cancel the commit",
      );
    }
  }, [isCancellingCommit]);

  return {
    commitChanges,
    cancelCommit,
    isCommitting,
    isCancellingCommit,
    commitProgress,
    preCommitError: isPreCommitFailure(commitError) ? commitError : null,
    resetCommitError,
  };
}
