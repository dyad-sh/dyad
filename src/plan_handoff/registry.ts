import type { HandoffState } from "./state";
import {
  createHandoffController,
  type HandoffCommandRunner,
  type HandoffController,
} from "./controller";

const IDLE_STATE: HandoffState = { type: "idle" };

/**
 * Lazy per-chat controller registry. Keeping this independent of React makes
 * controller ownership and deletion lifecycle explicit and directly testable.
 */
export function createPlanHandoffRegistry(runCommand: HandoffCommandRunner) {
  const controllers = new Map<number, HandoffController>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getOrCreate(chatId: number): HandoffController {
      let controller = controllers.get(chatId);
      if (!controller) {
        controller = createHandoffController(runCommand);
        controllers.set(chatId, controller);
        controller.subscribe(notify);
        notify();
      }
      return controller;
    },

    getState(chatId: number | null): HandoffState {
      if (chatId === null) return IDLE_STATE;
      return controllers.get(chatId)?.getSnapshot() ?? IDLE_STATE;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(chatId: number): void {
      const controller = controllers.get(chatId);
      if (!controller) return;

      controllers.delete(chatId);
      controller.dispose();
      notify();
    },
  };
}
