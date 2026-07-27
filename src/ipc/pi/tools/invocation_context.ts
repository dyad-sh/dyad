import type { AgentContext, UserMessageContentPart } from "./dyad/types";

const FORWARDED_TURN_FIELDS = [
  "frameworkType",
  "isSharedModulesChanged",
  "workspaceMutated",
  "chatSummary",
  "todos",
  "testRunCount",
  "mutationCount",
] as const satisfies readonly (keyof AgentContext)[];

/**
 * Build one tool-call view over a turn context. Invocation-local callbacks and
 * cancellation are isolated, while writes to turn-level scalar trackers are
 * explicitly forwarded to the owning context. Array/Map trackers remain shared
 * through the shallow clone.
 */
export function createInvocationContext(
  turnContext: AgentContext,
  invocation: {
    signal?: AbortSignal;
    onXml: (xml: string) => void;
    onAppendUserMessage: (content: unknown) => void;
  },
): AgentContext {
  const context: AgentContext = {
    ...turnContext,
    abortSignal: invocation.signal ?? turnContext.abortSignal,
    onXmlStream: invocation.onXml,
    onXmlComplete: invocation.onXml,
    appendUserMessage: (content: UserMessageContentPart[]) =>
      invocation.onAppendUserMessage(content),
  };

  for (const field of FORWARDED_TURN_FIELDS) {
    Object.defineProperty(context, field, {
      configurable: true,
      enumerable: true,
      get: () => turnContext[field],
      set: (value) => {
        (turnContext as Record<keyof AgentContext, unknown>)[field] = value;
      },
    });
  }

  return context;
}
