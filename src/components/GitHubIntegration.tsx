import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";

export function GitHubIntegration() {
  const { t } = useTranslation(["home", "common"]);
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnectFromGithub = async () => {
    setIsDisconnecting(true);
    try {
      const result = await updateSettings({
        githubAccessToken: undefined,
        githubUser: undefined,
      });
      if (result) {
        showSuccess(t("integrations.github.disconnected"));
      } else {
        showError(t("integrations.github.failedDisconnect"));
      }
    } catch (err: any) {
      showError(err.message || t("integrations.github.errorDisconnect"));
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = !!settings?.githubAccessToken;

  if (!isConnected) {
    return null;
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("integrations.github.title")}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t("integrations.github.connected")}
        </p>
      </div>

      <Button
        onClick={handleDisconnectFromGithub}
        variant="destructive"
        size="sm"
        disabled={isDisconnecting}
        className="flex items-center gap-2"
      >
        {isDisconnecting
          ? t("common:disconnecting")
          : t("integrations.github.disconnect")}
        <Github className="h-4 w-4" />
      </Button>
    </div>
  );
}
