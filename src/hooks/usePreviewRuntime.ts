import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useChatWorkspaceStatus } from "@/hooks/useChatWorkspace";

export interface PreviewRuntime {
  /**
   * Runtime the preview shows: the selected chat's isolated workspace, or the
   * app itself. Null when no app is selected.
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
  const { data: status, errorUpdateCount } = useChatWorkspaceStatus(
    appId,
    chatId ?? undefined,
  );
  if (appId === null) {
    return { runtimeAppId: null, appId, resolved: true, isWorkspace: false };
  }
  if (chatId === null) {
    return { runtimeAppId: appId, appId, resolved: true, isWorkspace: false };
  }
  if (status && status.chatId === chatId) {
    // A chat from another app can be selected for a moment during
    // navigation; it never redirects this app's preview.
    if (status.appId !== appId) {
      return { runtimeAppId: appId, appId, resolved: true, isWorkspace: false };
    }
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
  return {
    runtimeAppId: appId,
    appId,
    resolved: errorUpdateCount > 0,
    isWorkspace: false,
  };
}
