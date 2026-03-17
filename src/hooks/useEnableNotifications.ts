import { useState, useCallback } from "react";
import { useSettings } from "@/hooks/useSettings";
import { detectIsMac } from "@/hooks/useChatModeToggle";

function sendTestNotification() {
  if (Notification.permission === "granted") {
    new Notification("Dyad", {
      body: "Notifications are working! You'll be notified when responses finish or input is needed.",
    });
  }
}

export function useEnableNotifications() {
  const { settings, updateSettings } = useSettings();
  const [showMacGuide, setShowMacGuide] = useState(false);
  const isEnabled = settings?.enableChatEventNotifications === true;
  const isMac = detectIsMac();
  const openMacGuide = useCallback(() => {
    if (isMac) {
      setShowMacGuide(true);
    }
  }, [isMac]);

  const enable = useCallback(async () => {
    if (Notification.permission === "denied") {
      openMacGuide();
      return;
    }
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        openMacGuide();
        return;
      }
    }
    await updateSettings({ enableChatEventNotifications: true });
    sendTestNotification();
    openMacGuide();
  }, [updateSettings, openMacGuide]);

  const disable = useCallback(async () => {
    await updateSettings({ enableChatEventNotifications: false });
  }, [updateSettings]);

  return { isEnabled, enable, disable, showMacGuide, setShowMacGuide };
}
