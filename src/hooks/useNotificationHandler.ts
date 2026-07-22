import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { useRouterState } from "@tanstack/react-router";
import { chatCompletionEventAtom } from "@/atoms/chatAtoms";
import { useSelectChat } from "./useSelectChat";
import { ipc } from "../ipc/types";
import { showWarning } from "../lib/toast";

import {
  resolveAppIdForChat,
  resolveAppNameForAppId,
  resolveChatSummary,
} from "../lib/chatUtils";

import { useSettings } from "./useSettings";
import { planEventClient } from "../ipc/types/plan";
import type { UserInputDescriptorPayload } from "../ipc/types/user_input";

// Auto-close timer for completion notifications (give user enough time to navigate to chat completed)
const AUTO_CLOSE_MS = 10_000;

// Truncate text
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const spaceIdx = text.lastIndexOf(" ", limit);
  return text.slice(0, spaceIdx > 0 ? spaceIdx : limit) + "...";
}

/**
 * Hook that handles all OS-level notifications (Completions, Agent Consent, MCP Consent, Planning Questionnaire).
 * Listens for browser events for completions and IPC events for consent and questionnaire.
 */
export function useNotificationHandler() {
  const { selectChat } = useSelectChat();
  const queryClient = useQueryClient();
  const { settings } = useSettings();

  const selectChatRef = useRef(selectChat);
  const notificationsEnabled = settings?.enableChatEventNotifications === true;
  const notificationsEnabledRef = useRef(notificationsEnabled);
  const consentPermissionPromptedRef = useRef(false);
  const consentDeniedWarningShownRef = useRef(false);
  const completionPermissionRequestedRef = useRef(false);
  const completionDeniedWarningShownRef = useRef(false);

  // Track actual route to detect when user is viewing other page
  const routerState = useRouterState();
  const currentRouteRef = useRef({
    pathname: routerState.location.pathname,
    chatIdFromRoute: routerState.location.search.id as number | undefined,
  });
  useEffect(() => {
    currentRouteRef.current = {
      pathname: routerState.location.pathname,
      chatIdFromRoute: routerState.location.search.id as number | undefined,
    };
  }, [routerState.location.pathname, routerState.location.search.id]);

  // Update notificationsEnabled when setting changes
  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  // Track notifications and timers for auto-close
  const autoCloseTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const notificationsRef = useRef(new Map<string, Notification>());
  const notificationChatIdByTagRef = useRef(new Map<string, number>());
  const activeConsentNotificationRequestsRef = useRef(new Set<string>());
  const settledConsentNotificationRequestsRef = useRef(new Set<string>());
  const userInputConsentDescriptorsRef = useRef(
    new Map<
      string,
      Extract<
        UserInputDescriptorPayload,
        { kind: "agent-consent" | "mcp-consent" }
      >
    >(),
  );

  useEffect(() => {
    selectChatRef.current = selectChat;
  }, [selectChat]);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window.Notification === "undefined") return "denied" as const;
    if (window.Notification.permission !== "default")
      return window.Notification.permission;
    return window.Notification.requestPermission();
  }, []);

  const closeNativeNotification = useCallback((tag: string) => {
    notificationsRef.current.get(tag)?.close();
    const timer = autoCloseTimersRef.current.get(tag);
    if (timer) clearTimeout(timer);
    notificationsRef.current.delete(tag);
    notificationChatIdByTagRef.current.delete(tag);
    autoCloseTimersRef.current.delete(tag);
  }, []);

  // Shared helper for showing/closing native notifications
  const showNativeNotification = useCallback(
    async (params: {
      chatId: number;
      title: string;
      body: string;
      tag: string;
      requireInteraction?: boolean;
      autoClose?: boolean;
    }) => {
      const { chatId, title, body, tag, requireInteraction, autoClose } =
        params;

      // Deduplicate by tag to avoid collisions
      closeNativeNotification(tag);

      let notification: Notification;
      try {
        notification = new Notification(title, {
          body,
          tag,
          requireInteraction,
        });
      } catch (error) {
        console.error("Failed to create notification:", error);
        return;
      }
      notificationsRef.current.set(tag, notification);
      notificationChatIdByTagRef.current.set(tag, chatId);

      const cleanup = () => {
        // Only clear state if this is the same notification instance currently tracked
        if (notificationsRef.current.get(tag) !== notification) return;
        const timer = autoCloseTimersRef.current.get(tag);
        if (timer) clearTimeout(timer);
        notificationsRef.current.delete(tag);
        notificationChatIdByTagRef.current.delete(tag);
        autoCloseTimersRef.current.delete(tag);
      };

      if (autoClose) {
        const timer = setTimeout(() => {
          notification.close();
          cleanup();
        }, AUTO_CLOSE_MS);
        autoCloseTimersRef.current.set(tag, timer);
      }

      notification.onclose = cleanup;

      notification.onclick = async () => {
        ipc.system.focusWindow().catch(console.error);

        // Navigate to chat that triggered the notification
        const appId = await resolveAppIdForChat(chatId, queryClient);
        if (appId) {
          selectChatRef.current({ chatId, appId });
        } else {
          showWarning("Could not open this chat. It may have been deleted.");
        }
        notification.close();
      };
    },
    [closeNativeNotification, queryClient],
  );

  /**
   * Unified logic for handling Agent and MCP consent requests.
   * All consent requests are scoped to a specific chat (chatId always > 0).
   * Respects enableChatEventNotifications setting.
   */
  const handleConsentRequest = useCallback(
    async (params: {
      chatId: number;
      toolName: string;
      requestId?: string;
      sourceLabel?: string;
      tagPrefix: string;
    }) => {
      // Skip if notifications are disabled
      if (!notificationsEnabledRef.current) return;

      const requestAlreadySettled = () =>
        params.requestId !== undefined &&
        settledConsentNotificationRequestsRef.current.has(params.requestId);

      const id = params.chatId;
      // Notify if viewing different page OR app is hidden/minimized OR app is unfocused(two screen case).
      const isViewingConsentChat =
        currentRouteRef.current.pathname === "/chat" &&
        currentRouteRef.current.chatIdFromRoute === id;
      const shouldNotify =
        !isViewingConsentChat ||
        document.visibilityState === "hidden" ||
        !document.hasFocus();
      if (!shouldNotify) return;
      let currentPermission =
        typeof window.Notification !== "undefined"
          ? window.Notification.permission
          : "denied";

      if (currentPermission === "default") {
        if (!consentPermissionPromptedRef.current) {
          consentPermissionPromptedRef.current = true;
          currentPermission = await requestNotificationPermission();
        } else {
          currentPermission = "denied";
        }
      }

      if (requestAlreadySettled()) return;

      // Fallback Warning if notifications are unavailable or permission denied
      if (currentPermission !== "granted") {
        if (!consentDeniedWarningShownRef.current) {
          consentDeniedWarningShownRef.current = true;
          const target = params.sourceLabel
            ? ` from "${params.sourceLabel}"`
            : "";
          showWarning(
            `"${params.toolName}"${target} needs your approval. Enable notifications for Dyad in your operating system's notification settings.`,
          );
        }
        return;
      }

      // Recheck visibility & focus after async permission request — user may have navigated/unfocused during dialog
      const isStillViewingConsentChat =
        currentRouteRef.current.pathname === "/chat" &&
        currentRouteRef.current.chatIdFromRoute === id;
      const stillShouldNotify =
        !isStillViewingConsentChat ||
        document.visibilityState === "hidden" ||
        !document.hasFocus();
      if (!stillShouldNotify) return;

      // All consent requests are scoped to a chat, so resolve app/chat info
      const chatSummary = await resolveChatSummary(id, queryClient);
      // get app name so user knows which app is making the request
      const appName = chatSummary?.appId
        ? await resolveAppNameForAppId(chatSummary.appId, queryClient)
        : "Dyad";
      const title = appName;

      // A terminal event can arrive while permission or chat/app metadata is
      // being resolved. Never create an already-stale approval notification.
      if (requestAlreadySettled()) return;

      showNativeNotification({
        chatId: id,
        title,
        body: `"${params.toolName}" wants to run. Click to review and approve.`,
        // Correlate one native notification to one main-process waiter.
        tag: params.requestId
          ? `${params.tagPrefix}-${params.requestId}`
          : `${params.tagPrefix}-${id}-${params.toolName}`,
        requireInteraction: true,
      });
    },
    [queryClient, requestNotificationPermission, showNativeNotification],
  );

  const startConsentNotification = useCallback(
    (params: {
      chatId: number;
      toolName: string;
      requestId: string;
      sourceLabel?: string;
      tagPrefix: string;
    }) => {
      activeConsentNotificationRequestsRef.current.add(params.requestId);
      handleConsentRequest(params)
        .catch(console.error)
        .finally(() => {
          activeConsentNotificationRequestsRef.current.delete(params.requestId);
          settledConsentNotificationRequestsRef.current.delete(
            params.requestId,
          );
        });
    },
    [handleConsentRequest],
  );

  const resolveConsentNotification = useCallback(
    (tagPrefix: string, requestId: string) => {
      if (activeConsentNotificationRequestsRef.current.has(requestId)) {
        settledConsentNotificationRequestsRef.current.add(requestId);
      }
      closeNativeNotification(`${tagPrefix}-${requestId}`);
    },
    [closeNativeNotification],
  );

  const completionEvent = useAtomValue(chatCompletionEventAtom);

  useEffect(() => {
    if (!completionEvent) return;

    const { chatId, title: summary } = completionEvent;
    const isViewingThisChat =
      currentRouteRef.current.pathname === "/chat" &&
      currentRouteRef.current.chatIdFromRoute === chatId;
    const shouldNotify =
      !isViewingThisChat ||
      document.visibilityState === "hidden" ||
      !document.hasFocus();

    if (!notificationsEnabledRef.current || !shouldNotify) return;

    if (typeof window.Notification === "undefined") return;

    void (async () => {
      if (window.Notification.permission === "granted") {
        const chatSummary = await resolveChatSummary(chatId, queryClient);
        const appName = chatSummary?.appId
          ? await resolveAppNameForAppId(chatSummary.appId, queryClient)
          : "Dyad";
        const chatTitle = chatSummary?.title ?? null;

        const bodyContext = summary || chatTitle || "Chat response completed";
        const trimmed = truncate(bodyContext, 60);

        showNativeNotification({
          chatId,
          title: appName,
          body: trimmed,
          tag: `dyad-chat-complete-${chatId}`,
          autoClose: true,
        });
        return;
      }

      if (window.Notification.permission === "denied") {
        if (!completionDeniedWarningShownRef.current) {
          completionDeniedWarningShownRef.current = true;
          showWarning(
            "Enable notifications for Dyad in your operating system's notification settings to receive chat completion alerts.",
          );
        }
        return;
      }

      if (
        !completionPermissionRequestedRef.current &&
        window.Notification.permission === "default"
      ) {
        completionPermissionRequestedRef.current = true;
        const permission = await requestNotificationPermission();

        if (permission !== "granted") {
          if (permission === "denied") {
            completionDeniedWarningShownRef.current = true;
            showWarning(
              "Enable notifications for Dyad in your operating system's notification settings to receive chat completion alerts.",
            );
          }
          return;
        }

        if (permission === "granted") {
          const isStillViewingThisChat =
            currentRouteRef.current.pathname === "/chat" &&
            currentRouteRef.current.chatIdFromRoute === chatId;
          const stillShouldNotify =
            !isStillViewingThisChat ||
            document.visibilityState === "hidden" ||
            !document.hasFocus();

          if (stillShouldNotify) {
            const chatSummary = await resolveChatSummary(chatId, queryClient);
            const appName = chatSummary?.appId
              ? await resolveAppNameForAppId(chatSummary.appId, queryClient)
              : "Dyad";
            const chatTitle = chatSummary?.title ?? null;

            const bodyContext =
              summary || chatTitle || "Chat response completed";
            const trimmed = truncate(bodyContext, 60);

            showNativeNotification({
              chatId,
              title: appName,
              body: trimmed,
              tag: `dyad-chat-complete-${chatId}`,
              autoClose: true,
            });
          }
        }
        return;
      }
    })();
  }, [
    completionEvent,
    queryClient,
    showNativeNotification,
    requestNotificationPermission,
  ]);

  // Consent requests now arrive through the generic user-input projection
  // protocol. Questionnaire notifications remain on their legacy event until
  // Phase 3 PR 3.
  useEffect(() => {
    const unsubscribe = ipc.events.userInput.onRequested((descriptor) => {
      if (
        descriptor.kind !== "agent-consent" &&
        descriptor.kind !== "mcp-consent"
      ) {
        return;
      }
      userInputConsentDescriptorsRef.current.set(
        descriptor.requestId,
        descriptor,
      );
      if (descriptor.kind === "agent-consent") {
        startConsentNotification({
          chatId: descriptor.chatId,
          toolName: descriptor.toolName,
          requestId: descriptor.requestId,
          tagPrefix: "dyad-agent-consent",
        });
      } else if (descriptor.classifier !== "racing") {
        startConsentNotification({
          chatId: descriptor.chatId,
          toolName: descriptor.toolName,
          requestId: descriptor.requestId,
          sourceLabel: descriptor.serverName || "an MCP server",
          tagPrefix: "dyad-mcp-consent",
        });
      }
    });
    return () => unsubscribe();
  }, [startConsentNotification]);

  useEffect(() => {
    const unsubscribe = ipc.events.userInput.onClassified(({ requestId }) => {
      const descriptor = userInputConsentDescriptorsRef.current.get(requestId);
      if (!descriptor || descriptor.kind !== "mcp-consent") return;
      startConsentNotification({
        chatId: descriptor.chatId,
        toolName: descriptor.toolName,
        requestId,
        sourceLabel: descriptor.serverName || "an MCP server",
        tagPrefix: "dyad-mcp-consent",
      });
    });
    return () => unsubscribe();
  }, [startConsentNotification]);

  useEffect(() => {
    const unsubscribe = ipc.events.userInput.onSettled(({ requestId }) => {
      const descriptor = userInputConsentDescriptorsRef.current.get(requestId);
      if (!descriptor) return;
      userInputConsentDescriptorsRef.current.delete(requestId);
      resolveConsentNotification(
        descriptor.kind === "agent-consent"
          ? "dyad-agent-consent"
          : "dyad-mcp-consent",
        requestId,
      );
    });
    return () => unsubscribe();
  }, [resolveConsentNotification]);

  // Planning Questionnaire Listener (IPC)
  useEffect(() => {
    const unsubscribe = planEventClient.onQuestionnaire(async (payload) => {
      handleConsentRequest({
        chatId: payload.chatId,
        toolName: "Planning Questions",
        sourceLabel: `${payload.questions.length} questions`,
        tagPrefix: "dyad-plan-questionnaire",
      }).catch(console.error);
    });
    return () => unsubscribe();
  }, [handleConsentRequest]);

  // Close notifications when window gains focus (user returned to app).
  useEffect(() => {
    const handleFocus = () => {
      const currentChatId = currentRouteRef.current.chatIdFromRoute;

      for (const [tag, notification] of notificationsRef.current.entries()) {
        // Close completion notifications (informational, in-app handles it)
        if (tag.startsWith("dyad-chat-complete-")) {
          notification.close();
          const timer = autoCloseTimersRef.current.get(tag);
          if (timer) clearTimeout(timer);
          autoCloseTimersRef.current.delete(tag);
          notificationsRef.current.delete(tag);
        }
        // Close consent notifications for the currently focused chat (in-app banner shows it)
        // to avoid OS + in-app UI duplication
        else if (
          (tag.startsWith("dyad-agent-consent-") ||
            tag.startsWith("dyad-mcp-consent-") ||
            tag.startsWith("dyad-plan-questionnaire-")) &&
          currentChatId
        ) {
          const chatIdInTag = notificationChatIdByTagRef.current.get(tag);
          if (chatIdInTag === currentChatId) {
            notification.close();
            const timer = autoCloseTimersRef.current.get(tag);
            if (timer) clearTimeout(timer);
            autoCloseTimersRef.current.delete(tag);
            notificationChatIdByTagRef.current.delete(tag);
            notificationsRef.current.delete(tag);
          }
        }
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);
}
