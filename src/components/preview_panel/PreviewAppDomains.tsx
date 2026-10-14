import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_ENABLE_APP_PREVIEW_DOMAINS } from "@/shared/settings_defaults";

export function PreviewAppDomainsMenuItem({
  onRestart,
  disabled,
}: {
  onRestart: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("home");
  const { settings, updateSettings } = useSettings();
  const changeDomain = useMutation({
    mutationFn: async (enabled: boolean) => {
      await updateSettings({
        enableAppPreviewDomains: enabled,
        ...(enabled && { hideAppPreviewDomainsBanner: false }),
      });
      onRestart();
    },
  });

  return (
    <DropdownMenuCheckboxItem
      variant="switch"
      closeOnClick={false}
      aria-label={t("preview.appDomains.label")}
      checked={
        settings?.enableAppPreviewDomains ?? DEFAULT_ENABLE_APP_PREVIEW_DOMAINS
      }
      disabled={!settings || disabled || changeDomain.isPending}
      onCheckedChange={(checked) => changeDomain.mutate(checked)}
    >
      <div className="flex flex-col">
        <span>{t("preview.appDomains.label")}</span>
        <span className="text-xs text-muted-foreground">
          {t("preview.appDomains.description")}
        </span>
      </div>
    </DropdownMenuCheckboxItem>
  );
}

export function PreviewAppDomainsBanner() {
  const { t } = useTranslation("home");
  const { settings, updateSettings } = useSettings();
  const dismiss = useMutation({
    mutationFn: () => updateSettings({ hideAppPreviewDomainsBanner: true }),
  });

  if (
    !settings ||
    !(settings.enableAppPreviewDomains ?? DEFAULT_ENABLE_APP_PREVIEW_DOMAINS) ||
    settings.hideAppPreviewDomainsBanner
  ) {
    return null;
  }

  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
      data-testid="preview-app-domains-banner"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p role="status" className="min-w-0 flex-1 leading-relaxed">
        {t("preview.appDomains.banner")}
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        aria-label={t("preview.appDomains.dismiss")}
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate()}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
