import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import {
  useAppWorkspaceOverview,
  useChatWorkspaceStatus,
} from "@/hooks/useChatWorkspace";
import { workspaceRuntimeId } from "../../shared/workspace_runtime_id";

export interface PreviewRuntime {
  /**
   * Runtime the preview shows: the selected chat's isolated workspace, or the
   * app itself. Null when no app is selected, and while the selected chat's
   * workspace is still unknown (`resolved` is false).
   */
  runtimeAppId: number | null;
  /** The app the preview belongs to (app-level features stay keyed by it). */
  appId: number | null;
  /** False while the selected chat's workspace is still being looked up. */
  resolved: boolean;
  /** Whether the preview shows an isolated workspace, not the app's folder. */
  isWorkspace: boolean;
}

/**
 * The preview follows the selected chat's workspace: a chat in the app's
 * original folder previews that folder; an isolated chat previews its
 * worktree. Switching chats switches the preview without touching any
 * runtime an agent is using.
 */
export function usePreviewRuntime(): PreviewRuntime {
  const appId = useAtomValue(selectedAppIdAtom);
  const chatId = useAtomValue(selectedChatIdAtom);
  const nativeViewAppId = useAtomValue(previewNativeViewAppIdAtom);
  const {
    data: status,
    isSuccess: statusKnown,
    errorUpdateCount,
  } = useChatWorkspaceStatus(appId, chatId ?? undefined);
  const { data: overview } = useAppWorkspaceOverview(appId);
  if (appId === null) {
    return { runtimeAppId: null, appId, resolved: true, isWorkspace: false };
  }
  const appFolder: PreviewRuntime = {
    runtimeAppId: appId,
    appId,
    resolved: true,
    isWorkspace: false,
  };
  // A preview-driven test run drives the app's own runtime in the native
  // view, whichever chat is selected.
  if (nativeViewAppId === appId) return appFolder;
  if (chatId === null) return appFolder;
  if (statusKnown) {
    // No status means the chat belongs to another app, which can be selected
    // for a moment during navigation; it never redirects this app's preview.
    if (!status || status.chatId !== chatId) return appFolder;
    return {
      runtimeAppId: status.runtimeAppId,
      appId,
      resolved: true,
      isWorkspace: status.kind === "isolated",
    };
  }
  // Once the lookup has failed, the preview stays on the app's own folder.
  // A query that never succeeded returns to "pending" on every refetch, and
  // treating that as unresolved again would restart the preview each time
  // workspace state changes.
  if (errorUpdateCount > 0) return appFolder;
  // While the chat's own lookup is in flight, the app's list of isolated
  // workspaces (loaded once per app) already says where the chat runs, so
  // switching chats neither blanks nor reloads the preview.
  if (overview?.appId === appId) {
    const workspace = overview.workspaces.find(
      (candidate) => candidate.chatId === chatId,
    );
    if (!workspace) return appFolder;
    return {
      runtimeAppId: workspaceRuntimeId(workspace.workspaceId),
      appId,
      resolved: true,
      isWorkspace: true,
    };
  }
  // Nothing is known yet: show no runtime rather than the app's folder, which
  // an isolated chat does not preview.
  return { runtimeAppId: null, appId, resolved: false, isWorkspace: false };
}
