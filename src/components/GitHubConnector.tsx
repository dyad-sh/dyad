import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Github,
  Clipboard,
  Check,
  CircleCheck,
  AlertTriangle,
  ChevronRight,
  FileCode2,
  GitMerge,
  LoaderCircle,
} from "lucide-react";
import { ipc } from "@/ipc/types";
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
import { CopyErrorMessage } from "@/components/CopyErrorMessage";
import { GithubBranchManager } from "@/components/GithubBranchManager";
import { useResolveMergeConflictsWithAI } from "@/hooks/useResolveMergeConflictsWithAI";
import { useChatStreamState } from "@/hooks/useChatStream";
import { slugifyAppPath } from "@/shared/slugify";
import {
  isAppliedGithubOpsReceipt,
  useGithubOps,
} from "@/github_ops/useGithubOps";
import {
  acknowledgeConnectionFlow,
  cancelConnectionFlow,
  startConnectionFlow,
  useConnectionFlow,
  useUnsolicitedConnectionReturn,
} from "@/hooks/useConnectionFlow";

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

function GitHubTroubleshootingLink({ className = "" }: { className?: string }) {
  return (
    <a
      onClick={(event) => {
        event.preventDefault();
        ipc.system.openExternalUrl(
          "https://www.dyad.sh/docs/integrations/github#troubleshooting",
        );
      }}
      className={`cursor-pointer text-blue-600 hover:underline dark:text-blue-400 ${className}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      See troubleshooting guide
    </a>
  );
}

function GitHubOperationError({ message }: { message: string }) {
  const showDetails = message.includes("\n") || message.length > 240;

  if (!showDetails) {
    return (
      <p className="text-red-600">
        {message} <GitHubTroubleshootingLink />
      </p>
    );
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50/70 p-3 dark:border-red-900 dark:bg-red-950/40">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-red-800 dark:text-red-200">
          GitHub operation failed
        </p>
        <CopyErrorMessage errorMessage={message} />
      </div>
      <div
        role="region"
        aria-label="GitHub error details"
        tabIndex={0}
        className="scrollbar-on-hover max-h-[min(50vh,20rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded border border-red-200/70 bg-white/60 p-2 font-mono text-xs whitespace-pre-wrap text-red-900 [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none dark:border-red-900 dark:bg-black/20 dark:text-red-100"
      >
        {message}
      </div>
      <GitHubTroubleshootingLink className="mt-2 inline-block text-sm" />
    </div>
  );
}

interface ConnectedGitHubConnectorProps {
  appId: number;
  app: any;
}

export interface UnconnectedGitHubConnectorProps {
  appId: number | null;
  folderName: string;
  settings: any;
  refreshSettings: () => void;
  expanded?: boolean;
  linkedRepo?: LinkedGitHubRepo;
}

function ConnectedGitHubConnector({
  appId,
  app,
}: ConnectedGitHubConnectorProps) {
  const [showForceDialog, setShowForceDialog] = useState(false);
  const {
    projection,
    connection,
    send,
    dispatchWithErrorFeedback,
    dispatchConflictResolutionStarted,
    dispatchConflictResolutionCancelled,
    conflictResolutionClaimed,
  } = useGithubOps(appId);
  const {
    banner,
    state: githubOpsState,
    capabilities: {
      canAbortRebase,
      canCancelSync,
      canContinueSync,
      canRetryConflictVerification,
      canContinueRebase,
      canDisconnect,
      canForcePush,
      canRebaseAndSync,
      canResolveConflicts,
      canSafeForcePush,
      canSync,
    },
    isOperationInFlight,
    isSyncing,
    conflicts,
    conflictRecoveryStage,
    conflictResolutionChatId,
    conflictVerificationError,
    syncContinuationOperation,
    rebaseAction,
    showForcePush,
    showRebaseAndSync,
    showRebaseRecoveryOptions,
    abortOperation,
    isCancellingSync,
    runningOperation,
  } = projection;

  const { resolveFilesWithAI, isResolving } = useResolveMergeConflictsWithAI({
    appId,
    conflicts,
    onStartResolving: dispatchConflictResolutionStarted,
    onStartFailed: dispatchConflictResolutionCancelled,
  });

  const conflictResolutionChat = useChatStreamState(
    conflictResolutionChatId ?? undefined,
  );

  useEffect(() => {
    if (
      conflictRecoveryStage !== "resolving" ||
      conflictResolutionChatId === null ||
      !conflictResolutionChat?.lastCompletion
    ) {
      return;
    }
    void dispatchWithErrorFeedback({
      type: "CONFLICT_RESOLUTION_FINISHED",
      chatId: conflictResolutionChatId,
    });
  }, [
    conflictRecoveryStage,
    conflictResolutionChatId,
    conflictResolutionChat?.lastCompletion,
    dispatchWithErrorFeedback,
  ]);

  const startConflictResolution = useCallback(async () => {
    const receipt = await dispatchWithErrorFeedback({
      type: "RESOLVE_WITH_AI_STARTED",
    });
    if (isAppliedGithubOpsReceipt(receipt)) {
      await resolveFilesWithAI(conflicts);
    }
  }, [conflicts, dispatchWithErrorFeedback, resolveFilesWithAI]);

  const isDisconnecting = runningOperation?.type === "disconnect";
  const isRebaseActionPending = isOperationInFlight || !!rebaseAction;
  const isSyncConflict =
    githubOpsState.type === "conflicted" &&
    (githubOpsState.origin.type === "push" ||
      githubOpsState.origin.type === "rebase" ||
      githubOpsState.origin.type === "rebase-continue");
  const showErrorBanner =
    banner?.kind === "error" &&
    (banner.code !== "MERGE_CONFLICT" || !conflictRecoveryStage);
  return (
    <div className="w-full" data-testid="github-connected-repo">
      {connection !== "ready" && (
        <p className="mb-2 text-sm text-muted-foreground">
          {connection === "connecting"
            ? "Loading repository status…"
            : "Repository controls are temporarily unavailable."}
        </p>
      )}
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
      {app.githubBranch && <GithubBranchManager appId={appId} />}
      <div className="mt-2 flex gap-2">
        <Button
          onClick={() =>
            send({
              type: "OP_REQUESTED",
              op: { type: "push", mode: "normal" },
            })
          }
          disabled={!canSync}
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
          onClick={() =>
            send({ type: "OP_REQUESTED", op: { type: "disconnect" } })
          }
          disabled={!canDisconnect}
          variant="outline"
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect from repo"}
        </Button>
      </div>
      {showErrorBanner && (
        <div className="mt-2 space-y-2">
          <GitHubOperationError message={banner.message} />
          {showRebaseRecoveryOptions && (
            <div className="space-y-2 rounded-md border border-orange-200 p-3 dark:border-orange-800 dark:bg-orange-900/20">
              <p className="text-sm text-orange-800 dark:text-orange-100">
                A rebase is already in progress. Choose how to proceed.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    send({
                      type: "OP_REQUESTED",
                      op: { type: "rebase-abort" },
                    })
                  }
                  variant="outline"
                  size="sm"
                  disabled={!canAbortRebase || isRebaseActionPending}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  {rebaseAction === "abort" ? "Aborting..." : "Abort rebase"}
                </Button>
                <Button
                  onClick={() =>
                    send({
                      type: "OP_REQUESTED",
                      op: { type: "rebase-continue" },
                    })
                  }
                  variant="outline"
                  size="sm"
                  disabled={!canContinueRebase || isRebaseActionPending}
                >
                  <GitMerge className="h-4 w-4 mr-2" />
                  {rebaseAction === "continue"
                    ? "Continuing..."
                    : "Continue rebase"}
                </Button>
                <Button
                  onClick={() =>
                    send({
                      type: "OP_REQUESTED",
                      op: { type: "push", mode: "lease" },
                    })
                  }
                  variant="outline"
                  size="sm"
                  disabled={!canSafeForcePush || isRebaseActionPending}
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
          {showForcePush && (
            <Button
              onClick={() => setShowForceDialog(true)}
              variant="outline"
              size="sm"
              disabled={!canForcePush || isRebaseActionPending}
              className="text-orange-600 border-orange-600 hover:bg-orange-50"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Force Push (Dangerous)
            </Button>
          )}
          {showRebaseAndSync && (
            <Button
              onClick={() =>
                send({ type: "OP_REQUESTED", op: { type: "rebase" } })
              }
              variant="outline"
              size="sm"
              disabled={!canRebaseAndSync || isRebaseActionPending}
              className="mt-2 ml-2"
            >
              <GitMerge className="h-4 w-4 mr-2" />
              Rebase and Sync
            </Button>
          )}
        </div>
      )}
      {conflictRecoveryStage && (
        <div
          className="mt-3 rounded-lg border border-border bg-muted/35 p-3.5"
          data-testid="github-conflict-recovery"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
              {conflictRecoveryStage === "resolving" ||
              conflictRecoveryStage === "checking" ? (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : conflictRecoveryStage === "verification-failed" ? (
                <AlertTriangle
                  className="size-4 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
              ) : conflictRecoveryStage === "ready-to-sync" ? (
                <CircleCheck
                  className="size-4 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
              ) : (
                <GitMerge className="size-4" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div role="status" aria-live="polite" aria-atomic="true">
                <p className="text-sm font-medium text-foreground">
                  {conflictRecoveryStage === "resolving"
                    ? "Resolving conflicts in chat…"
                    : conflictRecoveryStage === "checking"
                      ? "Verifying resolution…"
                      : conflictRecoveryStage === "verification-failed"
                        ? "Couldn't verify the resolution"
                        : conflictRecoveryStage === "ready-to-sync"
                          ? "Conflicts resolved"
                          : isSyncConflict
                            ? "Sync paused"
                            : "Merge paused"}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {conflictRecoveryStage === "resolving"
                    ? "Follow progress in the chat."
                    : conflictRecoveryStage === "checking"
                      ? "Checking the repository for remaining conflicts."
                      : conflictRecoveryStage === "verification-failed"
                        ? `${conflictVerificationError ?? "Dyad couldn't check the repository."} Your resolved changes are still safe.`
                        : conflictRecoveryStage === "ready-to-sync"
                          ? "Your changes are ready to sync to GitHub."
                          : `Resolve ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} to ${isSyncConflict ? "continue syncing" : "finish merging"}.`}
                </p>
              </div>

              {conflictRecoveryStage === "conflicted" && (
                <ul className="mt-2 space-y-1" aria-label="Conflicted files">
                  {conflicts.map((file) => (
                    <li
                      key={file}
                      className="flex min-w-0 items-center gap-2 text-sm text-foreground"
                    >
                      <FileCode2
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="truncate font-mono text-xs" title={file}>
                        {file}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {conflictRecoveryStage === "conflicted" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void startConflictResolution()}
                    disabled={
                      !canResolveConflicts ||
                      conflictResolutionClaimed ||
                      isCancellingSync ||
                      isResolving
                    }
                  >
                    {isResolving
                      ? "Opening chat…"
                      : conflictResolutionClaimed
                        ? "Opening chat…"
                        : "Resolve with AI"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      send({
                        type: "OP_REQUESTED",
                        op: { type: abortOperation },
                      })
                    }
                    disabled={!canCancelSync || isCancellingSync || isResolving}
                  >
                    {isCancellingSync
                      ? "Cancelling…"
                      : isSyncConflict
                        ? "Cancel sync"
                        : "Cancel merge"}
                  </Button>
                </div>
              )}

              {conflictRecoveryStage === "ready-to-sync" &&
                syncContinuationOperation && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!canContinueSync}
                      onClick={() =>
                        send({
                          type: "OP_REQUESTED",
                          op: syncContinuationOperation,
                        })
                      }
                    >
                      Continue to Sync
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canCancelSync || isCancellingSync}
                      onClick={() =>
                        send({
                          type: "OP_REQUESTED",
                          op: { type: abortOperation },
                        })
                      }
                    >
                      {isCancellingSync
                        ? "Cancelling…"
                        : isSyncConflict
                          ? "Cancel sync"
                          : "Cancel merge"}
                    </Button>
                  </div>
                )}

              {conflictRecoveryStage === "verification-failed" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={!canRetryConflictVerification}
                    onClick={() =>
                      send({ type: "RETRY_CONFLICT_VERIFICATION" })
                    }
                  >
                    Try again
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canCancelSync || isCancellingSync}
                    onClick={() =>
                      send({
                        type: "OP_REQUESTED",
                        op: { type: abortOperation },
                      })
                    }
                  >
                    {isCancellingSync
                      ? "Cancelling…"
                      : isSyncConflict
                        ? "Cancel sync"
                        : "Cancel merge"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {banner?.kind === "info" && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">
          {banner.message}
        </p>
      )}
      {banner?.kind === "success" && (
        <p className="text-green-600 mt-2">{banner.message}</p>
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
              onClick={() => {
                setShowForceDialog(false);
                send({
                  type: "OP_REQUESTED",
                  op: { type: "push", mode: "force" },
                });
              }}
              disabled={!canForcePush || isOperationInFlight}
            >
              {isSyncing ? "Force Pushing..." : "Force Push"}
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
  expanded,
  linkedRepo,
}: UnconnectedGitHubConnectorProps) {
  const { projection, send, connection } = useGithubOps(appId, {
    reconcileOnMount: linkedRepo !== undefined,
  });
  const { canConnectRepository } = projection.capabilities;
  // --- Collapsible State ---
  const [isExpanded, setIsExpanded] = useState(expanded || false);

  // --- GitHub Device Flow State ---
  // The flow itself lives in the main process (typed-ref-correlated state
  // machine); this component only projects it. Unmounting and remounting
  // re-projects the current flow, so a device poll that succeeds while this
  // component is unmounted is still reflected in the UI.
  const { flowState: githubFlowState, isFlowActive: isConnectingToGithub } =
    useConnectionFlow("github");
  const [codeCopied, setCodeCopied] = useState(false);

  const githubUserCode =
    githubFlowState.status === "awaiting-return"
      ? (githubFlowState.userCode ?? null)
      : null;
  const githubVerificationUri =
    githubFlowState.status === "awaiting-return"
      ? (githubFlowState.verificationUri ?? null)
      : null;
  const githubError =
    githubFlowState.status === "failed"
      ? (githubFlowState.message ?? "An unknown error occurred.")
      : null;
  const githubStatusMessage = (() => {
    switch (githubFlowState.status) {
      case "starting":
        return "Requesting device code from GitHub...";
      case "awaiting-return":
        return "Please authorize in your browser.";
      case "exchanging-token":
        return "Connecting to GitHub...";
      case "connected":
        return "Successfully connected to GitHub!";
      default:
        return null;
    }
  })();

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
  const isCreatingRepo = projection.runningOperation?.type === "connect-repo";
  const createRepoError =
    projection.banner?.kind === "error" ? projection.banner.message : null;
  const createRepoSuccess =
    projection.banner?.kind === "success" ? projection.banner.message : null;

  // Assume org is the authenticated user for now (could add org input later)
  const githubOrg = ""; // Use empty string for now (GitHub API will default to the authenticated user)

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleConnectToGithub = async () => {
    // Starting is a no-op while a flow is already active (double-click).
    await startConnectionFlow("github", { appId });
  };

  const refreshSettingsRef = useRef(refreshSettings);
  refreshSettingsRef.current = refreshSettings;

  useEffect(() => {
    const flow = githubFlowState;
    if (flow.status === "connected") {
      setIsExpanded(true);
      void (async () => {
        try {
          await refreshSettingsRef.current();
        } finally {
          await acknowledgeConnectionFlow("github", flow.invocationRef);
        }
      })();
    } else if (flow.status === "cancelled") {
      void acknowledgeConnectionFlow("github", flow.invocationRef);
    }
    // `failed` is deliberately not acknowledged: the error stays visible
    // until the user retries (starting a new flow is allowed from `failed`).
  }, [githubFlowState]);

  // A token that was written with no active flow (e.g. the user cancelled
  // while GitHub was already authorizing): refresh so the UI reflects it.
  useUnsolicitedConnectionReturn("github", () => {
    void refreshSettingsRef.current();
  });

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
            result.error || "Repository name is not available.",
          );
        }
      } catch (err: any) {
        setRepoCheckError(err.message || "Failed to check repo availability.");
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

  const handleSetupRepo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appId) return;

    if (repoSetupMode === "create") {
      send({
        type: "OP_REQUESTED",
        op: {
          type: "connect-repo",
          mode: "create",
          org: githubOrg,
          repo: repoName,
          branch: selectedBranch,
          thenAutoPush: true,
        },
      });
    } else {
      const [owner, repo] = selectedRepo.split("/");
      const branchToUse =
        branchInputMode === "custom" ? customBranchName : selectedBranch;
      send({
        type: "OP_REQUESTED",
        op: {
          type: "connect-repo",
          mode: "existing",
          owner,
          repo,
          branch: branchToUse,
          thenAutoPush: true,
        },
      });
    }
  };

  if (!settings?.githubAccessToken) {
    return (
      <div className="mt-1 w-full" data-testid="github-unconnected-repo">
        {linkedRepo && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-medium">Reconnect your GitHub account</p>
            <p className="mt-1">
              This app is linked to {linkedRepo.org}/{linkedRepo.repo}, but
              GitHub credentials are missing from settings.
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
          Connect to GitHub
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
            <h4 className="font-medium mb-2">GitHub Connection</h4>
            {githubError && (
              <p className="text-red-600 dark:text-red-400 mb-2">
                Error: {githubError}
              </p>
            )}
            {githubUserCode && githubVerificationUri && (
              <div className="mb-2">
                <p>
                  1. Go to:
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
                  2. Enter code:
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
            {githubStatusMessage && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {githubStatusMessage}
              </p>
            )}
            {isConnectingToGithub && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  if ("invocationRef" in githubFlowState) {
                    void cancelConnectionFlow(
                      "github",
                      githubFlowState.invocationRef,
                    );
                  }
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full" data-testid="github-setup-repo">
      {connection !== "ready" && (
        <p className="px-4 pt-2 text-sm text-muted-foreground">
          {connection === "connecting"
            ? "Loading GitHub controls…"
            : "GitHub controls are temporarily unavailable."}
        </p>
      )}
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
        <span className="font-medium">Set up your GitHub repo</span>
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
                  send({ type: "BANNER_DISMISSED" });
                }}
              >
                Create new repo
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
                  send({ type: "BANNER_DISMISSED" });
                }}
              >
                Connect to existing repo
              </Button>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSetupRepo}>
            {repoSetupMode === "create" ? (
              <>
                <div>
                  <Label className="block text-sm font-medium">
                    Repository Name
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
                      Checking availability...
                    </p>
                  )}
                  {repoAvailable === true && (
                    <p className="text-xs text-green-600 mt-1">
                      Repository name is available!
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
                    Select Repository
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
              </>
            )}

            {/* Branch Selection */}
            <div>
              <Label className="block text-sm font-medium">Branch</Label>
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
                      onChange={(e) => setCustomBranchName(e.target.value)}
                      placeholder="Enter branch name (e.g., feature/new-feature)"
                      disabled={isCreatingRepo}
                    />
                  )}
                </div>
              ) : (
                <Input
                  className="w-full mt-1"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  placeholder="main"
                  disabled={isCreatingRepo}
                  data-testid="github-new-repo-branch-input"
                />
              )}
            </div>

            <Button
              type="submit"
              disabled={
                !canConnectRepository ||
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
                  ? "Creating..."
                  : "Connecting..."
                : repoSetupMode === "create"
                  ? "Create Repo"
                  : "Connect to Repo"}
            </Button>
          </form>

          {createRepoError && (
            <div className="mt-2">
              <GitHubOperationError message={createRepoError} />
            </div>
          )}
          {createRepoSuccess && (
            <p className="text-green-600 mt-2">{createRepoSuccess}</p>
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
  const { app } = useLoadApp(appId);
  const { settings, refreshSettings } = useSettings();
  const linkedRepo =
    app?.githubOrg && app?.githubRepo
      ? { org: app.githubOrg, repo: app.githubRepo }
      : undefined;
  const hasGitHubCredentials = !!settings?.githubAccessToken;

  if (linkedRepo && hasGitHubCredentials && appId) {
    return <ConnectedGitHubConnector appId={appId} app={app} />;
  } else {
    return (
      <UnconnectedGitHubConnector
        appId={appId}
        folderName={folderName}
        settings={settings}
        refreshSettings={refreshSettings}
        expanded={expanded}
        linkedRepo={linkedRepo}
      />
    );
  }
}
