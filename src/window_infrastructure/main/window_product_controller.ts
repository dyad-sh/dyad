import type {
  VisibleEntity,
  WindowSessionId,
} from "@/window_infrastructure/types";

export interface WindowProductController {
  openEntityInNewWindow(entity: VisibleEntity): WindowSessionId;
  initialEntityForSession(
    windowSessionId: WindowSessionId,
  ): VisibleEntity | undefined;
  setVisibleEntities(
    windowSessionId: WindowSessionId,
    entities: readonly VisibleEntity[],
  ): void;
}

let controller: WindowProductController | undefined;

export function configureWindowProductController(
  next: WindowProductController,
): void {
  controller = next;
}

export function getWindowProductController():
  | WindowProductController
  | undefined {
  return controller;
}
