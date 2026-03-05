import { useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MacNotificationGuideDialog } from "./MacNotificationGuideDialog";
import { detectIsMac } from "@/hooks/useChatModeToggle";

function sendTestNotification() {
  if (Notification.permission === "granted") {
    new Notification("Dyad", {
      body: "Notifications are working! You'll be notified when chat responses complete.",
    });
  }
}

export function ChatCompletionNotificationSwitch() {
  const { settings, updateSettings } = useSettings();
  const [showMacGuide, setShowMacGuide] = useState(false);
  const isEnabled = settings?.enableChatCompletionNotifications === true;

  return (
    <>
      <div className="flex items-center space-x-2">
        <Switch
          id="chat-completion-notifications"
          checked={isEnabled}
          onCheckedChange={async (checked) => {
            if (checked) {
              if (Notification.permission === "denied") {
                if (detectIsMac()) {
                  setShowMacGuide(true);
                }
                return;
              }
              if (Notification.permission === "default") {
                const permission = await Notification.requestPermission();
                if (permission !== "granted") {
                  if (detectIsMac()) {
                    setShowMacGuide(true);
                  }
                  return;
                }
              }
              updateSettings({
                enableChatCompletionNotifications: true,
              });
              sendTestNotification();
              if (detectIsMac()) {
                setShowMacGuide(true);
              }
              return;
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
      <MacNotificationGuideDialog
        open={showMacGuide}
        onClose={() => setShowMacGuide(false)}
      />
    </>
  );
}
