/**
 * Notification utilities for Dyad chat responses
 */

import { showSuccess } from "./toast";
import { IpcClient } from "@/ipc/ipc_client";

export interface NotificationOptions {
  visual?: boolean;
  sound?: boolean;
  message?: string;
}

/**
 * Show notification when chat response is completed
 */
export function showResponseCompleted(options: NotificationOptions = {}) {
  const {
    visual = true,
    sound = true,
    message = "Response completed",
  } = options;

  // We need to get the settings first to check if native notifications are enabled
  IpcClient.getInstance()
    .getUserSettings()
    .then((settings) => {
      try {
        // Always use native notifications when enabled, regardless of window focus
        const useNativeNotification = settings?.enableResponseEndNotification;

        // Visual notification (always use native notification if enabled)
        if (visual) {
          if (useNativeNotification && typeof Notification !== "undefined") {
            // Use native notification for better visibility when app is not in focus
            showNativeNotification("Dyad", message);
          } else {
            // Fallback to toast only if native notifications are disabled
            showSuccess(message);
          }
        }

        // Audio notification
        if (sound) {
          playNotificationSound();
        }
      } catch (error) {
        console.debug("Notification error:", error);
        // Fallback to toast
        if (visual) {
          showSuccess(message);
        }
      }
    })
    .catch((error) => {
      console.debug("Failed to get user settings:", error);
      // Fallback to toast if we can't get the settings
      if (visual) {
        showSuccess(message);
      }
      if (sound) {
        playNotificationSound();
      }
    });
}

/**
 * Show a native desktop notification
 * Uses the Notification API to display a system notification
 * This is especially useful when the Dyad app window is not in focus
 */
function showNativeNotification(title: string, body: string) {
  try {
    // Check permission
    if (Notification.permission === "granted") {
      sendNotification();
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          sendNotification();
        } else {
          // Permission denied, fallback to toast
          showSuccess(body);
        }
      });
    }

    function sendNotification() {
      // Create notification with app icon and appropriate options
      const notification = new Notification(title, {
        body,
        icon: "/assets/logo.png", // Using app logo
        silent: true, // Don't play the default sound as we handle sound separately
        tag: "dyad-response", // Tag ensures we don't stack too many similar notifications
        requireInteraction: false, // Auto-dismiss after OS's default timeout
      });

      // When notification is clicked, focus the Dyad window
      notification.onclick = () => {
        // Bring Dyad window to front when notification is clicked
        if (window) {
          window.focus();

          // If we're in Electron and have access to its APIs
          try {
            // This is a more reliable way to focus an Electron window
            // than just window.focus()
            if (window.require) {
              const electron = window.require("electron");
              if (electron && electron.ipcRenderer) {
                electron.ipcRenderer.send("focus-window");
              }
            }
          } catch (e) {
            console.debug("Could not access Electron IPC:", e);
            // Standard browser focus fallback
            window.focus();
          }
        }
      };
    }
  } catch (error) {
    console.debug("Native notification failed:", error);
    // Fallback to toast if notifications are not supported
    showSuccess(body);
  }
}

/**
 * Play a subtle notification sound
 */
function playNotificationSound() {
  try {
    // Using Web Audio API for a subtle notification sound
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      console.debug("Web Audio API not available");
      return;
    }

    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Create a pleasant notification tone
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // Higher pitch, more pleasant
    oscillator.type = "sine";

    // Gentle fade in/out
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      0.05,
      audioContext.currentTime + 0.05,
    );
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + 0.3,
    );

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);

    // Clean up
    setTimeout(() => {
      audioContext.close();
    }, 500);
  } catch (error) {
    // Silently fail if audio is not available
    console.debug("Audio notification failed:", error);
  }
}

/**
 * Alternative: Use system notification sound (simpler, more reliable)
 */
export function playSystemNotification() {
  try {
    // Create a very short, high-pitched beep
    const audio = new Audio(
      "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmMcBjiR1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmMcBjiR1/LNeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmMcBjmO0+LIeCEEJHjM8N1xIggSeN7aqXMEA1t09Sy0",
    );
    audio.volume = 0.1;
    audio.play().catch(() => {
      // Ignore errors - notification is optional
    });
  } catch (error) {
    console.debug("System notification failed:", error);
  }
}
