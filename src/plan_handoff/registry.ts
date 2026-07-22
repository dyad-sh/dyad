import type { HandoffState } from "./state";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
import type { TransitionObserver } from "@/state_machines/types";
import type { HandoffCommand, HandoffEvent } from "./state";
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
export function createPlanHandoffRegistry(
  runCommand: HandoffCommandRunner,
  observer?: TransitionObserver<HandoffState, HandoffEvent, HandoffCommand>,
) {
  const host = new KeyedControllerHost<number, HandoffController>(() =>
    createHandoffController(runCommand, observer),
  );

  return {
    getOrCreate(chatId: number): HandoffController {
      return host.ensure(chatId);
    },

    getState(chatId: number | null): HandoffState {
      if (chatId === null) return IDLE_STATE;
      return host.get(chatId)?.getSnapshot() ?? IDLE_STATE;
    },

    getSnapshot(chatId: number): HandoffState {
      return host.get(chatId)?.getSnapshot() ?? IDLE_STATE;
    },

    subscribeKey(chatId: number, listener: () => void): () => void {
      return host.subscribeKey(chatId, listener);
    },

    disposeKey(chatId: number): void {
      host.disposeKey(chatId);
    },

    dispose(): void {
      host.dispose();
    },
  };
}
