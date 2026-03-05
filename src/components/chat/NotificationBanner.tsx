import { Bell } from "lucide-react";
import { SkippableBanner } from "./SkippableBanner";
import { useSettings } from "@/hooks/useSettings";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { SETTING_IDS, SECTION_IDS } from "@/lib/settingsSearchIndex";

export function NotificationBanner() {
  const { settings, updateSettings } = useSettings();
  const scrollAndNavigateTo = useScrollAndNavigateTo("/settings", {
    highlight: true,
  });

  if (
    !settings ||
    settings.enableChatCompletionNotifications === true ||
    settings.skipNotificationBanner === true
  ) {
    return null;
  }

  const handleEnable = () => {
    scrollAndNavigateTo(
      SETTING_IDS.chatCompletionNotification,
      SECTION_IDS.workflow,
    );
  };

  const handleSkip = () => {
    updateSettings({ skipNotificationBanner: true });
  };

  return (
    <SkippableBanner
      icon={Bell}
      message="Turn on notifications so you know when chat responses are done."
      enableLabel="Enable"
      onEnable={handleEnable}
      onSkip={handleSkip}
      data-testid="notification-tip-banner"
    />
  );
}
