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
 * Specialized notification for chat response completion
 */
export const showResponseCompleted = (options: NotificationOptions) => {
  const {
    visual = true,
    sound = true,
    message = "Response completed ✅",
    settings,
  } = options;

  // Respect user settings
  if (!settings?.enableResponseEndNotification) {
    return; // user disabled all response notifications
  }

  // Handle visual and sound independently
  if (visual) {
    // Show visual notification
  }

  if (sound) {
    playNotificationSound();
  }

  // Try native notification first, fallback to toast
  const nativeShown = showNativeNotification("Dyad", message);

  if (!nativeShown) {
    // Fallback: Dyad toast notification
    showSuccess(message);
  }

  // Play sound if enabled
  if (sound) {
    playNotificationSound();
  }
};

/**
 * Show a native cross-platform notification (Electron renderer process only)
 * Returns true if shown, false if fallback is needed
 */
export const showNativeNotification = (
  title: string,
  body: string,
): boolean => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    console.warn("Native notifications are not supported in this environment.");
    return false;
  }

  try {
    if (Notification.permission === "granted") {
      new Notification(title, { body });
      return true;
    } else if (Notification.permission !== "denied") {
      // Ask for permission once
      const permission = Notification.permission;
      if (permission === "granted") {
        new Notification(title, { body });
        return true; // handled synchronously
      } else if (permission === "denied") {
        return false; // let the caller handle the fallback
      } else {
        // Permission state is "default" (not yet determined)
        Notification.requestPermission().then((result) => {
          if (result === "granted") {
            new Notification(title, { body });
          }
          // Don't show fallback here, let the caller handle it
        });
        return false; // let the caller handle the fallback
      }
    }
  } catch (err) {
    console.error("Failed to show native notification:", err);
    return false;
  }

  return false;
};

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

    // Singleton AudioContext for reuse across notifications
    let sharedAudioContext = null;
    
    // Create or reuse AudioContext
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AudioContextClass();
    } else if (sharedAudioContext.state === 'suspended') {
      sharedAudioContext.resume();
    }
    
    const audioContext = sharedAudioContext;
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
      0.01,
      audioContext.currentTime + 0.3,
    );

    const startTime = audioContext.currentTime;
    const stopTime = startTime + 0.3;
    
    oscillator.start(startTime);
    oscillator.stop(stopTime);

    // Clean up connections when the sound is done
    // We don't close the context, just disconnect the nodes
    oscillator.onended = () => {
      gainNode.disconnect();
      oscillator.disconnect();
    };
  } catch (error) {
    // Silently fail if audio is not available
    console.debug("Audio notification failed:", error);
  }
}
