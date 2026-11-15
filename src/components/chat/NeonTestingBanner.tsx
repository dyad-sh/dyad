import { useAtom } from "jotai";
import { FlaskConical } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { dismissedNeonTestingBannerAppIdsAtom } from "@/atoms/testRuntimeAtoms";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useSetTestingEnabled } from "@/hooks/useSetTestingEnabled";
import { useSettings } from "@/hooks/useSettings";
import { isNeonOnlyApp, usesSandboxedE2eTests } from "@/lib/e2eSandbox";
import { SkippableBanner } from "./SkippableBanner";

export function NeonTestingBanner({
  appId,
  onEnabled,
}: {
  appId: number | null;
  onEnabled: () => void;
}) {
  // Unmount the mutation observer on app switches so a late success cannot
  // navigate the newly selected app to Tests.
  return appId === null ? null : (
    <NeonTestingBannerForApp key={appId} appId={appId} onEnabled={onEnabled} />
  );
}

function NeonTestingBannerForApp({
  appId,
  onEnabled,
}: {
  appId: number;
  onEnabled: () => void;
}) {
  const { t } = useTranslation("chat");
  const { app } = useLoadApp(appId);
  const { settings } = useSettings();
  const { setTestingEnabled, isLoading } = useSetTestingEnabled();
  const [dismissedIds, setDismissedIds] = useAtom(
    dismissedNeonTestingBannerAppIdsAtom,
  );
  const onEnabledRef = useRef(onEnabled);
  useLayoutEffect(() => {
    onEnabledRef.current = onEnabled;
  }, [onEnabled]);

  if (
    !isNeonOnlyApp(app) ||
    app?.testingEnabled ||
    !usesSandboxedE2eTests(settings) ||
    dismissedIds.includes(appId)
  ) {
    return null;
  }

  return (
    <SkippableBanner
      icon={FlaskConical}
      message={t("neonTestingBanner.message")}
      enableLabel={
        isLoading
          ? t("neonTestingBanner.enabling")
          : t("neonTestingBanner.enable")
      }
      enableDisabled={isLoading}
      dismissLabel={t("neonTestingBanner.dismiss")}
      onEnable={() => {
        if (isLoading) return;
        setTestingEnabled(
          { appId, enabled: true },
          { onSuccess: (enabled) => enabled && onEnabledRef.current() },
        );
      }}
      onSkip={() =>
        setDismissedIds((current) =>
          current.includes(appId) ? current : [...current, appId],
        )
      }
      data-testid="neon-testing-banner"
    />
  );
}
