import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";

export function VercelIntegration() {
  const { t } = useTranslation(["home", "common"]);
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnectFromVercel = async () => {
    setIsDisconnecting(true);
    try {
      const result = await updateSettings({
        vercelAccessToken: undefined,
      });
      if (result) {
        showSuccess(t("integrations.vercel.disconnected"));
      } else {
        showError(t("integrations.vercel.failedDisconnect"));
      }
    } catch (err: any) {
      showError(err.message || t("integrations.vercel.errorDisconnect"));
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = !!settings?.vercelAccessToken;

  if (!isConnected) {
    return null;
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("integrations.vercel.title")}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t("integrations.vercel.connected")}
        </p>
      </div>

      <Button
        onClick={handleDisconnectFromVercel}
        variant="destructive"
        size="sm"
        disabled={isDisconnecting}
        className="flex items-center gap-2"
      >
        {isDisconnecting
          ? t("common:disconnecting")
          : t("integrations.vercel.disconnect")}
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M24 22.525H0l12-21.05 12 21.05z" />
        </svg>
      </Button>
    </div>
  );
}
