import { productionChatStreamCommands } from "./commands";
import {
  createChatStreamController,
  type ChatStreamController,
} from "./controller";

/**
 * Module-scope registry of per-chat stream controllers.
 *
 * Controllers are created lazily on first use and disposed once they are
 * terminal (idle or errored), quiescent (no pending commands), and
 * unobserved — the machine's generation counter restarts for a fresh
 * controller, which is safe because a terminal controller has released its
 * IPC stream entry (so no stale events can reach a new generation). The
 * error itself lives on in `chatErrorByIdAtom`, and a fresh controller
 * behaves identically to an errored one for both submit and queue pokes.
 */
const controllers = new Map<number, ChatStreamController>();

function maybeDispose(controller: ChatStreamController): void {
  const snapshotType = controller.getSnapshot().type;
  if (
    controllers.get(controller.chatId) === controller &&
    (snapshotType === "idle" || snapshotType === "errored") &&
    controller.isSettled() &&
    !controller.hasSubscribers()
  ) {
    controllers.delete(controller.chatId);
  }
}

export function ensureController(chatId: number): ChatStreamController {
  let controller = controllers.get(chatId);
  if (!controller) {
    controller = createChatStreamController({
      chatId,
      getCommands: () => productionChatStreamCommands,
      onQuiescent: maybeDispose,
    });
    controllers.set(chatId, controller);
  }
  return controller;
}

export function peekController(
  chatId: number,
): ChatStreamController | undefined {
  return controllers.get(chatId);
}

/**
 * Forward the main process's `chat:stream:start` registration confirmation
 * into the machine (drives the `starting -> streaming` transition and the
 * cancel-before-registration reconciliation).
 */
export function notifyStreamRegistered(chatId: number): void {
  controllers.get(chatId)?.send({ type: "registered" });
}
