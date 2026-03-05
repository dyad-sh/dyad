import { useState, useCallback } from "react";
import { useSettings } from "@/hooks/useSettings";
import { detectIsMac } from "@/hooks/useChatModeToggle";

function sendTestNotification() {
  if (Notification.permission === "granted") {
    new Notification("Dyad", {
      body: "Notifications are working! You'll be notified when chat responses complete.",
    });
  }
}

export function useEnableNotifications() {
  const { settings, updateSettings } = useSettings();
  const [showMacGuide, setShowMacGuide] = useState(false);
  const isEnabled = settings?.enableChatCompletionNotifications === true;

  const enable = useCallback(async () => {
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
    updateSettings({ enableChatCompletionNotifications: true });
    sendTestNotification();
    if (detectIsMac()) {
      setShowMacGuide(true);
    }
  }, [updateSettings]);

  const disable = useCallback(() => {
    updateSettings({ enableChatCompletionNotifications: false });
  }, [updateSettings]);

  return { isEnabled, enable, disable, showMacGuide, setShowMacGuide };
}
