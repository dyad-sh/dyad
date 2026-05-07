import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import type { UserSettings } from "@/lib/schemas";
import type { App } from "@/ipc/types";

interface ShowUserInputNotificationParams {
  appId: number | null;
  queryClient: QueryClient;
  settings: UserSettings | null | undefined;
  body: string;
  requireInteraction?: boolean;
}

/**
 * Show a desktop notification for an agent tool that's awaiting user input.
 * No-op unless: notifications are enabled in settings, permission is granted,
 * and the window is not focused.
 */
export function showUserInputNotification({
  appId,
  queryClient,
  settings,
  body,
  requireInteraction,
}: ShowUserInputNotificationParams): void {
  const enabled = settings?.enableChatEventNotifications === true;
  if (!enabled) return;
  if (Notification.permission !== "granted") return;
  if (document.hasFocus()) return;

  const app = appId
    ? queryClient.getQueryData<App | null>(queryKeys.apps.detail({ appId }))
    : null;

  new Notification(app?.name ?? "Dyad", {
    body,
    requireInteraction,
  });
}
