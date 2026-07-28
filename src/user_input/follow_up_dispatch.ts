import type { UserInputCommand } from "./commands";

type FollowUpDueCommand = Extract<
  UserInputCommand,
  { type: "broadcast-follow-up-due" }
>;

export interface FollowUpDispatchDeps {
  isStillDue(requestId: string): boolean;
  waitForChatActorIdle(chatId: number): Promise<unknown>;
  dispatchUserInputFollowUp(input: {
    requestId: string;
    chatId: number;
    prompt: string;
  }): Promise<"accepted" | "rejected">;
  followUpDispatched(requestId: string): Promise<void>;
  followUpRejected(requestId: string): Promise<void>;
}

export async function dispatchDueFollowUp(
  command: FollowUpDueCommand,
  deps: FollowUpDispatchDeps,
): Promise<void> {
  try {
    while (deps.isStillDue(command.requestId)) {
      await deps.waitForChatActorIdle(command.chatId);
      // App/chat deletion can settle the owner while this dispatcher waits for
      // the previous turn to drain. Do not create a new actor after that sweep;
      // it could otherwise wait forever behind the deletion admission barrier.
      if (!deps.isStillDue(command.requestId)) return;
      const result = await deps.dispatchUserInputFollowUp({
        requestId: command.requestId,
        chatId: command.chatId,
        prompt: command.prompt,
      });
      if (result === "accepted") {
        if (deps.isStillDue(command.requestId)) {
          await deps.followUpDispatched(command.requestId);
        }
        return;
      }
      await deps.followUpRejected(command.requestId);
      return;
    }
  } catch (error) {
    if (deps.isStillDue(command.requestId)) {
      await deps.followUpRejected(command.requestId);
    }
    throw error;
  }
}
