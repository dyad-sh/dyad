import type { VisibleEntity } from "./types";

export type InitialWindowNavigation =
  | {
      to: "/app-details";
      search: { appId: number };
    }
  | {
      to: "/chat";
      search: { id: number };
    };

export function initialWindowNavigation(
  entity: VisibleEntity | undefined,
): InitialWindowNavigation | undefined {
  if (!entity) return undefined;
  return entity.kind === "chat"
    ? { to: "/chat", search: { id: entity.id } }
    : { to: "/app-details", search: { appId: entity.id } };
}
