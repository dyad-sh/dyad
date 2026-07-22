import type {
  UserInputDescriptor,
  UserInputOutcome,
  UserInputParkValue,
  UserInputResponse,
} from "./state";

export type UserInputCommand =
  | { type: "broadcast-requested"; descriptor: UserInputDescriptor }
  | {
      type: "broadcast-classified";
      descriptor: UserInputDescriptor;
      reason?: string;
    }
  | {
      type: "broadcast-settled";
      descriptor: UserInputDescriptor;
      outcome: UserInputOutcome;
    }
  | {
      type: "broadcast-follow-up-due";
      requestId: string;
      chatId: number;
      prompt: string;
    }
  | {
      type: "resolve-park";
      requestId: string;
      value: UserInputParkValue | null;
    }
  | {
      type: "persist-always";
      descriptor: UserInputDescriptor;
      response: UserInputResponse;
    }
  | { type: "schedule-deadline"; requestId: string; ms: number }
  | { type: "cancel-deadline"; requestId: string };

export interface UserInputCommandRunner {
  run(command: UserInputCommand): void | Promise<void>;
}

export function createUserInputCommandRunner(deps: {
  broadcast: (channel: string, payload: unknown) => void;
  persistAlways: (
    descriptor: UserInputDescriptor,
    response: UserInputResponse,
  ) => void | Promise<void>;
}): UserInputCommandRunner {
  return {
    run(command) {
      switch (command.type) {
        case "broadcast-requested": {
          deps.broadcast("user-input:requested", command.descriptor);
          const descriptor = command.descriptor;
          if (descriptor.kind === "mcp-consent") {
            deps.broadcast("mcp:tool-consent-request", {
              ...descriptor,
              classifierPending:
                descriptor.classifier === "racing" || undefined,
            });
          } else if (descriptor.kind === "agent-consent") {
            deps.broadcast("agent-tool:consent-request", descriptor);
          } else if (descriptor.kind === "questionnaire") {
            // Kept for the in-PR dual-emission window. Renderer consumers use
            // user-input:requested; Phase 3 item 5 removes this legacy event.
            deps.broadcast("plan:questionnaire", {
              chatId: descriptor.chatId,
              requestId: descriptor.requestId,
              questions: descriptor.questions,
            });
          }
          return;
        }
        case "broadcast-classified": {
          deps.broadcast("user-input:classified", {
            requestId: command.descriptor.requestId,
            reason: command.reason,
          });
          if (command.descriptor.kind === "mcp-consent") {
            deps.broadcast("mcp:tool-consent-classified", {
              requestId: command.descriptor.requestId,
              reason: command.reason,
              chatId: command.descriptor.chatId,
              toolName: command.descriptor.toolName,
              serverName: command.descriptor.serverName,
            });
          }
          return;
        }
        case "broadcast-settled": {
          deps.broadcast("user-input:settled", {
            requestId: command.descriptor.requestId,
            outcome: command.outcome,
          });
          if (command.descriptor.kind === "mcp-consent") {
            deps.broadcast("mcp:tool-consent-resolved", {
              requestId: command.descriptor.requestId,
            });
          } else if (command.descriptor.kind === "agent-consent") {
            deps.broadcast("agent-tool:consent-resolved", {
              requestId: command.descriptor.requestId,
            });
          }
          return;
        }
        case "broadcast-follow-up-due":
          deps.broadcast("user-input:follow-up-due", {
            requestId: command.requestId,
            chatId: command.chatId,
            prompt: command.prompt,
          });
          return;
        case "persist-always":
          return deps.persistAlways(command.descriptor, command.response);
        case "resolve-park":
        case "schedule-deadline":
        case "cancel-deadline":
          return;
        default: {
          const exhaustive: never = command;
          return exhaustive;
        }
      }
    },
  };
}
