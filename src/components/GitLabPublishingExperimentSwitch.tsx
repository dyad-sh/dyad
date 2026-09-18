import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";

export function GitLabPublishingExperimentSwitch() {
  const { t } = useTranslation("home");
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="enable-gitlab-publishing"
          aria-label={t("integrations.gitlab.experimentLabel")}
          checked={!!settings?.enableGitlabPublishing}
          // Until settings load the switch reads `false` whatever the stored
          // value is, so a click here would send the *opposite* of what the
          // user sees the moment the query resolves.
          disabled={!settings}
          onCheckedChange={(checked) => {
            // The mutation surfaces its own error toast; swallowing the
            // rejection here keeps it from becoming an unhandled rejection.
            void updateSettings({ enableGitlabPublishing: checked }).catch(
              () => {},
            );
          }}
        />
        <Label htmlFor="enable-gitlab-publishing">
          {t("integrations.gitlab.experimentLabel")}
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {t("integrations.gitlab.experimentDescription")}
      </p>
    </div>
  );
}
