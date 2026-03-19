import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MacNotificationGuideDialog } from "./MacNotificationGuideDialog";
import { useEnableNotifications } from "@/hooks/useEnableNotifications";

export function ChatEventNotificationSwitch() {
  const { isEnabled, enable, disable, showMacGuide, setShowMacGuide } =
    useEnableNotifications();

  return (
    <>
      <div className="flex items-center space-x-2">
        <Switch
          id="chat-event-notifications"
          checked={isEnabled}
          onCheckedChange={async (checked) => {
            if (checked) {
              await enable();
            } else {
              disable();
            }
          }}
        />
        <Label htmlFor="chat-event-notifications">Enable notifications</Label>
      </div>
      <MacNotificationGuideDialog
        open={showMacGuide}
        onClose={() => setShowMacGuide(false)}
      />
    </>
  );
}
