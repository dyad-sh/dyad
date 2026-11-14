import type { QueuedMessageItem } from "@/atoms/chatAtoms";

/** Only plain text can be handed to a running Claude Code turn ("Send now");
 * anything with attachments, selected components or a redo waits for its
 * own turn. */
export function canSendQueuedMessageNow(message: QueuedMessageItem): boolean {
  return (
    (message.editable ?? true) &&
    (message.removable ?? true) &&
    !message.redo &&
    !message.attachments?.length &&
    !message.selectedComponents?.length &&
    message.prompt.trim().length > 0
  );
}
