import { IpcClient } from "../ipc/ipc_client";
import { Message } from "../ipc/ipc_types";

export function callLlm(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // TODO: Figure out how to get a real chatId
    const chatId = 1;

    let fullResponse = "";

    IpcClient.getInstance().streamMessage(prompt, {
      chatId,
      onUpdate: (messages: Message[]) => {
        // The last message is the one being streamed
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === "assistant") {
          fullResponse = lastMessage.content;
        }
      },
      onEnd: () => {
        resolve(fullResponse);
      },
      onError: (error: string) => {
        reject(new Error(error));
      },
    });
  });
}
