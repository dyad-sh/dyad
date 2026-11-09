import type {
  AppWorkspaceOverview,
  ChatWorkspaceStatus,
  WorkspaceIntegrationPhase,
} from "@/ipc/types";

/**
 * Translation key (under `chat:workspace`) describing integration progress.
 * Integration is shown separately from the agent's own completion: a
 * finished response is not "merged" until this says so.
 */
export function integrationStatusKey(
  phase: WorkspaceIntegrationPhase,
):
  | "statusQueued"
  | "statusMerging"
  | "statusResolvingConflicts"
  | "statusValidating"
  | "statusIntegrating"
  | "statusMerged"
  | "statusPaused"
  | "statusFailed"
  | null {
  switch (phase) {
    case "idle":
      return null;
    case "queued":
      return "statusQueued";
    case "merging":
      return "statusMerging";
    case "resolving-conflicts":
      return "statusResolvingConflicts";
    case "validating":
      return "statusValidating";
    case "integrating":
      return "statusIntegrating";
    case "merged":
      return "statusMerged";
    case "paused":
      return "statusPaused";
    case "failed":
      return "statusFailed";
  }
}

export function integrationTone(
  phase: WorkspaceIntegrationPhase,
): "neutral" | "progress" | "success" | "attention" {
  switch (phase) {
    case "merged":
      return "success";
    case "paused":
    case "failed":
      return "attention";
    case "queued":
    case "merging":
    case "resolving-conflicts":
    case "validating":
    case "integrating":
      return "progress";
    case "idle":
      return "neutral";
  }
}

/**
 * The branch indicator is part of worktree isolation: shown while the
 * setting is on, and for any chat that already has an isolated workspace
 * (which keeps working after the setting is turned off).
 */
export function shouldShowWorkspaceIndicator(
  status: ChatWorkspaceStatus | undefined,
  isolationEnabled: boolean,
): boolean {
  if (!status) return false;
  return status.kind === "isolated" || isolationEnabled;
}

/**
 * Warn when another chat is changing the same app while isolation is off, so
 * this chat's next writable turn would share the app's folder with it.
 */
export function shouldShowConcurrentChatBanner({
  overview,
  chatId,
  isolationEnabled,
  dismissedAppIds,
}: {
  overview: AppWorkspaceOverview | undefined;
  chatId: number | undefined;
  /** From the renderer's settings, so enabling hides the banner at once. */
  isolationEnabled: boolean;
  dismissedAppIds: ReadonlySet<number>;
}): boolean {
  if (!overview || chatId === undefined) return false;
  if (isolationEnabled) return false;
  if (dismissedAppIds.has(overview.appId)) return false;
  return overview.writableChatIds.some((id) => id !== chatId);
}

/**
 * Warn a chat whose worktree installs with npm: every worktree then gets its
 * own full copy of node_modules, which adds up across chats. pnpm links
 * packages from one shared store instead.
 */
export function shouldShowNpmWorktreeBanner({
  status,
  chatId,
  dismissedAppIds,
}: {
  status: ChatWorkspaceStatus | undefined;
  chatId: number | undefined;
  dismissedAppIds: ReadonlySet<number>;
}): boolean {
  if (!status || chatId === undefined || status.chatId !== chatId) {
    return false;
  }
  return (
    status.kind === "isolated" &&
    status.packageManager === "npm" &&
    !dismissedAppIds.has(status.appId)
  );
}

/**
 * Whether the chat's worktree can be deleted now: it exists, and neither the
 * chat's agent nor a merge step is working in it. Merged or not does not
 * matter; the confirmation explains what happens to unmerged work.
 */
export function canDeleteChatWorkspace(
  status: ChatWorkspaceStatus | undefined,
): boolean {
  if (!status || status.kind !== "isolated" || status.writableTurnRunning) {
    return false;
  }
  const phase = status.integration?.phase;
  return (
    phase !== "merging" &&
    phase !== "resolving-conflicts" &&
    phase !== "validating" &&
    phase !== "integrating"
  );
}
