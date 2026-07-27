import { userInputRegistry } from "@/user_input/main";

export function hasMatchingDueFollowUp(input: {
  requestId: string;
  chatId: number;
  prompt: string;
}): boolean {
  return userInputRegistry
    .getPending()
    .some(
      (request) =>
        request.status === "due" &&
        request.descriptor.requestId === input.requestId &&
        request.descriptor.chatId === input.chatId &&
        request.followUpPrompt === input.prompt,
    );
}

export async function rejectDueFollowUp(requestId: string): Promise<void> {
  await userInputRegistry.followUpRejected(requestId);
}
