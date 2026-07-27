/**
 * User-input round-trip machine domain types.
 *
 * The main-process registry is authoritative. Renderer state is a read model.
 * The pure core has no machine dependencies; callers reach it through the
 * registry API. The renderer read model has one documented dependency edge:
 * user_input -> chat_stream facade, injected at the composition root.
 * Concurrency is first-applied-wins for every terminal event.
 */

export type ConsentDecision = "accept-once" | "accept-always" | "decline";

interface DescriptorBase {
  requestId: string;
  chatId: number;
  deadlineAt: number;
  followUpPrompt?: string;
}

export interface UserInputQuestion {
  id: string;
  type: "text" | "radio" | "checkbox";
  question: string;
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

export type UserInputDescriptor =
  | (DescriptorBase & {
      kind: "agent-consent";
      toolName: string;
      toolDescription?: string | null;
      inputPreview?: string | null;
      metadata?: unknown;
    })
  | (DescriptorBase & {
      kind: "questionnaire";
      questions: UserInputQuestion[];
    })
  | (DescriptorBase & {
      kind: "integration";
      provider?: "supabase" | "neon";
      followUpPrompt: string;
    });

export type NewUserInputDescriptor = UserInputDescriptor extends infer D
  ? D extends UserInputDescriptor
    ? Omit<D, "requestId" | "deadlineAt">
    : never
  : never;

export type UserInputResponse =
  | {
      kind: "agent-consent";
      decision: ConsentDecision;
    }
  | { kind: "questionnaire"; answers: Record<string, string> | null }
  | {
      kind: "integration";
      provider: "supabase" | "neon" | null;
      completed: boolean;
    };

export type UserInputParkValue = UserInputResponse;

export type UserInputOutcome =
  | "human"
  | "timed-out"
  | "swept"
  | "superseded"
  | "dispatched"
  | "rejected";

export type UserInputState =
  | { status: "idle" }
  | {
      status: "awaiting";
      descriptor: UserInputDescriptor;
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
  | { type: "timed-out"; requestId: string }
  | { type: "chat-swept"; chatId: number }
  | { type: "stream-finished"; chatId: number }
  | { type: "follow-up-dispatched"; requestId: string }
  | { type: "follow-up-rejected"; requestId: string };

export function isLiveUserInputState(
  state: UserInputState,
): state is Exclude<UserInputState, { status: "idle" | "settled" }> {
  return (
    state.status === "awaiting" ||
    state.status === "armed" ||
    state.status === "due"
  );
}
