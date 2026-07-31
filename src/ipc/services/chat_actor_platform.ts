import type { WebContents } from "electron";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import {
  windowRegistry,
  type WindowEndpoint,
} from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";

const nullEndpoint: WindowEndpoint = {
  // Synthetic endpoints must never look like registrable Electron webContents.
  // The execution proxy still observes terminal sends, but high-volume
  // presentation routing takes the non-producer path for this non-integer id.
  id: Number.NaN,
  isDestroyed: () => true,
  send: () => undefined,
  once: () => undefined,
};

export function chatExecutionEndpoint(
  chatId: number,
  preferredWindowSessionId?: string,
): WebContents {
  const preferred = preferredWindowSessionId
    ? windowRegistry.endpointForSession(
        preferredWindowSessionId as WindowSessionId,
      )
    : undefined;
  const routedSession = windowRegistry.routePresentation({
    effect: "user-input",
    initiatorWindowSessionId: preferredWindowSessionId as
      | WindowSessionId
      | undefined,
    entity: { kind: "chat", id: chatId },
  });
  const routed = routedSession
    ? windowRegistry.endpointForSession(routedSession)
    : undefined;
  return (preferred ??
    routed ??
    windowRegistry.liveEndpoints()[0] ??
    nullEndpoint) as WebContents;
}

export function publishChatInvalidations(
  chatId: number,
  targetAppId?: number | null,
): void {
  const scopes = [
    { family: "chats" },
    { family: "chat", chatId },
    { family: "token-count" },
  ] as const;
  queryInvalidationBus.publish(
    targetAppId === undefined || targetAppId === null
      ? scopes
      : [
          ...scopes,
          { family: "app", appId: targetAppId },
          { family: "versions", appId: targetAppId },
          { family: "uncommitted-files", appId: targetAppId },
        ],
  );
}

export function routePlanHandoffPresentation(input: {
  handoffId: string;
  sourceChatId: number;
  targetChatId: number;
  appId: number;
  originWindowSessionId?: string;
}): void {
  const session = windowRegistry.routePresentation({
    effect: "navigation",
    initiatorWindowSessionId: input.originWindowSessionId as
      | WindowSessionId
      | undefined,
    entity: { kind: "chat", id: input.sourceChatId },
  });
  if (!session) return;
  windowRegistry
    .endpointForSession(session)
    ?.send("plan:handoff-presentation", {
      handoffId: input.handoffId,
      sourceChatId: input.sourceChatId,
      targetChatId: input.targetChatId,
      appId: input.appId,
    });
}
