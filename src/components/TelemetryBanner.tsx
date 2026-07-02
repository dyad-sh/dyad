import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import { Button } from "./ui/button";
import { atom, useAtom } from "jotai";
import { useSettings } from "@/hooks/useSettings";
import { useSidebar } from "@/components/ui/sidebar";

const hideBannerAtom = atom(false);

export function PrivacyBanner() {
  const [hideBanner, setHideBanner] = useAtom(hideBannerAtom);
  const { settings, updateSettings } = useSettings();
  const { state: sidebarState } = useSidebar();
  const { t } = useTranslation("settings");

  if (hideBanner) {
    return null;
  }
  if (settings?.telemetryConsent !== "unset") {
    return null;
  }
  const leftOffset =
    sidebarState === "expanded"
      ? "var(--sidebar-width)"
      : "var(--sidebar-width-icon)";

  return (
    <div
      className="fixed bottom-0 z-50 border-t border-border bg-(--background-lightest)/95 px-4 py-2 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-[left] duration-200 ease-linear"
      style={{ left: leftOffset, right: 12 }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">
            {t("telemetry.helpImprove")}
          </span>{" "}
          {t("telemetry.noCodeOrMessages")}{" "}
          <button
            type="button"
            onClick={() => {
              ipc.system.openExternalUrl(
                "https://dyad.sh/docs/policies/privacy-policy",
              );
            }}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("telemetry.learnMore")}
          </button>
        </p>
        <div className="flex shrink-0 gap-1.5 sm:justify-end">
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              updateSettings({ telemetryConsent: "opted_in" });
            }}
            data-testid="telemetry-accept-button"
          >
            {t("telemetry.accept")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              updateSettings({ telemetryConsent: "opted_out" });
            }}
            data-testid="telemetry-reject-button"
          >
            {t("telemetry.reject")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHideBanner(true)}
            data-testid="telemetry-later-button"
          >
            {t("telemetry.later")}
          </Button>
        </div>
      </div>
    </div>
  );
}
