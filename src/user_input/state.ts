/**
 * User-input round-trip machine domain types.
 *
 * The main-process registry is authoritative. Renderer state is a projection.
 * This machine has no machine dependencies; callers reach it through the
 * registry API. Concurrency is first-applied-wins for every terminal event.
 */

export type ConsentDecision = "accept-once" | "accept-always" | "decline";

interface DescriptorBase {
  requestId: string;
  chatId: number;
  deadlineAt: number;
  followUpPrompt?: string;
}

export type UserInputDescriptor =
  | (DescriptorBase & {
      kind: "mcp-consent";
      serverId: number;
      serverName: string;
      toolName: string;
      toolDescription?: string | null;
      inputPreview?: string | null;
      classifier: "none" | "racing";
    })
  | (DescriptorBase & {
      kind: "agent-consent";
      toolName: string;
      toolDescription?: string | null;
      inputPreview?: string | null;
      metadata?: unknown;
      classifier: "none";
    })
  | (DescriptorBase & {
      kind: "questionnaire";
      questions: unknown[];
      classifier: "none";
    })
  | (DescriptorBase & {
      kind: "integration";
      provider?: "supabase" | "neon";
      classifier: "none";
      followUpPrompt: string;
    });

export type NewUserInputDescriptor = UserInputDescriptor extends infer D
  ? D extends UserInputDescriptor
    ? Omit<D, "requestId" | "deadlineAt">
    : never
  : never;

export type UserInputResponse =
  | {
      kind: "mcp-consent" | "agent-consent";
      decision: ConsentDecision;
    }
  | { kind: "questionnaire"; answers: Record<string, string> | null }
  | {
      kind: "integration";
      provider: "supabase" | "neon" | null;
      completed: boolean;
    };

export type UserInputParkValue =
  | UserInputResponse
  | { kind: "classifier-approved"; reason?: string };

export type UserInputOutcome =
  | "human"
  | "classifier-approved"
  | "timed-out"
  | "swept"
  | "superseded"
  | "dispatched";

export type UserInputState =
  | { status: "idle" }
  | {
      status: "awaiting";
      descriptor: UserInputDescriptor;
      classifier: "none" | "racing" | "review";
    }
  | {
      status: "armed";
      descriptor: UserInputDescriptor & { followUpPrompt: string };
      followUpPrompt: string;
    }
  | {
      status: "due";
      descriptor: UserInputDescriptor & { followUpPrompt: string };
      followUpPrompt: string;
    }
  | {
      status: "settled";
      requestId: string;
      chatId: number;
      outcome: UserInputOutcome;
    };

export type UserInputEvent =
  | {
      type: "requested";
      descriptor: UserInputDescriptor;
      deadlineMs: number;
    }
  | {
      type: "human-decided";
      requestId: string;
      response: UserInputResponse;
    }
  | {
      type: "classifier-decided";
      requestId: string;
      approved: boolean;
      reason?: string;
    }
  | { type: "timed-out"; requestId: string }
  | { type: "chat-swept"; chatId: number }
  | { type: "stream-finished"; chatId: number }
  | { type: "follow-up-dispatched"; requestId: string };

export function isLiveUserInputState(
  state: UserInputState,
): state is Exclude<UserInputState, { status: "idle" | "settled" }> {
  return (
    state.status === "awaiting" ||
    state.status === "armed" ||
    state.status === "due"
  );
}
