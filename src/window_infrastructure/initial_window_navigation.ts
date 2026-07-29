import type { VisibleEntity } from "./types";

export type InitialWindowNavigation =
  | {
      to: "/app-details";
      search: { appId: number };
    }
  | {
      to: "/chat";
      search: { id: number; appId?: number };
    };

export function initialWindowNavigation(
  entity: VisibleEntity | undefined,
  initialChatAppId?: number,
): InitialWindowNavigation | undefined {
  if (!entity) return undefined;
  return entity.kind === "chat"
    ? {
        to: "/chat",
        search: { id: entity.id, appId: initialChatAppId },
      }
    : { to: "/app-details", search: { appId: entity.id } };
}
