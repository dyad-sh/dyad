/**
 * Notification utilities for Dyad chat responses
 */

import { showSuccess } from "./toast";
import type { UserSettings } from "@/lib/schemas";

export interface NotificationOptions {
  visual?: boolean;
  sound?: boolean;
  message?: string;
  settings?: UserSettings;
}

/**
 * Show notification when chat response is completed
 *
 * IMPORTANT: This function must be called from a React component or hook that
 * already has access to user settings via the useSettings() hook. Do not call
 * IpcClient directly from this utility function.
 *
 * @param options Options including user settings from a React hook/component
 */
export function showResponseCompleted(options: NotificationOptions = {}) {
  const {
    visual = true,
    sound = true,
    message = "Response completed",
    settings,
  } = options;

  try {
    // Use settings passed from the component
    const useNativeNotification = settings?.enableResponseEndNotification;

    // Only show notifications (visual or sound) if the feature is enabled
    if (useNativeNotification) {
      // Visual notification
      if (visual && typeof Notification !== "undefined") {
        // Use native notification for better visibility when app is not in focus
        showNativeNotification("Dyad", message);
      } else if (visual) {
        // Fallback to toast only if Notification API is not available
        showSuccess(message);
      }

      // Audio notification
      if (sound) {
        playNotificationSound();
      }
    }
  } catch (error) {
    console.debug("Notification error:", error);
    // Fallback to toast
    if (visual) {
      showSuccess(message);
    }
  }
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
          // Permission denied or dismissed, fallback to toast
          showSuccess(body);
        }
      });
    } else {
      // Already denied, fallback to toast
      showSuccess(body);
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
        // In Electron, the click handler should automatically focus the window
        // without needing to send an explicit IPC message
        if (window) {
          window.focus();
        }
      };
    }
  } catch (error) {
    console.debug("Native notification failed:", error);
    // Log error but don't fall back to toast
    // This ensures we respect the user's notification preferences
    // and don't show any notification if native notifications fail
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
