import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { useTranslation } from "react-i18next";

export function ChatResponseSoundSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="chat-response-sound"
        aria-label={t("workflow.chatResponseSound")}
        checked={!!settings?.enableChatResponseSound}
        onCheckedChange={(checked) => {
          updateSettings({
            enableChatResponseSound: checked,
          });
        }}
      />
      <Label htmlFor="chat-response-sound">
        {t("workflow.chatResponseSound")}
      </Label>
    </div>
  );
}
