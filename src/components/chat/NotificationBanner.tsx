import { Bell } from "lucide-react";
import { SkippableBanner } from "./SkippableBanner";
import { MacNotificationGuideDialog } from "../MacNotificationGuideDialog";
import { useEnableNotifications } from "@/hooks/useEnableNotifications";
import { useSettings } from "@/hooks/useSettings";

export function NotificationBanner() {
  const { settings, updateSettings } = useSettings();
  const { enable, showMacGuide, setShowMacGuide } = useEnableNotifications();

  if (
    !settings ||
    settings.enableChatCompletionNotifications === true ||
    settings.skipNotificationBanner === true
  ) {
    return null;
  }

  const handleSkip = () => {
    updateSettings({ skipNotificationBanner: true });
  };

  return (
    <>
      <SkippableBanner
        icon={Bell}
        message="Get notified when chat responses finish."
        enableLabel="Enable"
        onEnable={enable}
        onSkip={handleSkip}
        data-testid="notification-tip-banner"
      />
      <MacNotificationGuideDialog
        open={showMacGuide}
        onClose={() => setShowMacGuide(false)}
      />
    </>
  );
}
