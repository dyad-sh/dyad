import { useState, useEffect, useCallback, useRef } from "react";
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
import { slugifyAppPath } from "@/shared/slugify";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

type SyncResult =
  | { error: Error; handled?: boolean }
  | { error?: undefined; handled?: boolean };

interface GitHubConnectorProps {
  appId: number | null;
  folderName: string;
  expanded?: boolean;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
}

interface GitHubBranch {
  name: string;
  commit: { sha: string };
}

interface LinkedGitHubRepo {
  org: string;
  repo: string;
}

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
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
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

  const handleCancelSync = async () => {
    setIsCancellingSync(true);
    try {
      const state = await ipc.github.getGitState({ appId });
      let aborted = false;
      if (state.rebaseInProgress) {
        await ipc.github.rebaseAbort({ appId });
        updateSyncState({
          rebaseInProgress: false,
          rebaseStatusMessage: t("integrations.github.rebaseAborted"),
        });
        aborted = true;
      } else if (state.mergeInProgress) {
        await ipc.github.mergeAbort({ appId });
        aborted = true;
      }
      updateSyncState({ conflicts: [], syncError: null });
      if (aborted) {
        showSuccess(t("integrations.github.syncCancelled"));
      }
    } catch (error: any) {
      showError(error?.message || t("integrations.github.failedCancelSync"));
    } finally {
      setIsCancellingSync(false);
    }
  };

  const handleDisconnectRepo = async () => {
    setIsDisconnecting(true);
    setDisconnectError(null);
    try {
      await ipc.github.disconnect({ appId });
      // Clear stale sync state so reconnecting to a different repo doesn't
      // show a success/error message from the previous repo.
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
    } catch (err: any) {
      setDisconnectError(
        err.message || t("integrations.github.failedDisconnectRepo"),
      );
    } finally {
      setIsDisconnecting(false);
    }
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
        await ipc.github.push({
          appId,
          force,
          forceWithLease,
        });
        updateSyncState({
          syncSuccess: true,
          rebaseInProgress: false,
          conflicts: [], // Clear conflicts on successful sync
          rebaseStatusMessage: null,
        });
        // Toast so the user sees the result even if they navigated away
        // from the Publish tab while the push was running.
        showSuccess(t("integrations.github.pushedSuccess"));
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
            syncError: t("integrations.github.mergeConflicts"),
          });
          showError(t("integrations.github.mergeConflicts"));
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
          const msg = t("integrations.github.mergeConflictNoFiles");
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

        const baseErrorMessage =
          err.message || t("integrations.github.failedSync");
        const conflictCheckMessage =
          conflictCheckError instanceof Error
            ? ` ${t("integrations.github.conflictCheckFailed", { error: conflictCheckError.message })}`
            : conflictCheckError
              ? ` ${t("integrations.github.conflictCheckFailedGeneric")}`
              : "";
        const finalErrorMessage = `${baseErrorMessage}${conflictCheckMessage}`;
        updateSyncState({
          syncError: finalErrorMessage,
          rebaseInProgress: rebaseInProgressState,
          rebaseStatusMessage: null,
        });
        showError(
          t("integrations.github.failedSyncWithDetails", {
            error: finalErrorMessage,
          }),
        );
        return { error: err };
      } finally {
        updateSyncState({ isSyncing: false });
      }
    },
    [appId, updateSyncState],
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
        rebaseStatusMessage: t("integrations.github.rebaseAborted"),
      });
    } catch (err: any) {
      updateSyncState({
        syncError: err.message || t("integrations.github.failedAbortRebase"),
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
        rebaseStatusMessage: t("integrations.github.rebaseContinued"),
      });
    } catch (err: any) {
      updateSyncState({
        syncError: err.message || t("integrations.github.failedContinueRebase"),
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
        rebaseStatusMessage: t("integrations.github.rebaseAndSyncSuccess"),
      });
    } catch (err: any) {
      if (err?.handled) {
        return;
      }
      const errorMessage =
        err?.message || t("integrations.github.failedRebaseAndSync");
      updateSyncState({
        syncError: errorMessage,
        rebaseInProgress: errorMessage.includes("rebase-merge"),
      });
      // If rebase failed, show appropriate message
      if (errorMessage.includes("rebase")) {
        updateSyncState({
          rebaseStatusMessage: t("integrations.github.rebaseFailed"),
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

  return (
    <div className="w-full" data-testid="github-connected-repo">
      <p>{t("integrations.github.connectedToRepo")}</p>
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
              {t("integrations.github.syncing")}
            </>
          ) : (
            t("integrations.github.syncToGithub")
          )}
        </Button>
        <Button
          onClick={handleDisconnectRepo}
          disabled={isDisconnecting}
          variant="outline"
        >
          {isDisconnecting
            ? t("common:disconnecting")
            : t("integrations.github.disconnectFromRepo")}
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
              {t("integrations.github.seeTroubleshooting")}
            </a>
          </p>
          {showRebaseRecoveryOptions && (
            <div className="space-y-2 rounded-md border border-orange-200 p-3 dark:border-orange-800 dark:bg-orange-900/20">
              <p className="text-sm text-orange-800 dark:text-orange-100">
                {t("integrations.github.rebaseInProgress")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleAbortRebase}
                  variant="outline"
                  size="sm"
                  disabled={isRebaseActionPending}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  {rebaseAction === "abort"
                    ? t("integrations.github.aborting")
                    : t("integrations.github.abortRebase")}
                </Button>
                <Button
                  onClick={handleContinueRebase}
                  variant="outline"
                  size="sm"
                  disabled={isRebaseActionPending}
                >
                  <GitMerge className="h-4 w-4 mr-2" />
                  {rebaseAction === "continue"
                    ? t("integrations.github.continuing")
                    : t("integrations.github.continueRebase")}
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
                    ? t("integrations.github.safeForcePushing")
                    : t("integrations.github.safeForcesPush")}
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
              {t("integrations.github.forcePushDangerous")}
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
              {t("integrations.github.rebaseAndSync")}
            </Button>
          )}
        </div>
      )}
      {/* Conflict Resolution Buttons */}
      {conflicts.length > 0 && (
        <div className="mt-3 p-3 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20">
          <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
            {t(
              conflicts.length === 1
                ? "integrations.github.conflictFile"
                : "integrations.github.conflictFiles",
              { count: conflicts.length },
            )}
            : {conflicts.join(", ")}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={resolveWithAI}
              disabled={isCancellingSync || isResolving}
            >
              {isResolving
                ? t("integrations.github.resolving")
                : t("integrations.github.resolveConflictsWithAi")}
            </Button>
            <Button
              variant="outline"
              onClick={handleCancelSync}
              disabled={isCancellingSync || isResolving}
            >
              {isCancellingSync
                ? t("integrations.github.cancelling")
                : t("integrations.github.cancelSync")}
            </Button>
          </div>
        </div>
      )}
      {rebaseStatusMessage && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">
          {rebaseStatusMessage}
        </p>
      )}
      {syncSuccess && (
        <p className="text-green-600 mt-2">
          {t("integrations.github.pushedSuccess")}
        </p>
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
              {t("integrations.github.forcePushWarning")}
            </DialogTitle>
            <DialogDescription>
              <div className="space-y-3">
                <p>{t("integrations.github.forcePushDescription")}</p>
                <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-md border border-orange-200 dark:border-orange-800">
                  <p className="text-sm text-orange-800 dark:text-orange-200">
                    <strong>
                      {t("integrations.github.dangerousNonReversible")}
                    </strong>
                  </p>
                  <ul className="text-sm text-orange-700 dark:text-orange-300 list-disc list-inside mt-2 space-y-1">
                    <li>{t("integrations.github.overwriteRemote")}</li>
                    <li>{t("integrations.github.deleteRemoteCommits")}</li>
                  </ul>
                </div>
                <p className="text-sm">
                  {t("integrations.github.onlyProceedCertain")}
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceDialog(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleSyncToGithub({ force: true })}
              disabled={isSyncing}
            >
              {isSyncing
                ? t("integrations.github.forcePushing")
                : t("integrations.github.forcePush")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const { t } = useTranslation(["home", "common"]);
  // --- Collapsible State ---
  const [isExpanded, setIsExpanded] = useState(expanded || false);

  // --- GitHub Device Flow State ---
  const [githubUserCode, setGithubUserCode] = useState<string | null>(null);
  const [githubVerificationUri, setGithubVerificationUri] = useState<
    string | null
  >(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [isConnectingToGithub, setIsConnectingToGithub] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | null>(
    null,
  );
  const [codeCopied, setCodeCopied] = useState(false);

  // --- Repo Setup State ---
  const [repoSetupMode, setRepoSetupMode] = useState<"create" | "existing">(
    "create",
  );
  const [availableRepos, setAvailableRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [availableBranches, setAvailableBranches] = useState<GitHubBranch[]>(
    [],
  );
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>("main");
  const [branchInputMode, setBranchInputMode] = useState<"select" | "custom">(
    "select",
  );
  const [customBranchName, setCustomBranchName] = useState<string>("");

  // Create new repo state. Seed with a kebab-case slug of the app name (the
  // same transform used for the app folder path) so the repo name is a valid
  // Vercel project name by default.
  const [repoName, setRepoName] = useState(() => slugifyAppPath(folderName));
  const [repoAvailable, setRepoAvailable] = useState<boolean | null>(null);
  const [repoCheckError, setRepoCheckError] = useState<string | null>(null);
  const [isCheckingRepo, setIsCheckingRepo] = useState(false);
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);
  const [createRepoError, setCreateRepoError] = useState<string | null>(null);
  const [createRepoSuccess, setCreateRepoSuccess] = useState<boolean>(false);

  // Assume org is the authenticated user for now (could add org input later)
  const githubOrg = ""; // Use empty string for now (GitHub API will default to the authenticated user)

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleConnectToGithub = async () => {
    setIsConnectingToGithub(true);
    setGithubError(null);
    setGithubUserCode(null);
    setGithubVerificationUri(null);
    setGithubStatusMessage(t("integrations.github.requestingDeviceCode"));

    // Send IPC message to main process to start the flow
    ipc.github.startFlow({ appId });
  };

  useEffect(() => {
    const cleanupFunctions: (() => void)[] = [];

    // Listener for updates (user code, verification uri, status messages)
    const removeUpdateListener = ipc.events.github.onFlowUpdate((data) => {
      if (data.userCode) {
        setGithubUserCode(data.userCode);
      }
      if (data.verificationUri) {
        setGithubVerificationUri(data.verificationUri);
      }
      if (data.message) {
        setGithubStatusMessage(data.message);
      }

      setGithubError(null); // Clear previous errors on new update
      if (!data.userCode && !data.verificationUri && data.message) {
        // Likely just a status message, keep connecting state
        setIsConnectingToGithub(true);
      }
      if (data.userCode && data.verificationUri) {
        setIsConnectingToGithub(true); // Still connecting until success/error
      }
    });
    cleanupFunctions.push(removeUpdateListener);

    // Listener for success
    const removeSuccessListener = ipc.events.github.onFlowSuccess(() => {
      setGithubStatusMessage(t("integrations.github.connected"));
      setGithubUserCode(null); // Clear user-facing info
      setGithubVerificationUri(null);
      setGithubError(null);
      setIsConnectingToGithub(false);
      refreshSettings();
      setIsExpanded(true);
    });
    cleanupFunctions.push(removeSuccessListener);

    // Listener for errors
    const removeErrorListener = ipc.events.github.onFlowError((data) => {
      setGithubError(data.error || t("common:unknownError"));
      setGithubStatusMessage(null);
      setGithubUserCode(null);
      setGithubVerificationUri(null);
      setIsConnectingToGithub(false);
    });
    cleanupFunctions.push(removeErrorListener);

    // Cleanup function to remove all listeners when component unmounts or appId changes
    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
      // Reset state when appId changes or component unmounts
      setGithubUserCode(null);
      setGithubVerificationUri(null);
      setGithubError(null);
      setIsConnectingToGithub(false);
      setGithubStatusMessage(null);
    };
  }, []); // Re-run effect if appId changes

  // Load available repos when GitHub is connected
  useEffect(() => {
    if (settings?.githubAccessToken && repoSetupMode === "existing") {
      loadAvailableRepos();
    }
  }, [settings?.githubAccessToken, repoSetupMode]);

  const loadAvailableRepos = async () => {
    setIsLoadingRepos(true);
    try {
      const repos = await ipc.github.listRepos();
      setAvailableRepos(repos);
    } catch (error) {
      console.error("Failed to load GitHub repos:", error);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  // Load branches when a repo is selected
  useEffect(() => {
    if (selectedRepo && repoSetupMode === "existing") {
      loadRepoBranches();
    }
  }, [selectedRepo, repoSetupMode]);

  const loadRepoBranches = async () => {
    if (!selectedRepo) return;

    setIsLoadingBranches(true);
    setBranchInputMode("select"); // Reset to select mode when loading new repo
    setCustomBranchName(""); // Clear custom branch name
    try {
      const [owner, repo] = selectedRepo.split("/");
      const branches = await ipc.github.getRepoBranches({ owner, repo });
      setAvailableBranches(branches);
      // Default to main if available, otherwise first branch
      const defaultBranch =
        branches.find((b) => b.name === "main" || b.name === "master") ||
        branches[0];
      if (defaultBranch) {
        setSelectedBranch(defaultBranch.name);
      }
    } catch (error) {
      console.error("Failed to load repo branches:", error);
    } finally {
      setIsLoadingBranches(false);
    }
  };

  const checkRepoAvailability = useCallback(
    async (name: string) => {
      setRepoCheckError(null);
      setRepoAvailable(null);
      if (!name) return;
      setIsCheckingRepo(true);
      try {
        const result = await ipc.github.isRepoAvailable({
          org: githubOrg,
          repo: name,
        });
        setRepoAvailable(result.available);
        if (!result.available) {
          setRepoCheckError(
            result.error || t("integrations.github.repositoryUnavailable"),
          );
        }
      } catch (err: any) {
        setRepoCheckError(
          err.message || t("integrations.github.failedCheckRepository"),
        );
      } finally {
        setIsCheckingRepo(false);
      }
    },
    [githubOrg],
  );

  const debouncedCheckRepoAvailability = useCallback(
    (name: string) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        checkRepoAvailability(name);
      }, 500);
    },
    [checkRepoAvailability],
  );

  const handleSetupRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appId) return;

    setCreateRepoError(null);
    setIsCreatingRepo(true);
    setCreateRepoSuccess(false);

    try {
      if (repoSetupMode === "create") {
        await ipc.github.createRepo({
          org: githubOrg,
          repo: repoName,
          appId,
          branch: selectedBranch,
        });
      } else {
        const [owner, repo] = selectedRepo.split("/");
        const branchToUse =
          branchInputMode === "custom" ? customBranchName : selectedBranch;
        await ipc.github.connectExistingRepo({
          owner,
          repo,
          branch: branchToUse,
          appId,
        });
      }

      setCreateRepoSuccess(true);
      setRepoCheckError(null);
      handleRepoSetupComplete();
    } catch (err: any) {
      setCreateRepoError(
        err.message ||
          (repoSetupMode === "create"
            ? t("integrations.github.failedCreateRepository")
            : t("integrations.github.failedConnectRepository")),
      );
    } finally {
      setIsCreatingRepo(false);
    }
  };

  if (!settings?.githubAccessToken) {
    return (
      <div className="mt-1 w-full" data-testid="github-unconnected-repo">
        {linkedRepo && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-medium">
              {t("integrations.github.reconnectAccount")}
            </p>
            <p className="mt-1">
              {t("integrations.github.credentialsMissing", {
                repository: `${linkedRepo.org}/${linkedRepo.repo}`,
              })}
            </p>
          </div>
        )}
        <Button
          onClick={handleConnectToGithub}
          className="cursor-pointer w-full py-5 flex justify-center items-center gap-2"
          size="lg"
          variant="outline"
          disabled={isConnectingToGithub} // Also disable if appId is null
        >
          {t("integrations.github.connectToGithub")}
          <Github className="h-5 w-5" />
          {isConnectingToGithub && (
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

        {/* GitHub Connection Status/Instructions */}
        {(githubUserCode || githubStatusMessage || githubError) && (
          <div className="mt-6 p-4 border rounded-md bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600">
            <h4 className="font-medium mb-2">
              {t("integrations.github.githubConnection")}
            </h4>
            {githubError && (
              <p className="text-red-600 dark:text-red-400 mb-2">
                {t("common:error")}: {githubError}
              </p>
            )}
            {githubUserCode && githubVerificationUri && (
              <div className="mb-2">
                <p>
                  {t("integrations.github.goTo")}
                  <a
                    href={githubVerificationUri} // Make it a direct link
                    onClick={(e) => {
                      e.preventDefault();
                      ipc.system.openExternalUrl(githubVerificationUri);
                    }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {githubVerificationUri}
                  </a>
                </p>
                <p>
                  {t("integrations.github.enterCode")}
                  <strong className="ml-1 font-mono text-lg tracking-wider bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded">
                    {githubUserCode}
                  </strong>
                  <button
                    className="ml-2 p-1 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 focus:outline-none"
                    onClick={() => {
                      if (githubUserCode) {
                        navigator.clipboard
                          .writeText(githubUserCode)
                          .then(() => {
                            setCodeCopied(true);
                            setTimeout(() => setCodeCopied(false), 2000);
                          })
                          .catch((err) =>
                            console.error("Failed to copy code:", err),
                          );
                      }
                    }}
                    title={t("common:copyToClipboard")}
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
            {githubStatusMessage && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {githubStatusMessage}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full" data-testid="github-setup-repo">
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={!isExpanded ? () => setIsExpanded(true) : undefined}
        className={`w-full p-4 text-left transition-colors rounded-md flex items-center justify-between ${
          !isExpanded
            ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
            : ""
        }`}
      >
        <span className="font-medium">
          {t("integrations.github.setupGithubRepo")}
        </span>
        {isExpanded ? undefined : (
          <ChevronRight className="h-4 w-4 text-gray-500" />
        )}
      </button>

      {/* Collapsible Content */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="p-4 pt-0 space-y-4">
          {/* Mode Selection */}
          <div>
            <div className="flex rounded-md border border-gray-200 dark:border-gray-700">
              <Button
                type="button"
                variant={repoSetupMode === "create" ? "default" : "ghost"}
                className={`flex-1 rounded-none rounded-l-md border-0 ${
                  repoSetupMode === "create"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => {
                  setRepoSetupMode("create");
                  setCreateRepoError(null);
                  setCreateRepoSuccess(false);
                }}
              >
                {t("integrations.github.createNewRepo")}
              </Button>
              <Button
                type="button"
                variant={repoSetupMode === "existing" ? "default" : "ghost"}
                className={`flex-1 rounded-none rounded-r-md border-0 border-l border-gray-200 dark:border-gray-700 ${
                  repoSetupMode === "existing"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => {
                  setRepoSetupMode("existing");
                  setCreateRepoError(null);
                  setCreateRepoSuccess(false);
                }}
              >
                {t("integrations.github.connectExistingRepo")}
              </Button>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSetupRepo}>
            {repoSetupMode === "create" ? (
              <>
                <div>
                  <Label className="block text-sm font-medium">
                    {t("integrations.github.repositoryName")}
                  </Label>
                  <Input
                    data-testid="github-create-repo-name-input"
                    className="w-full mt-1"
                    value={repoName}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setRepoName(newValue);
                      setRepoAvailable(null);
                      setRepoCheckError(null);
                      debouncedCheckRepoAvailability(newValue);
                    }}
                    disabled={isCreatingRepo}
                  />
                  {isCheckingRepo && (
                    <p className="text-xs text-gray-500 mt-1">
                      {t("integrations.github.checkingAvailability")}
                    </p>
                  )}
                  {repoAvailable === true && (
                    <p className="text-xs text-green-600 mt-1">
                      {t("integrations.github.repoAvailable")}
                    </p>
                  )}
                  {repoAvailable === false && (
                    <p className="text-xs text-red-600 mt-1">
                      {repoCheckError}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label className="block text-sm font-medium">
                    {t("integrations.github.selectRepository")}
                  </Label>
                  <Select
                    value={selectedRepo}
                    onValueChange={(v) => setSelectedRepo(v ?? "")}
                    disabled={isLoadingRepos}
                  >
                    <SelectTrigger
                      className="w-full mt-1"
                      data-testid="github-repo-select"
                    >
                      <SelectValue
                        placeholder={
                          isLoadingRepos
                            ? t("integrations.github.loadingRepositories")
                            : t("integrations.github.selectARepository")
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRepos.map((repo) => (
                        <SelectItem key={repo.full_name} value={repo.full_name}>
                          {repo.full_name}{" "}
                          {repo.private &&
                            `(${t("integrations.github.private")})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Branch Selection */}
            <div>
              <Label className="block text-sm font-medium">
                {t("integrations.github.branch")}
              </Label>
              {repoSetupMode === "existing" && selectedRepo ? (
                <div className="space-y-2">
                  <Select
                    value={
                      branchInputMode === "select" ? selectedBranch : "custom"
                    }
                    onValueChange={(value) => {
                      if (value === "custom") {
                        setBranchInputMode("custom");
                        setCustomBranchName("");
                      } else if (value) {
                        setBranchInputMode("select");
                        setSelectedBranch(value);
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
                            ? t("integrations.github.loadingBranches")
                            : t("integrations.github.selectABranch")
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
                          ✏️ {t("integrations.github.typeCustomBranch")}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {branchInputMode === "custom" && (
                    <Input
                      data-testid="github-custom-branch-input"
                      className="w-full"
                      value={customBranchName}
                      onChange={(e) => setCustomBranchName(e.target.value)}
                      placeholder={t("integrations.github.enterBranchName")}
                      disabled={isCreatingRepo}
                    />
                  )}
                </div>
              ) : (
                <Input
                  className="w-full mt-1"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  placeholder={t("integrations.github.mainBranch")}
                  disabled={isCreatingRepo}
                  data-testid="github-new-repo-branch-input"
                />
              )}
            </div>

            <Button
              type="submit"
              disabled={
                isCreatingRepo ||
                (repoSetupMode === "create" &&
                  (repoAvailable === false || !repoName)) ||
                (repoSetupMode === "existing" &&
                  (!selectedRepo ||
                    !selectedBranch ||
                    (branchInputMode === "custom" && !customBranchName.trim())))
              }
            >
              {isCreatingRepo
                ? repoSetupMode === "create"
                  ? t("common:creating")
                  : t("common:connecting")
                : repoSetupMode === "create"
                  ? t("integrations.github.createRepo")
                  : t("integrations.github.connectToRepo")}
            </Button>
          </form>

          {createRepoError && (
            <p className="text-red-600 mt-2">{createRepoError}</p>
          )}
          {createRepoSuccess && (
            <p className="text-green-600 mt-2">
              {repoSetupMode === "create"
                ? t("integrations.github.repoCreatedLinked")
                : t("integrations.github.connectedToRepo2")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function GitHubConnector({
  appId,
  folderName,
  expanded,
}: GitHubConnectorProps) {
  const { app, refreshApp } = useLoadApp(appId);
  const queryClient = useQueryClient();
  const { settings, refreshSettings } = useSettings();
  const [pendingAutoSync, setPendingAutoSync] = useState(false);
  const linkedRepo =
    app?.githubOrg && app?.githubRepo
      ? { org: app.githubOrg, repo: app.githubRepo }
      : undefined;
  const hasGitHubCredentials = !!settings?.githubAccessToken;

  const refreshAppData = useCallback(() => {
    void refreshApp();
    void queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
  }, [queryClient, refreshApp]);

  const handleRepoSetupComplete = useCallback(() => {
    setPendingAutoSync(true);
    refreshAppData();
  }, [refreshAppData]);

  const handleAutoSyncComplete = useCallback(() => {
    setPendingAutoSync(false);
  }, []);

  if (linkedRepo && hasGitHubCredentials && appId) {
    return (
      <ConnectedGitHubConnector
        appId={appId}
        app={app}
        refreshApp={refreshAppData}
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
