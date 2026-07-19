import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTime } from "@/i18n/format";
import { Button } from "@/components/ui/button";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { ipc } from "@/ipc/types";

interface FreeAgentQuotaBannerProps {
  onSwitchToBuildMode: () => void;
}

/**
 * Banner displayed when a free user has exceeded their daily Basic Agent quota.
 * Shows the time until quota resets and provides options to upgrade or switch modes.
 */
export function FreeAgentQuotaBanner({
  onSwitchToBuildMode,
}: FreeAgentQuotaBannerProps) {
  const { t, i18n } = useTranslation("chat");
  const {
    quotaStatus,
    isQuotaExceeded,
    hoursUntilReset,
    resetTime,
    messagesLimit,
  } = useFreeAgentQuota();

  if (!isQuotaExceeded || !quotaStatus) {
    return null;
  }

  // Calculate reset time display
  const resetTimeDisplay =
    hoursUntilReset !== null
      ? hoursUntilReset === 0
        ? t("quota.lessThanHour")
        : t("quota.hours", { count: hoursUntilReset })
      : t("quota.later");

  // Format the actual reset time (e.g., "11:59 PM")
  const resetDateTime = resetTime
    ? formatTime(new Date(resetTime), i18n.language, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  const handleUpgrade = () => {
    ipc.system.openExternalUrl("https://dyad.sh/pro");
  };

  return (
    <div
      className="mx-auto max-w-3xl my-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10"
      data-testid="free-agent-quota-banner"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {t("quota.message", {
              label: t("quota.freeAgentLabel", { count: messagesLimit }),
              resetTime: `${resetTimeDisplay} (${resetDateTime})`,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleUpgrade} size="sm" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {t("quota.upgrade")}
            </Button>
            <Button
              onClick={onSwitchToBuildMode}
              variant="outline"
              size="sm"
              className="gap-1.5 border-amber-500/50 hover:bg-amber-500/20"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              {t("quota.switchToBuild")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
