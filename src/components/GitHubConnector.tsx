import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Github,
  Clipboard,
  Check,
  AlertTriangle,
  ChevronRight,
  GitMerge,
} from "lucide-react";
import { ipc, type GithubSyncOptions } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApp } from "@/hooks/useLoadApp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GithubBranchManager } from "@/components/GithubBranchManager";
import { useResolveMergeConflictsWithAI } from "@/hooks/useResolveMergeConflictsWithAI";
import { showSuccess, showError } from "@/lib/toast";
import { useGithubSyncState } from "@/atoms/githubSyncAtoms";
import {
  useGitHubDeviceFlow,
  useGitHubRepoSetup,
} from "./GitHubConnector.hooks";

type SyncResult =
  | { error: Error; handled?: boolean }
  | { error?: undefined; handled?: boolean };

interface GitHubConnectorProps {
  appId: number | null;
  folderName: string;
  expanded?: boolean;
}

interface LinkedGitHubRepo {
  org: string;
  repo: string;
}

type GitHubRepoSetupViewState = ReturnType<typeof useGitHubRepoSetup>["state"];
type GitHubRepoSetupViewActions = ReturnType<
  typeof useGitHubRepoSetup
>["actions"];

interface ConnectedGitHubConnectorProps {
  appId: number;
  app: any;
  refreshApp: () => void;
  triggerAutoSync?: boolean;
  onAutoSyncComplete?: () => void;
}

export interface UnconnectedGitHubConnectorProps {
  appId: number | null;
  folderName: string;
  settings: any;
  refreshSettings: () => void;
  handleRepoSetupComplete: () => void;
  expanded?: boolean;
  linkedRepo?: LinkedGitHubRepo;
}

interface GitHubConflictResolutionProps {
  conflicts: string[];
  isCancellingSync: boolean;
  isResolving: boolean;
  onResolveWithAI: () => void;
  onCancelSync: () => void;
}

function GitHubConflictResolution({
  conflicts,
  isCancellingSync,
  isResolving,
  onResolveWithAI,
  onCancelSync,
}: GitHubConflictResolutionProps) {
  if (conflicts.length === 0) return null;

  return (
    <div className="mt-3 p-3 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20">
      <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
        {conflicts.length} file{conflicts.length > 1 ? "s" : ""} with merge
        conflicts: {conflicts.join(", ")}
      </p>
      <div className="flex gap-2">
        <Button
          onClick={onResolveWithAI}
          disabled={isCancellingSync || isResolving}
        >
          {isResolving ? "Resolving..." : "Resolve merge conflicts with AI"}
        </Button>
        <Button
          variant="outline"
          onClick={onCancelSync}
          disabled={isCancellingSync || isResolving}
        >
          {isCancellingSync ? "Cancelling..." : "Cancel sync"}
        </Button>
      </div>
    </div>
  );
}

