import { safeSend } from "../utils/safe_sender";
import { cleanFullResponse } from "../utils/cleanFullResponse";

// e.g. [dyad-qa=add-dep]
// Canned responses for test prompts
const TEST_RESPONSES: Record<string, string> = {
  "ts-error": `This will get a TypeScript error.
  
  <dyad-write path="src/bad-file.ts" description="This will get a TypeScript error.">
  import NonExistentClass from 'non-existent-class';

  const x = new Object();
  x.nonExistentMethod();
  </dyad-write>
  
  EOM`,
  "add-dep": `I'll add that dependency for you.
  
  <dyad-add-dependency packages="deno"></dyad-add-dependency>
  
  EOM`,
  "add-non-existing-dep": `I'll add that dependency for you.
  
  <dyad-add-dependency packages="@angular/does-not-exist"></dyad-add-dependency>
  
  EOM`,
  "add-multiple-deps": `I'll add that dependency for you.
  
  <dyad-add-dependency packages="react-router-dom react-query"></dyad-add-dependency>
  
  EOM`,
  write: `Hello world
  <dyad-write path="src/hello.ts" content="Hello world">
  console.log("Hello world");
  </dyad-write>
  EOM`,
  "string-literal-leak": `BEFORE TAG
  <dyad-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</dyad-write>
AFTER TAG
`,
};

/**
 * Checks if a prompt is a test prompt and returns the corresponding canned response
 * @param prompt The user prompt
 * @returns The canned response if it's a test prompt, null otherwise
 */
export function getTestResponse(prompt: string): string | null {
  const match = prompt.match(/\[dyad-qa=([^\]]+)\]/);
  if (match) {
    const testKey = match[1];
    return TEST_RESPONSES[testKey] || null;
  }
  return null;
}

/**
 * Streams a canned test response to the client
 * @param event The IPC event
 * @param chatId The chat ID
 * @param testResponse The canned response to stream
 * @param abortController The abort controller for this stream
 * @param updatedChat The chat data with messages
 * @returns The full streamed response
 */
export async function streamTestResponse(
  event: Electron.IpcMainInvokeEvent,
  chatId: number,
  testResponse: string,
  abortController: AbortController,
  updatedChat: any,
): Promise<string> {
  console.log(`Using canned response for test prompt`);

  // Simulate streaming by splitting the response into chunks
  const chunks = testResponse.split(" ");
  let fullResponse = "";

  for (const chunk of chunks) {
    // Skip processing if aborted
    if (abortController.signal.aborted) {
      break;
    }

    // Add the word plus a space
    fullResponse += chunk + " ";
    fullResponse = cleanFullResponse(fullResponse);

    // Send the current accumulated response
    safeSend(event.sender, "chat:response:chunk", {
      chatId: chatId,
      messages: [
        ...updatedChat.messages,
        {
          role: "assistant",
          content: fullResponse,
        },
      ],
    });

    // Add a small delay to simulate streaming
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return fullResponse;
}
