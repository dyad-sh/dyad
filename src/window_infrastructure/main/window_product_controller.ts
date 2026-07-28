import type {
  VisibleEntity,
  WindowSessionId,
} from "@/window_infrastructure/types";

export interface WindowProductController {
  openEntityInNewWindow(entity: VisibleEntity): Promise<WindowSessionId>;
  initialEntityForSession(
    windowSessionId: WindowSessionId,
  ): VisibleEntity | undefined;
  setVisibleEntities(
    windowSessionId: WindowSessionId,
    entities: readonly VisibleEntity[],
  ): void;
  mayMigrateLegacyChatTabSession(windowSessionId: WindowSessionId): boolean;
  restorableWindowSessionIds(): readonly WindowSessionId[];
}

export async function awaitProductWindowRenderer<T>({
  rendererLoad,
  result,
  rollback,
}: {
  rendererLoad: Promise<void>;
  result: T;
  rollback: () => void;
}): Promise<T> {
  try {
    await rendererLoad;
    return result;
  } catch (error) {
    rollback();
    throw error;
  }
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