function ConnectedGitHubConnector({
  appId,
  app,
  refreshApp,
  triggerAutoSync,
  onAutoSyncComplete,
}: ConnectedGitHubConnectorProps) {
  const { t } = useTranslation(["home", "common"]);
  // Sync state is stored in a global atom keyed by appId so it survives
  // unmounts when the user navigates away from the Publish tab while a push
  // is still running. See githubSyncAtoms.ts.
  const [syncState, updateSyncState] = useGithubSyncState(appId);
  const {
    isSyncing,
    syncError,
    syncSuccess,
    conflicts,
    rebaseInProgress,
    rebaseStatusMessage,
    rebaseAction,
  } = syncState;
  const [showForceDialog, setShowForceDialog] = useState(false);
  const [isCancellingSync, setIsCancellingSync] = useState(false);
  const lastAutoSyncedAppIdRef = useRef<number | null>(null);

  const { resolveWithAI, isResolving } = useResolveMergeConflictsWithAI({
    appId,
    conflicts,
    onStartResolving: () => {
      // Clear conflicts state when starting AI resolution since user will be navigated to chat
      updateSyncState({ conflicts: [], syncError: null });
    },
  });

  // Only the stable mutateAsync is kept: depending on the full mutation
  // result object would recreate handleSyncToGithub on every render.
  const { mutateAsync: pushToGithub } = useMutation({
    mutationFn: (options: GithubSyncOptions) =>
      ipc.github.push({
        appId,
        ...options,
      }),
  });

  const handleCancelSync = async () => {
    setIsCancellingSync(true);
    try {
      const state = await ipc.github.getGitState({ appId });
      let aborted = false;
      if (state.rebaseInProgress) {
        await ipc.github.rebaseAbort({ appId });
        updateSyncState({
          rebaseInProgress: false,
          rebaseStatusMessage: "Rebase aborted.",
        });
        aborted = true;
      } else if (state.mergeInProgress) {
        await ipc.github.mergeAbort({ appId });
        aborted = true;
      }
      updateSyncState({ conflicts: [], syncError: null });
      if (aborted) {
        showSuccess("Sync cancelled");
      }
    } catch (error: any) {
      showError(error?.message || "Failed to cancel sync");
    } finally {
      setIsCancellingSync(false);
    }
  };

  const disconnectRepoMutation = useMutation({
    mutationFn: async () => {
      await ipc.github.disconnect({ appId });
    },
    onSuccess: () => {
      updateSyncState({
        isSyncing: false,
        syncError: null,
        syncSuccess: false,
        conflicts: [],
        rebaseInProgress: false,
        rebaseStatusMessage: null,
        rebaseAction: null,
      });
      refreshApp();
    },
  });

  const handleDisconnectRepo = async () => {
    disconnectRepoMutation.mutate();
  };

  const handleSyncToGithub = useCallback(
    async ({
      force = false,
      forceWithLease = false,
    }: GithubSyncOptions = {}): Promise<SyncResult> => {
      updateSyncState({
        isSyncing: true,
        syncError: null,
        syncSuccess: false,
        rebaseInProgress: false,
        conflicts: [], // Clear conflicts when starting a new sync
      });
      setShowForceDialog(false);

      try {
        await pushToGithub({ force, forceWithLease });
        updateSyncState({
          syncSuccess: true,
          rebaseInProgress: false,
          conflicts: [], // Clear conflicts on successful sync
          rebaseStatusMessage: null,
        });
        // Toast so the user sees the result even if they navigated away
        // from the Publish tab while the push was running.
        showSuccess("Successfully pushed to GitHub!");
        return {};
      } catch (err: any) {
        // Always check for conflicts when sync fails, regardless of error type
        // IPC serialization may not preserve error.name, so we check conflicts directly
        // This is important because gitPull can throw GitConflictError which might not
        // be properly serialized through IPC
        let conflictsDetected: string[] = [];
        let conflictCheckError: unknown = null;
        try {
          conflictsDetected = await ipc.github.getConflicts({ appId });
        } catch (error) {
          // If conflict check fails, keep the error to surface it with the sync failure.
          conflictCheckError = error;
        }

        if (conflictsDetected.length > 0) {
          // Conflicts were detected - show resolution buttons below
          updateSyncState({
            conflicts: conflictsDetected,
            syncError:
              "Merge conflicts detected. Use the buttons below to resolve them.",
          });
          showError("Merge conflicts detected while syncing to GitHub.");
          (err as Error & { handled?: boolean }).handled = true;
          return { error: err, handled: true };
        }

        // Check if it's a known conflict error for user messaging
        // (even if conflicts check failed or returned empty)
        const errorName = err?.name || "";
        const isConflict = errorName === "GitConflictError";

        if (isConflict) {
          // Conflict error detected but no conflicts found - this shouldn't happen
          // but we'll show an error message
          const msg =
            "Merge conflict detected, but no conflicting files were returned. Please check git status and try again.";
          updateSyncState({ syncError: msg });
          showError(msg);
          return { error: err };
        }

        // Check for structured error codes instead of parsing error messages
        const errorCode = err?.code as
          | "REBASE_IN_PROGRESS"
          | "MERGE_IN_PROGRESS"
          | undefined;

        // Fallback: query backend git state if structured error code is missing
        let inferredRebaseInProgress = false;
        if (!errorCode) {
          try {
            const state = await ipc.github.getGitState({ appId });
            inferredRebaseInProgress = state.rebaseInProgress;
          } catch {
            // ignore state inference errors
          }
        }

        // Final fallback: inspect error message for known rebase markers when state fetch fails
        const messageIndicatesRebase =
          typeof err?.message === "string" &&
          err.message.toLowerCase().includes("rebase-merge");

        const rebaseInProgressState =
          errorCode === "REBASE_IN_PROGRESS" ||
          inferredRebaseInProgress ||
          messageIndicatesRebase;

        const baseErrorMessage = err.message || "Failed to sync to GitHub.";
        const conflictCheckMessage =
          conflictCheckError instanceof Error
            ? ` Conflict check failed: ${conflictCheckError.message}`
            : conflictCheckError
              ? " Conflict check failed."
              : "";
        const finalErrorMessage = `${baseErrorMessage}${conflictCheckMessage}`;
        updateSyncState({
          syncError: finalErrorMessage,
          rebaseInProgress: rebaseInProgressState,
          rebaseStatusMessage: null,
        });
        showError(`Failed to sync to GitHub: ${finalErrorMessage}`);
        return { error: err };
      } finally {
        updateSyncState({ isSyncing: false });
      }
    },
    [appId, pushToGithub, updateSyncState],
  );

  const handleAbortRebase = useCallback(async () => {
    updateSyncState({
      rebaseAction: "abort",
      syncError: null,
      rebaseStatusMessage: null,
      syncSuccess: false,
    });
    try {
      await ipc.github.rebaseAbort({ appId });
      updateSyncState({
        rebaseInProgress: false,
        rebaseStatusMessage: "Rebase aborted. You can try syncing again.",
      });
    } catch (err: any) {
      updateSyncState({
        syncError: err.message || "Failed to abort rebase.",
        rebaseInProgress: true,
      });
    } finally {
      updateSyncState({ rebaseAction: null });
    }
  }, [appId, updateSyncState]);

  const handleContinueRebase = useCallback(async () => {
    updateSyncState({
      rebaseAction: "continue",
      syncError: null,
      rebaseStatusMessage: null,
      syncSuccess: false,
    });
    try {
      await ipc.github.rebaseContinue({ appId });
      updateSyncState({
        rebaseInProgress: false,
        rebaseStatusMessage: "Rebase continued. You can sync when ready.",
      });
    } catch (err: any) {
      updateSyncState({
        syncError: err.message || "Failed to continue rebase.",
        rebaseInProgress: true,
      });
    } finally {
      updateSyncState({ rebaseAction: null });
    }
  }, [appId, updateSyncState]);

  const handleSafeForcePush = useCallback(async () => {
    updateSyncState({ rebaseAction: "safe-push" });
    try {
      await handleSyncToGithub({
        force: false,
        forceWithLease: true,
      });
    } finally {
      updateSyncState({ rebaseAction: null });
    }
  }, [handleSyncToGithub, updateSyncState]);

  const handleRebaseAndSync = useCallback(async () => {
    updateSyncState({ isSyncing: true });
    try {
      // First, perform the rebase
      await ipc.github.rebase({ appId });
      updateSyncState({ rebaseStatusMessage: null });
      const syncResult = await handleSyncToGithub();
      if (syncResult?.error) {
        if (!syncResult.handled) {
          throw syncResult.error;
        }
        return;
      }
      updateSyncState({
        rebaseStatusMessage: "Rebase and push completed successfully.",
      });
    } catch (err: any) {
      if (err?.handled) {
        return;
      }
      const errorMessage =
        err?.message || "Failed to rebase and sync to GitHub.";
      updateSyncState({
        syncError: errorMessage,
        rebaseInProgress: errorMessage.includes("rebase-merge"),
      });
      // If rebase failed, show appropriate message
      if (errorMessage.includes("rebase")) {
        updateSyncState({
          rebaseStatusMessage:
            "Rebase failed. You may need to resolve conflicts or abort the rebase.",
        });
      }
      // Clear any stale rebase success message if sync failed after rebase
      if (errorMessage.includes("sync") || errorMessage.includes("push")) {
        updateSyncState({ rebaseStatusMessage: null });
      }
    } finally {
      // Ensure syncing state is reset whether rebase or sync fails before handleSyncToGithub runs its own cleanup
      updateSyncState({ isSyncing: false });
    }
  }, [appId, handleSyncToGithub, updateSyncState]);

  // Auto-sync when triggerAutoSync prop is true
  useEffect(() => {
    if (!appId) return;

    // Only auto-sync once per appId
    const alreadySyncedForThisApp = lastAutoSyncedAppIdRef.current === appId;

    if (triggerAutoSync && !alreadySyncedForThisApp && !isSyncing) {
      lastAutoSyncedAppIdRef.current = appId;
      handleSyncToGithub()
        .catch(() => {
          // Error is already handled in handleSyncToGithub via state updates
        })
        .finally(() => {
          onAutoSyncComplete?.();
        });
    }

    // allow re-sync if triggerAutoSync is explicitly turned off
    if (
      !triggerAutoSync &&
      !isSyncing &&
      lastAutoSyncedAppIdRef.current === appId
    ) {
      lastAutoSyncedAppIdRef.current = null;
    }
  }, [
    appId,
    triggerAutoSync,
    isSyncing,
    handleSyncToGithub,
    onAutoSyncComplete,
  ]);

  const isForcePushError =
    syncError?.includes("rejected") || syncError?.includes("non-fast-forward");
  const showRebaseAndSync = syncError?.includes("divergent branches");
  const showRebaseRecoveryOptions =
    rebaseInProgress || (syncError?.includes("rebase-merge") ?? false);
  const isRebaseActionPending = isSyncing || !!rebaseAction;
  const isDisconnecting = disconnectRepoMutation.isPending;
  const disconnectError = disconnectRepoMutation.error
    ? disconnectRepoMutation.error.message ||
      t("integrations.github.failedDisconnectRepo")
    : null;

  return (
    <div className="w-full" data-testid="github-connected-repo">
      <p>Connected to GitHub Repo:</p>
      <a
        onClick={(e) => {
          e.preventDefault();
          ipc.system.openExternalUrl(
            `https://github.com/${app.githubOrg}/${app.githubRepo}`,
          );
        }}
        className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
        target="_blank"
        rel="noopener noreferrer"
      >
        {app.githubOrg}/{app.githubRepo}
      </a>
      {app.githubBranch && (
        <GithubBranchManager appId={appId} onBranchChange={refreshApp} />
      )}
      <div className="mt-2 flex gap-2">
        <Button
          onClick={() => handleSyncToGithub()}
          disabled={isRebaseActionPending}
        >
          {isSyncing ? (
            <>
              <svg
                className="animate-spin h-5 w-5 mr-2 inline"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                style={{ display: "inline" }}
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Syncing...
            </>
          ) : (
            "Sync to GitHub"
          )}
        </Button>
        <Button
          onClick={handleDisconnectRepo}
          disabled={isDisconnecting}
          variant="outline"
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect from repo"}
        </Button>
      </div>
      {syncError && (
        <div className="mt-2 space-y-2">
          <p className="text-red-600">
            {syncError}{" "}
            <a
              onClick={(e) => {
                e.preventDefault();
                ipc.system.openExternalUrl(
                  "https://www.dyad.sh/docs/integrations/github#troubleshooting",
                );
              }}
              className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
              target="_blank"
              rel="noopener noreferrer"
            >
              See troubleshooting guide
            </a>
          </p>
          {showRebaseRecoveryOptions && (
            <div className="space-y-2 rounded-md border border-orange-200 p-3 dark:border-orange-800 dark:bg-orange-900/20">
              <p className="text-sm text-orange-800 dark:text-orange-100">
                A rebase is already in progress. Choose how to proceed.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleAbortRebase}
                  variant="outline"
                  size="sm"
                  disabled={isRebaseActionPending}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  {rebaseAction === "abort" ? "Aborting..." : "Abort rebase"}
                </Button>
                <Button
                  onClick={handleContinueRebase}
                  variant="outline"
                  size="sm"
                  disabled={isRebaseActionPending}
                >
                  <GitMerge className="h-4 w-4 mr-2" />
                  {rebaseAction === "continue"
                    ? "Continuing..."
                    : "Continue rebase"}
                </Button>
                <Button
                  onClick={handleSafeForcePush}
                  variant="outline"
                  size="sm"
                  disabled={isRebaseActionPending}
                  className="text-orange-600 border-orange-600 hover:bg-orange-50"
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  {rebaseAction === "safe-push"
                    ? "Safe force pushing..."
                    : "Safe Force Push"}
                </Button>
              </div>
            </div>
          )}
          {isForcePushError && (
            <Button
              onClick={() => setShowForceDialog(true)}
              variant="outline"
              size="sm"
              disabled={isRebaseActionPending}
              className="text-orange-600 border-orange-600 hover:bg-orange-50"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Force Push (Dangerous)
            </Button>
          )}
          {showRebaseAndSync && (
            <Button
              onClick={handleRebaseAndSync}
              variant="outline"
              size="sm"
              disabled={isRebaseActionPending}
              className="mt-2 ml-2"
            >
              <GitMerge className="h-4 w-4 mr-2" />
              Rebase and Sync
            </Button>
          )}
        </div>
      )}
      <GitHubConflictResolution
        conflicts={conflicts}
        isCancellingSync={isCancellingSync}
        isResolving={isResolving}
        onResolveWithAI={resolveWithAI}
        onCancelSync={handleCancelSync}
      />
      {rebaseStatusMessage && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">
          {rebaseStatusMessage}
        </p>
      )}
      {syncSuccess && (
        <p className="text-green-600 mt-2">Successfully pushed to GitHub!</p>
      )}
      {disconnectError && (
        <p className="text-red-600 mt-2">{disconnectError}</p>
      )}

      {/* Force Push Warning Dialog */}
      <Dialog open={showForceDialog} onOpenChange={setShowForceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Force Push Warning
            </DialogTitle>
            <DialogDescription>
              <div className="space-y-3">
                <p>
                  You are about to perform a <strong>force push</strong> to your
                  GitHub repository.
                </p>
                <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-md border border-orange-200 dark:border-orange-800">
                  <p className="text-sm text-orange-800 dark:text-orange-200">
                    <strong>
                      This is dangerous and non-reversible and will:
                    </strong>
                  </p>
                  <ul className="text-sm text-orange-700 dark:text-orange-300 list-disc list-inside mt-2 space-y-1">
                    <li>Overwrite the remote repository history</li>
                    <li>
                      Permanently delete commits that exist on the remote but
                      not locally
                    </li>
                  </ul>
                </div>
                <p className="text-sm">
                  Only proceed if you're certain this is what you want to do.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleSyncToGithub({ force: true })}
              disabled={isSyncing}
            >
              {isSyncing ? "Force Pushing..." : "Force Push"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface GitHubDeviceConnectionProps {
  linkedRepo?: LinkedGitHubRepo;
  isConnecting: boolean;
  userCode: string | null;
  verificationUri: string | null;
  error: string | null;
  statusMessage: string | null;
  codeCopied: boolean;
  onConnect: () => void;
  onCodeCopied: () => void;
}

function GitHubDeviceConnection({
  linkedRepo,
  isConnecting,
  userCode,
  verificationUri,
  error,
  statusMessage,
  codeCopied,
  onConnect,
  onCodeCopied,
}: GitHubDeviceConnectionProps) {
  return (
    <div className="mt-1 w-full" data-testid="github-unconnected-repo">
      {linkedRepo && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">Reconnect your GitHub account</p>
          <p className="mt-1">
            This app is linked to {linkedRepo.org}/{linkedRepo.repo}, but GitHub
            credentials are missing from settings.
          </p>
        </div>
      )}
      <Button
        onClick={onConnect}
        className="cursor-pointer w-full py-5 flex justify-center items-center gap-2"
        size="lg"
        variant="outline"
        disabled={isConnecting}
      >
        Connect to GitHub
        <Github className="h-5 w-5" />
        {isConnecting && (
          <svg
            className="animate-spin h-5 w-5 ml-2"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        )}
      </Button>

      {(userCode || statusMessage || error) && (
        <div className="mt-6 p-4 border rounded-md bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600">
          <h4 className="font-medium mb-2">GitHub Connection</h4>
          {error && (
            <p className="text-red-600 dark:text-red-400 mb-2">
              Error: {error}
            </p>
          )}
          {userCode && verificationUri && (
            <div className="mb-2">
              <p>
                1. Go to:
                <a
                  href={verificationUri}
                  onClick={(e) => {
                    e.preventDefault();
                    ipc.system.openExternalUrl(verificationUri);
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 text-blue-600 hover:underline dark:text-blue-400"
                >
                  {verificationUri}
                </a>
              </p>
              <p>
                2. Enter code:
                <strong className="ml-1 font-mono text-lg tracking-wider bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded">
                  {userCode}
                </strong>
                <button
                  className="ml-2 p-1 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 focus:outline-none"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(userCode)
                      .then(onCodeCopied)
                      .catch((err) =>
                        console.error("Failed to copy code:", err),
                      );
                  }}
                  title="Copy to clipboard"
                >
                  {codeCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Clipboard className="h-4 w-4" />
                  )}
                </button>
              </p>
            </div>
          )}
          {statusMessage && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {statusMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface GitHubRepoSetupFormProps {
  isExpanded: boolean;
  state: GitHubRepoSetupViewState;
  actions: GitHubRepoSetupViewActions;
  canSubmit: boolean;
  onExpand: () => void;
}

function GitHubRepoSetupForm({
  isExpanded,
  state,
  actions,
  canSubmit,
  onExpand,
}: GitHubRepoSetupFormProps) {
  const {
    mode,
    availableRepos,
    isLoadingRepos,
    selectedRepo,
    availableBranches,
    isLoadingBranches,
    selectedBranch,
    branchInputMode,
    customBranchName,
    repoName,
    repoAvailable,
    repoCheckError,
    isCheckingRepo,
    isCreatingRepo,
    createRepoError,
    createRepoSuccess,
  } = state;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await actions.submit();
  };

  return (
    <div className="w-full" data-testid="github-setup-repo">
      <button
        type="button"
        onClick={!isExpanded ? onExpand : undefined}
        className={`w-full p-4 text-left transition-colors rounded-md flex items-center justify-between ${
          !isExpanded
            ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
            : ""
        }`}
      >
        <span className="font-medium">Set up your GitHub repo</span>
        {isExpanded ? undefined : (
          <ChevronRight className="h-4 w-4 text-gray-500" />
        )}
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="p-4 pt-0 space-y-4">
          <div>
            <div className="flex rounded-md border border-gray-200 dark:border-gray-700">
              <Button
                type="button"
                variant={mode === "create" ? "default" : "ghost"}
                className={`flex-1 rounded-none rounded-l-md border-0 ${
                  mode === "create"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => actions.setMode("create")}
              >
                Create new repo
              </Button>
              <Button
                type="button"
                variant={mode === "existing" ? "default" : "ghost"}
                className={`flex-1 rounded-none rounded-r-md border-0 border-l border-gray-200 dark:border-gray-700 ${
                  mode === "existing"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => actions.setMode("existing")}
              >
                Connect to existing repo
              </Button>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "create" ? (
              <div>
                <Label className="block text-sm font-medium">
                  Repository Name
                </Label>
                <Input
                  data-testid="github-create-repo-name-input"
                  className="w-full mt-1"
                  value={repoName}
                  onChange={(e) => actions.setRepoName(e.target.value)}
                  disabled={isCreatingRepo}
                />
                {isCheckingRepo && (
                  <p className="text-xs text-gray-500 mt-1">
                    Checking availability...
                  </p>
                )}
                {repoAvailable === true && (
                  <p className="text-xs text-green-600 mt-1">
                    Repository name is available!
                  </p>
                )}
                {repoAvailable === false && (
                  <p className="text-xs text-red-600 mt-1">{repoCheckError}</p>
                )}
              </div>
            ) : (
              <div>
                <Label className="block text-sm font-medium">
                  Select Repository
                </Label>
                <Select
                  value={selectedRepo}
                  onValueChange={(v) => actions.selectRepo(v ?? "")}
                  disabled={isLoadingRepos}
                >
                  <SelectTrigger
                    className="w-full mt-1"
                    data-testid="github-repo-select"
                  >
                    <SelectValue
                      placeholder={
                        isLoadingRepos
                          ? "Loading repositories..."
                          : "Select a repository"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRepos.map((repo) => (
                      <SelectItem key={repo.full_name} value={repo.full_name}>
                        {repo.full_name} {repo.private && "(private)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="block text-sm font-medium">Branch</Label>
              {mode === "existing" && selectedRepo ? (
                <div className="space-y-2">
                  <Select
                    value={
                      branchInputMode === "select" ? selectedBranch : "custom"
                    }
                    onValueChange={(value) => {
                      if (value === "custom") {
                        actions.useCustomBranch();
                      } else if (value) {
                        actions.selectBranch(value);
                      }
                    }}
                    disabled={isLoadingBranches}
                  >
                    <SelectTrigger
                      className="w-full mt-1"
                      data-testid="github-branch-select"
                    >
                      <SelectValue
                        placeholder={
                          isLoadingBranches
                            ? "Loading branches..."
                            : "Select a branch"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableBranches.map((branch) => (
                        <SelectItem key={branch.name} value={branch.name}>
                          {branch.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">
                        <span className="font-medium">
                          ✏️ Type custom branch name
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {branchInputMode === "custom" && (
                    <Input
                      data-testid="github-custom-branch-input"
                      className="w-full"
                      value={customBranchName}
                      onChange={(e) => actions.setCustomBranch(e.target.value)}
                      placeholder="Enter branch name (e.g., feature/new-feature)"
                      disabled={isCreatingRepo}
                    />
                  )}
                </div>
              ) : (
                <Input
                  className="w-full mt-1"
                  value={selectedBranch}
                  onChange={(e) => actions.selectBranch(e.target.value)}
                  placeholder="main"
                  disabled={isCreatingRepo}
                  data-testid="github-new-repo-branch-input"
                />
              )}
            </div>

            <Button type="submit" disabled={!canSubmit}>
              {isCreatingRepo
                ? mode === "create"
                  ? "Creating..."
                  : "Connecting..."
                : mode === "create"
                  ? "Create Repo"
                  : "Connect to Repo"}
            </Button>
          </form>

          {createRepoError && (
            <p className="text-red-600 mt-2">{createRepoError}</p>
          )}
          {createRepoSuccess && (
            <p className="text-green-600 mt-2">
              {mode === "create"
                ? "Repository created and linked!"
                : "Connected to repository!"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function UnconnectedGitHubConnector({
  appId,
  folderName,
  settings,
  refreshSettings,
  handleRepoSetupComplete,
  expanded,
  linkedRepo,
}: UnconnectedGitHubConnectorProps) {
  // --- Collapsible State ---
  const [isExpanded, setIsExpanded] = useState(expanded || false);

  const handleConnected = useCallback(() => {
    setIsExpanded(true);
  }, []);

  const {
    flow: githubFlow,
    isConnecting: isConnectingToGithub,
    connect: handleConnectToGithub,
  } = useGitHubDeviceFlow({
    appId,
    refreshSettings,
    onConnected: handleConnected,
  });
  const {
    userCode: githubUserCode,
    verificationUri: githubVerificationUri,
    error: githubError,
    message: githubStatusMessage,
  } = githubFlow;
  const [codeCopied, setCodeCopied] = useState(false);

  const {
    state: repoSetup,
    actions: repoSetupActions,
    canSubmit: canSubmitRepoSetup,
  } = useGitHubRepoSetup({
    appId,
    folderName,
    hasGitHubCredentials: !!settings?.githubAccessToken,
    onSetupComplete: handleRepoSetupComplete,
  });

  if (!settings?.githubAccessToken) {
    return (
      <GitHubDeviceConnection
        linkedRepo={linkedRepo}
        isConnecting={isConnectingToGithub}
        userCode={githubUserCode}
        verificationUri={githubVerificationUri}
        error={githubError}
        statusMessage={githubStatusMessage}
        codeCopied={codeCopied}
        onConnect={handleConnectToGithub}
        onCodeCopied={() => {
          setCodeCopied(true);
          setTimeout(() => setCodeCopied(false), 2000);
        }}
      />
    );
  }

  return (
    <GitHubRepoSetupForm
      isExpanded={isExpanded}
      state={repoSetup}
      actions={repoSetupActions}
      canSubmit={canSubmitRepoSetup}
      onExpand={() => setIsExpanded(true)}
    />
  );
}

export function GitHubConnector({
  appId,
  folderName,
  expanded,
}: GitHubConnectorProps) {
  const { app, refreshApp } = useLoadApp(appId);
  const { settings, refreshSettings } = useSettings();
  const [pendingAutoSync, setPendingAutoSync] = useState(false);
  const linkedRepo =
    app?.githubOrg && app?.githubRepo
      ? { org: app.githubOrg, repo: app.githubRepo }
      : undefined;
  const hasGitHubCredentials = !!settings?.githubAccessToken;

  const handleRepoSetupComplete = useCallback(() => {
    setPendingAutoSync(true);
    refreshApp();
  }, [refreshApp]);

  const handleAutoSyncComplete = useCallback(() => {
    setPendingAutoSync(false);
  }, []);

  if (linkedRepo && hasGitHubCredentials && appId) {
    return (
      <ConnectedGitHubConnector
        appId={appId}
        app={app}
        refreshApp={refreshApp}
        triggerAutoSync={pendingAutoSync}
        onAutoSyncComplete={handleAutoSyncComplete}
      />
    );
  } else {
    return (
      <UnconnectedGitHubConnector
        appId={appId}
        folderName={folderName}
        settings={settings}
        refreshSettings={refreshSettings}
        handleRepoSetupComplete={handleRepoSetupComplete}
        expanded={expanded}
        linkedRepo={linkedRepo}
      />
    );
  }
}
