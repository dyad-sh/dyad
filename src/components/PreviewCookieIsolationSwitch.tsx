import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_ENABLE_PREVIEW_COOKIE_ISOLATION } from "@/shared/settings_defaults";
import { useTranslation } from "react-i18next";

export function PreviewCookieIsolationSwitch() {
  const { t } = useTranslation("settings");
  const { settings, settingsLoading, updateSettings } = useSettings();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {!settings ? (
          <span role="status" className="text-sm text-muted-foreground">
            {settingsLoading
              ? t("experiments.previewCookieIsolation.loading")
              : t("experiments.previewCookieIsolation.loadError")}
          </span>
        ) : (
          <Switch
            id="enable-preview-cookie-isolation"
            aria-label={t("experiments.previewCookieIsolation.label")}
            checked={
              settings.enablePreviewCookieIsolation ??
              DEFAULT_ENABLE_PREVIEW_COOKIE_ISOLATION
            }
            onCheckedChange={(checked) => {
              // The settings mutation displays its own error toast.
              void updateSettings({
                enablePreviewCookieIsolation: checked,
              }).catch(() => {});
            }}
          />
        )}
        <Label htmlFor="enable-preview-cookie-isolation">
          {t("experiments.previewCookieIsolation.label")}
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {t("experiments.previewCookieIsolation.description")}
      </p>
    </div>
  );
}
