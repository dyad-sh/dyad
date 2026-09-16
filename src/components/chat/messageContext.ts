import { createContext, useContext } from "react";

/**
 * The id the enclosing markdown parser was given for the content it is
 * rendering. For a chat message this is the message id; a sub-agent
 * activity is rendered with its activity id instead, and a parser mounted
 * without an id provides undefined. Cards that must match themselves to a
 * request raised from a chat message compare against the message id and
 * fall back to looser matching when it is undefined.
 */
export const DyadMessageIdContext = createContext<number | undefined>(
  undefined,
);

export function useDyadMessageId(): number | undefined {
  return useContext(DyadMessageIdContext);
}
