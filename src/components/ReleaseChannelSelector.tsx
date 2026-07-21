import { useSettings } from "@/hooks/useSettings";

import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ipc } from "@/ipc/types";
import type { ReleaseChannel } from "@/lib/schemas";
import { useTranslation } from "react-i18next";

export function ReleaseChannelSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  if (!settings) {
    return null;
  }

  const handleReleaseChannelChange = (value: ReleaseChannel) => {
    updateSettings({ releaseChannel: value });
    if (value === "stable") {
      toast("Using Stable release channel", {
        description:
          "You'll stay on your current version until a newer stable release is available, or you can manually downgrade now.",
        action: {
          label: "Download Stable",
          onClick: () => {
            ipc.system.openExternalUrl("https://dyad.sh/download");
          },
        },
      });
    } else {
      toast("Using Beta release channel", {
        description:
          "You will need to restart Dyad for your settings to take effect.",
        action: {
          label: "Restart Dyad",
          onClick: () => {
            ipc.system.restartDyad();
          },
        },
      });
    }
  };

  return (
    <SettingField
      htmlFor="release-channel"
      label={t("general.releaseChannel")}
      description={t("general.releaseChannelDescription")}
    >
      <Select
        value={settings.releaseChannel}
        onValueChange={(v) => v && handleReleaseChannelChange(v)}
      >
        <SelectTrigger
          className="w-full sm:w-[240px]"
          id="release-channel"
          aria-describedby="release-channel-description"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="stable">{t("general.stable")}</SelectItem>
          <SelectItem value="beta">{t("general.beta")}</SelectItem>
        </SelectContent>
      </Select>
    </SettingField>
  );
}
