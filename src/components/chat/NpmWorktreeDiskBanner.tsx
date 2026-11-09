import { useAtom } from "jotai";
import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SkippableBanner } from "@/components/chat/SkippableBanner";
import { dismissedNpmWorktreeBannerAppIdsAtom } from "@/atoms/workspaceAtoms";
import { useChatWorkspaceStatus } from "@/hooks/useChatWorkspace";
import { ipc } from "@/ipc/types";
import { shouldShowNpmWorktreeBanner } from "./workspace_status";

export const PNPM_INSTALL_URL = "https://pnpm.io/installation";

/**
 * Shown in a chat whose worktree installs with npm (detected when the
 * worktree was created). Worktrees are kept after merging, and npm gives each
 * one a full copy of node_modules, so several chats can fill the disk.
 */
export function NpmWorktreeDiskBanner({
  appId,
  chatId,
}: {
  appId: number | null;
  chatId: number | undefined;
}) {
  const { t } = useTranslation("chat");
  const { data: status } = useChatWorkspaceStatus(appId, chatId);
  const [dismissedAppIds, setDismissedAppIds] = useAtom(
    dismissedNpmWorktreeBannerAppIdsAtom,
  );

  if (!shouldShowNpmWorktreeBanner({ status, chatId, dismissedAppIds })) {
    return null;
  }

  return (
    <SkippableBanner
      icon={HardDrive}
      variant="warning"
      data-testid="npm-worktree-disk-banner"
      message={t("workspace.npmDiskBannerMessage")}
      enableLabel={t("workspace.npmDiskBannerAction")}
      onEnable={() => {
        void ipc.system.openExternalUrl(PNPM_INSTALL_URL);
      }}
      onSkip={() => {
        if (appId === null) return;
        setDismissedAppIds((current) => new Set(current).add(appId));
      }}
    />
  );
}
