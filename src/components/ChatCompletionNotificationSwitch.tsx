import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ChatCompletionNotificationSwitch() {
  const { settings, updateSettings } = useSettings();
  // Default to true if undefined (for UI display only)
  const isEnabled = settings?.enableChatCompletionNotifications !== false;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="chat-completion-notifications"
        checked={isEnabled}
        onCheckedChange={(checked) => {
          if (checked && Notification.permission === "default") {
            Notification.requestPermission();
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
