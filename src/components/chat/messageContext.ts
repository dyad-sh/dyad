import { createContext, useContext } from "react";

/**
 * The id of the chat message whose content is being rendered, for cards
 * that must match themselves to a request raised from that message.
 * Undefined outside a persisted message (for example a streaming preview
 * or a sub-agent activity).
 */
export const DyadMessageIdContext = createContext<number | undefined>(
  undefined,
);

export function useDyadMessageId(): number | undefined {
  return useContext(DyadMessageIdContext);
}
