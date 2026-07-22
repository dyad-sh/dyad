import type {
  UserInputDescriptor,
  UserInputOutcome,
  UserInputParkValue,
  UserInputResponse,
} from "./state";

export type UserInputCommand =
  | { type: "broadcast-requested"; descriptor: UserInputDescriptor }
  | {
      type: "broadcast-armed";
      descriptor: UserInputDescriptor;
      followUpPrompt: string;
    }
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
          return;
        }
        case "broadcast-armed": {
          deps.broadcast("user-input:armed", {
            requestId: command.descriptor.requestId,
            followUpPrompt: command.followUpPrompt,
          });
          return;
        }
        case "broadcast-classified": {
          deps.broadcast("user-input:classified", {
            requestId: command.descriptor.requestId,
            reason: command.reason,
          });
          return;
        }
        case "broadcast-settled": {
          deps.broadcast("user-input:settled", {
            requestId: command.descriptor.requestId,
            outcome: command.outcome,
          });
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
