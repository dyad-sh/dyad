import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ipc } from "@/ipc/types";
import { useTranslation } from "react-i18next";

export function AutoUpdateSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  if (!settings) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="enable-auto-update"
        aria-label={t("general.autoUpdate")}
        checked={settings.enableAutoUpdate}
        onCheckedChange={(checked) => {
          updateSettings({ enableAutoUpdate: checked });
          toast(t("general.autoUpdateChanged"), {
            description: t("general.restartRequired"),
            action: {
              label: t("general.restartDyad"),
              onClick: () => {
                ipc.system.restartDyad();
              },
            },
          });
        }}
      />
      <Label htmlFor="enable-auto-update">{t("general.autoUpdate")}</Label>
    </div>
  );
}
