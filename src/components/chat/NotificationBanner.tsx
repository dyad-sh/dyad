import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Bell, Sparkles, Star, type LucideIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SkippableBanner } from "./SkippableBanner";
import { MacNotificationGuideDialog } from "../MacNotificationGuideDialog";
import { DyadProTrialDialog } from "../DyadProTrialDialog";
import { useEnableNotifications } from "@/hooks/useEnableNotifications";
import { useSettings } from "@/hooks/useSettings";
import { ipc, type ProductNudge } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  CHAT_NOTIFICATIONS_NUDGE_ID,
  selectProductNudge,
  isProductNudgeEligible,
} from "@/lib/productNudges";

const iconByName: Record<ProductNudge["icon"], LucideIcon> = {
  bell: Bell,
  chart: BarChart3,
  sparkles: Sparkles,
  star: Star,
};

function uniqueIds(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

export function NotificationBanner() {
  const { settings, updateSettings } = useSettings();
  const queryClient = useQueryClient();
  const { enable, showMacGuide, setShowMacGuide } = useEnableNotifications();
  const [visibleNudgeId, setVisibleNudgeId] = useState<string | null>(null);
  const [showDyadProTrialDialog, setShowDyadProTrialDialog] = useState(false);
  const markedSeenNudgeIds = useRef(new Set<string>());

  const { data } = useQuery({
    queryKey: queryKeys.productNudges.list,
    queryFn: () => ipc.productNudges.getProductNudges(),
    enabled: !!settings && settings.disableProductTips !== true,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const nudges = useMemo(() => data?.nudges ?? [], [data?.nudges]);

  useEffect(() => {
    if (!settings || nudges.length === 0) {
      setVisibleNudgeId(null);
      return;
    }

    const selected = selectProductNudge({
      nudges,
      settings,
      now: Date.now(),
      currentNudgeId: visibleNudgeId,
    });

    if (selected?.id === visibleNudgeId) {
      return;
    }

    if (selected && !markedSeenNudgeIds.current.has(selected.id)) {
      markedSeenNudgeIds.current.add(selected.id);
      void updateSettings({ lastShownProductNudgeAt: Date.now() }).finally(() =>
        setVisibleNudgeId(selected.id),
      );
      return;
    }

    setVisibleNudgeId(selected?.id ?? null);
  }, [nudges, settings, updateSettings, visibleNudgeId]);

  const visibleNudge =
    settings && visibleNudgeId
      ? (nudges.find((nudge) => nudge.id === visibleNudgeId) ?? null)
      : null;

  const shouldShowNudge = Boolean(
    settings &&
    visibleNudge &&
    settings.disableProductTips !== true &&
    isProductNudgeEligible(visibleNudge, settings),
  );

  const dismissNudge = () => {
    if (!settings || !visibleNudge) {
      return;
    }
    if (visibleNudge.id === CHAT_NOTIFICATIONS_NUDGE_ID) {
      setVisibleNudgeId(null);
      void updateSettings({ skipNotificationBanner: true });
      return;
    }

    const dismissedIds = uniqueIds(
      settings.dismissedProductNudgeIds ?? [],
      visibleNudge.id,
    );
    setVisibleNudgeId(null);
    void updateSettings({
      dismissedProductNudgeIds: dismissedIds,
    });
  };

  const markNudgeActioned = async () => {
    if (!settings || !visibleNudge) {
      return;
    }

    await updateSettings({
      actionedProductNudgeIds: uniqueIds(
        settings.actionedProductNudgeIds ?? [],
        visibleNudge.id,
      ),
    });
    setVisibleNudgeId(null);
  };

  const handleAction = async () => {
    if (!settings || !visibleNudge) {
      return;
    }
    switch (visibleNudge.action.type) {
      case "enable-chat-notifications":
        await enable();
        await markNudgeActioned();
        break;
      case "enable-telemetry":
        await updateSettings({
          telemetryConsent: "opted_in",
          actionedProductNudgeIds: uniqueIds(
            settings.actionedProductNudgeIds ?? [],
            visibleNudge.id,
          ),
        });
        setVisibleNudgeId(null);
        break;
      case "open-url":
        await ipc.system.openExternalUrl(visibleNudge.action.url);
        await markNudgeActioned();
        break;
      case "open-pro-trial-dialog":
        setShowDyadProTrialDialog(true);
        await markNudgeActioned();
        break;
      case "claim-github-star-bonus":
        await ipc.system.openExternalUrl(visibleNudge.action.url);
        await ipc.freeAgentQuota.claimGithubStarBonus();
        await queryClient.invalidateQueries({
          queryKey: queryKeys.freeAgentQuota.status,
        });
        await markNudgeActioned();
        break;
    }
  };

  return (
    <>
      {shouldShowNudge && visibleNudge && (
        <SkippableBanner
          icon={iconByName[visibleNudge.icon]}
          message={visibleNudge.message}
          enableLabel={visibleNudge.actionLabel}
          onEnable={() => void handleAction()}
          onSkip={dismissNudge}
          data-testid={
            visibleNudge.id === CHAT_NOTIFICATIONS_NUDGE_ID
              ? "notification-tip-banner"
              : "product-nudge-banner"
          }
        />
      )}
      <MacNotificationGuideDialog
        open={showMacGuide}
        onClose={() => setShowMacGuide(false)}
      />
      <DyadProTrialDialog
        isOpen={showDyadProTrialDialog}
        onClose={() => setShowDyadProTrialDialog(false)}
      />
    </>
  );
}
