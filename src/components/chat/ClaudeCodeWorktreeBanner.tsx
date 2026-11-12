import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { GitFork } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dismissedClaudeWorktreeBannerVersionsAtom } from "@/atoms/workspaceAtoms";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { canClaudeResumeFromAnotherDirectory } from "@/shared/claude_code_cli";
import { SkippableBanner } from "./SkippableBanner";

export const CLAUDE_CODE_UPDATE_URL =
  "https://code.claude.com/docs/en/setup#update-claude-code";

export function ClaudeCodeWorktreeBanner({
  usesClaudeCode,
}: {
  usesClaudeCode: boolean;
}) {
  const { t } = useTranslation("chat");
  const { settings } = useSettings();
  const enabled = !!settings?.enableWorktreeIsolation && usesClaudeCode;
  const { data: status } = useQuery({
    queryKey: queryKeys.system.claudeCodeStatus,
    queryFn: () => ipc.chat.claudeCodeStatus({}),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const [dismissedVersions, setDismissedVersions] = useAtom(
    dismissedClaudeWorktreeBannerVersionsAtom,
  );
  const version = status?.version;

  // Incompatible or signed-out CLIs still need the upgrade nudge. Only a
  // known, installed version can explain why worktrees are unavailable.
  if (
    !enabled ||
    !status?.installed ||
    !version ||
    version === "unknown" ||
    canClaudeResumeFromAnotherDirectory(version) ||
    dismissedVersions.has(version)
  ) {
    return null;
  }

  return (
    <SkippableBanner
      icon={GitFork}
      variant="warning"
      actionPlacement="below"
      data-testid="claude-code-worktree-banner"
      message={
        <span role="status">
          {t("workspace.claudeUpgradeMessage", { version })}
        </span>
      }
      enableLabel={t("workspace.claudeUpgradeAction")}
      dismissLabel={t("workspace.claudeUpgradeDismiss")}
      onEnable={() => {
        void ipc.system.openExternalUrl(CLAUDE_CODE_UPDATE_URL).catch(() => {
          showError(t("workspace.claudeUpgradeLinkFailed"));
        });
      }}
      onSkip={() => {
        setDismissedVersions((current) => new Set(current).add(version));
      }}
    />
  );
}
