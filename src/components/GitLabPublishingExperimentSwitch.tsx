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
          onCheckedChange={(checked) => {
            updateSettings({ enableGitlabPublishing: checked });
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
