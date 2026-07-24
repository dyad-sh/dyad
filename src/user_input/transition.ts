/** Pure, total transition function for the user-input round-trip machine. */
import { change, ignore, type TransitionResult } from "../state_machines/types";
import type { UserInputCommand } from "./commands";
import type {
  UserInputDescriptor,
  UserInputEvent,
  UserInputOutcome,
  UserInputResponse,
  UserInputState,
} from "./state";

export type UserInputIgnoreReason =
  | "unknown-request"
  | "request-id-mismatch"
  | "chat-id-mismatch"
  | "already-settled"
  | "classifier-not-racing"
  | "response-kind-mismatch"
  | "follow-up-not-armed"
  | "follow-up-not-due"
  | "already-due"
  | "invalid-in-current-state";

export type UserInputTransitionResult = TransitionResult<
  UserInputState,
  UserInputCommand,
  UserInputIgnoreReason
>;

function applied(
  state: UserInputState,
  commands: readonly UserInputCommand[],
): UserInputTransitionResult {
  return change(state, commands);
}

function terminalCommands(
  descriptor: UserInputDescriptor,
  outcome: UserInputOutcome,
  value: Extract<UserInputCommand, { type: "resolve-park" }>["value"],
): UserInputCommand[] {
  return [
    { type: "cancel-deadline", requestId: descriptor.requestId },
    { type: "broadcast-settled", descriptor, outcome },
    { type: "resolve-park", requestId: descriptor.requestId, value },
  ];
}

function settle(
  descriptor: UserInputDescriptor,
  outcome: UserInputOutcome,
  value: Extract<UserInputCommand, { type: "resolve-park" }>["value"],
  extra: readonly UserInputCommand[] = [],
): UserInputTransitionResult {
  return applied(
    {
      status: "settled",
      requestId: descriptor.requestId,
      chatId: descriptor.chatId,
      outcome,
    },
    [...extra, ...terminalCommands(descriptor, outcome, value)],
  );
}

function isAlways(response: UserInputResponse): boolean {
  return (
    (response.kind === "mcp-consent" || response.kind === "agent-consent") &&
    response.decision === "accept-always"
  );
}

function responseMatches(
  descriptor: UserInputDescriptor,
  response: UserInputResponse,
): boolean {
  return descriptor.kind === response.kind;
}

function unreachable(value: never): never {
  throw new Error(`Unreachable user-input value: ${String(value)}`);
}

export function transition(
  state: UserInputState,
  event: UserInputEvent,
): UserInputTransitionResult {
  if (event.type === "requested") {
    const commands: UserInputCommand[] = [];
    if (
      state.status === "awaiting" ||
      state.status === "armed" ||
      state.status === "due"
    ) {
      commands.push(...terminalCommands(state.descriptor, "superseded", null));
    }
    const next: UserInputState = {
      status: "awaiting",
      descriptor: event.descriptor,
      classifier: event.descriptor.classifier,
    };
    commands.push(
      { type: "broadcast-requested", descriptor: event.descriptor },
      {
        type: "schedule-deadline",
        requestId: event.descriptor.requestId,
        ms: event.deadlineMs,
      },
    );
    return applied(
      JSON.stringify(state) === JSON.stringify(next) ? state : next,
      commands,
    );
  }

  if (state.status === "idle") return ignore(state, "unknown-request");
  if (state.status === "settled") {
    if ("requestId" in event && event.requestId !== state.requestId) {
      return ignore(state, "request-id-mismatch");
    }
    if ("chatId" in event && event.chatId !== state.chatId) {
      return ignore(state, "chat-id-mismatch");
    }
    return ignore(state, "already-settled");
  }
  const descriptor = state.descriptor;
  if ("requestId" in event && event.requestId !== descriptor.requestId) {
    return ignore(state, "request-id-mismatch");
  }
  if ("chatId" in event && event.chatId !== descriptor.chatId) {
    return ignore(state, "chat-id-mismatch");
  }
  switch (event.type) {
    case "human-decided": {
      if (state.status !== "awaiting") {
        return ignore(state, "invalid-in-current-state");
      }
      if (!responseMatches(descriptor, event.response)) {
        return ignore(state, "response-kind-mismatch");
      }
      const persist: UserInputCommand[] = isAlways(event.response)
        ? [{ type: "persist-always", descriptor, response: event.response }]
        : [];
      if (
        descriptor.kind === "integration" &&
        event.response.kind === "integration" &&
        event.response.completed &&
        event.response.provider
      ) {
        const followUpPrompt = `Continue. I have completed the ${event.response.provider} integration.`;
        return applied(
          {
            status: "armed",
            descriptor: {
              ...descriptor,
              followUpPrompt,
            } as UserInputDescriptor & {
              followUpPrompt: string;
            },
            followUpPrompt,
          },
          [
            ...persist,
            { type: "cancel-deadline", requestId: descriptor.requestId },
            {
              type: "broadcast-armed",
              descriptor,
              followUpPrompt,
            },
            {
              type: "resolve-park",
              requestId: descriptor.requestId,
              value: event.response,
            },
          ],
        );
      }
      return settle(descriptor, "human", event.response, persist);
    }
    case "classifier-decided": {
      if (state.status !== "awaiting" || state.classifier !== "racing") {
        return ignore(state, "classifier-not-racing");
      }
      if (event.approved) {
        return settle(descriptor, "classifier-approved", {
          kind: "classifier-approved",
          reason: event.reason,
        });
      }
      return applied(
        { ...state, classifier: "review", classifierReason: event.reason },
        [{ type: "broadcast-classified", descriptor, reason: event.reason }],
      );
    }
    case "timed-out":
      return settle(descriptor, "timed-out", null);
    case "chat-swept":
      return settle(descriptor, "swept", null);
    case "stream-finished": {
      if (state.status === "armed") {
        return applied(
          {
            status: "due",
            descriptor: state.descriptor,
            followUpPrompt: state.followUpPrompt,
          },
          [
            {
              type: "broadcast-follow-up-due",
              requestId: descriptor.requestId,
              chatId: descriptor.chatId,
              prompt: state.followUpPrompt,
            },
          ],
        );
      }
      if (state.status === "due") return ignore(state, "already-due");
      return ignore(state, "follow-up-not-armed");
    }
    case "follow-up-dispatched":
      return state.status === "due"
        ? settle(descriptor, "dispatched", null)
        : ignore(state, "follow-up-not-due");
    default: {
      const exhaustive: never = event;
      return unreachable(exhaustive);
    }
  }
}
