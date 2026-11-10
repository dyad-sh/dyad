import { useAtom } from "jotai";
import { GitFork } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SkippableBanner } from "@/components/chat/SkippableBanner";
import { dismissedConcurrentChatBannerAppIdsAtom } from "@/atoms/workspaceAtoms";
import { useAppWorkspaceOverview } from "@/hooks/useChatWorkspace";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess } from "@/lib/toast";
import { shouldShowConcurrentChatBanner } from "./workspace_status";

/**
 * Shown while another chat is changing the same app and worktree isolation is
 * off: both chats would edit (and checkpoint) the same folder.
 */
export function ConcurrentChatBanner({
  appId,
  chatId,
}: {
  appId: number | null;
  chatId: number | undefined;
}) {
  const { t } = useTranslation("chat");
  const { data: overview } = useAppWorkspaceOverview(appId);
  const { settings, updateSettings } = useSettings();
  const [dismissedAppIds, setDismissedAppIds] = useAtom(
    dismissedConcurrentChatBannerAppIdsAtom,
  );

  if (
    // Until settings load, whether isolation is already on is unknown, so
    // neither the warning nor its Enable action can be trusted yet.
    !settings ||
    !shouldShowConcurrentChatBanner({
      overview,
      chatId,
      isolationEnabled: !!settings.enableWorktreeIsolation,
      dismissedAppIds,
    })
  ) {
    return null;
  }

  return (
    <SkippableBanner
      icon={GitFork}
      variant="warning"
      data-testid="concurrent-chat-banner"
      message={t("workspace.concurrentBannerMessage")}
      enableLabel={t("workspace.concurrentBannerEnable")}
      onEnable={() => {
        void updateSettings({ enableWorktreeIsolation: true })
          .then(() => showSuccess(t("workspace.isolationEnabledToast")))
          // The settings mutation shows its own error toast.
          .catch(() => {});
      }}
      onSkip={() => {
        if (appId === null) return;
        setDismissedAppIds((current) => new Set(current).add(appId));
      }}
    />
  );
}
