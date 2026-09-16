import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Gitlab } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";
import { useGitLabStatus } from "@/hooks/useGitLabStatus";
import { showSuccess, showError } from "@/lib/toast";
import { gitLabInstanceLabel } from "@/shared/gitlab_instance_url";
import { GitLabCredentialsForm } from "@/components/GitLabCredentialsForm";

/**
 * The GitLab row under Settings > Integrations.
 *
 * Unlike the GitHub row, which only reports a connection made elsewhere, this
 * one can also make the connection: a token is typed, not obtained through a
 * browser flow, so there is nothing a separate page would add.
 */
export function GitLabIntegration() {
  const { t } = useTranslation(["home", "common"]);
  const { settings } = useSettings();
  const { status } = useGitLabStatus();
  const queryClient = useQueryClient();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const enabled = !!settings?.enableGitlabPublishing;
  const connected = !!status?.connected;

  // With the experiment off, an existing connection still shows so it can be
  // removed; nothing else does.
  if (!enabled && !connected) {
    return null;
  }

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await ipc.gitlab.clearToken();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.gitlab.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.user }),
      ]);
      showSuccess(t("integrations.gitlab.disconnected"));
    } catch (err: any) {
      showError(err?.message || t("integrations.gitlab.failedDisconnect"));
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (!connected || !status) {
    return (
      <div className="space-y-3" data-testid="gitlab-integration">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("integrations.gitlab.title")}
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("integrations.gitlab.notConnected")}
          </p>
        </div>
        <GitLabCredentialsForm />
      </div>
    );
  }

  const expiry = status.tokenExpiresAt
    ? new Date(status.tokenExpiresAt).toLocaleDateString()
    : null;

  return (
    <div
      className="flex items-center justify-between"
      data-testid="gitlab-integration"
    >
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("integrations.gitlab.title")}
        </h3>
        <p
          className="mt-1 text-xs text-gray-500 dark:text-gray-400"
          data-testid="gitlab-integration-status"
        >
          {t("integrations.gitlab.connectedAs", {
            instance: gitLabInstanceLabel(status.instanceUrl ?? ""),
            username: status.username ?? "",
          })}
          {expiry &&
            ` ${t("integrations.gitlab.tokenExpires", { date: expiry })}`}
        </p>
      </div>

      <Button
        onClick={handleDisconnect}
        variant="destructive"
        size="sm"
        disabled={isDisconnecting}
        className="flex items-center gap-2"
        data-testid="gitlab-disconnect-button"
      >
        {isDisconnecting
          ? t("common:disconnecting")
          : t("integrations.gitlab.disconnect")}
        <Gitlab className="h-4 w-4" />
      </Button>
    </div>
  );
}
