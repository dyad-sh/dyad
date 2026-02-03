import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ChatCompletionNotificationSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled = settings?.enableChatCompletionNotifications === true;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="chat-completion-notifications"
        checked={isEnabled}
        onCheckedChange={async (checked) => {
          if (checked) {
            if (Notification.permission === "denied") {
              return;
            }
            if (Notification.permission === "default") {
              const permission = await Notification.requestPermission();
              if (permission !== "granted") {
                return;
              }
            }
          }
          updateSettings({
            enableChatCompletionNotifications: checked,
          });
        }}
      />
      <Label htmlFor="chat-completion-notifications">
        Show notification when chat completes
      </Label>
    </div>
  );
}
