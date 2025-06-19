import { ipcMain } from "electron";
import { CoreMessage, TextPart, ImagePart, streamText } from "ai";
import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  constructSystemPrompt,
  readAiRules,
} from "../../prompts/system_prompt";
import {
  SUPABASE_AVAILABLE_SYSTEM_PROMPT,
  SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT,
} from "../../prompts/supabase_prompt";
import { getDyadAppPath } from "../../paths/paths";
import { readSettings } from "../../main/settings";
import type { ChatResponseEnd, ChatStreamParams } from "../ipc_types";
import { extractCodebase } from "../../utils/codebase";
import { processFullResponseActions } from "../processors/response_processor";
import { streamTestResponse } from "./testing_chat_handlers";
import { getTestResponse } from "./testing_chat_handlers";
import { getModelClient } from "../utils/get_model_client";
import log from "electron-log";
import {
  getSupabaseContext,
  getSupabaseClientCode,
} from "../../supabase_admin/supabase_context";
import { SUMMARIZE_CHAT_SYSTEM_PROMPT } from "../../prompts/summarize_chat_system_prompt";
import fs from "node:fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { readFile, writeFile, unlink } from "fs/promises";
import { getMaxTokens } from "../utils/token_utils";
import { MAX_CHAT_TURNS_IN_CONTEXT } from "@/constants/settings_constants";
import { validateChatContext } from "../utils/context_paths_utils";
import { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";

import { getExtraProviderOptions } from "../utils/thinking_utils";

import { safeSend } from "../utils/safe_sender";
import { cleanFullResponse } from "../utils/cleanFullResponse";

const logger = log.scope("chat_stream_handlers");

// Track active streams for cancellation
const activeStreams = new Map<number, AbortController>();

// Track partial responses for cancelled streams
const partialResponses = new Map<number, string>();

// Directory for storing temporary files
const TEMP_DIR = path.join(os.tmpdir(), "dyad-attachments");

// Common helper functions
const TEXT_FILE_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".js",
  ".ts",
  ".html",
  ".css",
];

async function isTextFile(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.includes(ext);
}

// Ensure the temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export function registerChatStreamHandlers() {
  ipcMain.handle("chat:stream", async (event, req: ChatStreamParams) => {
    try {
      // Create an AbortController for this stream
      const abortController = new AbortController();
      activeStreams.set(req.chatId, abortController);

      // Get the chat to check for existing messages
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
          app: true, // Include app information
        },
      });

      if (!chat) {
        throw new Error(`Chat not found: ${req.chatId}`);
      }

      // Handle redo option: remove the most recent messages if needed
      if (req.redo) {
        // Get the most recent messages
        const chatMessages = [...chat.messages];

        // Find the most recent user message
        let lastUserMessageIndex = chatMessages.length - 1;
        while (
          lastUserMessageIndex >= 0 &&
          chatMessages[lastUserMessageIndex].role !== "user"
        ) {
          lastUserMessageIndex--;
        }

        if (lastUserMessageIndex >= 0) {
          // Delete the user message
          await db
            .delete(messages)
            .where(eq(messages.id, chatMessages[lastUserMessageIndex].id));

          // If there's an assistant message after the user message, delete it too
          if (
            lastUserMessageIndex < chatMessages.length - 1 &&
            chatMessages[lastUserMessageIndex + 1].role === "assistant"
          ) {
            await db
              .delete(messages)
              .where(
                eq(messages.id, chatMessages[lastUserMessageIndex + 1].id),
              );
          }
        }
      }

      // Process attachments if any
      let attachmentInfo = "";
      let attachmentPaths: string[] = [];

      if (req.attachments && req.attachments.length > 0) {
        attachmentInfo = "\n\nAttachments:\n";

        for (const attachment of req.attachments) {
          // Generate a unique filename
          const hash = crypto
            .createHash("md5")
            .update(attachment.name + Date.now())
            .digest("hex");
          const fileExtension = path.extname(attachment.name);
          const filename = `${hash}${fileExtension}`;
          const filePath = path.join(TEMP_DIR, filename);

          // Extract the base64 data (remove the data:mime/type;base64, prefix)
          const base64Data = attachment.data.split(";base64,").pop() || "";

          await writeFile(filePath, Buffer.from(base64Data, "base64"));
          attachmentPaths.push(filePath);
          attachmentInfo += `- ${attachment.name} (${attachment.type})\n`;
          // If it's a text-based file, try to include the content
          if (await isTextFile(filePath)) {
            try {
              attachmentInfo += `<dyad-text-attachment filename="${attachment.name}" type="${attachment.type}" path="${filePath}">
              </dyad-text-attachment>
              \n\n`;
            } catch (err) {
              logger.error(`Error reading file content: ${err}`);
            }
          }
        }
      }

      // Add user message to database with attachment info
      let userPrompt = req.prompt + (attachmentInfo ? attachmentInfo : "");
      if (req.selectedComponent) {
        let componentSnippet = "[component snippet not available]";
        try {
          const componentFileContent = await readFile(
            path.join(
              getDyadAppPath(chat.app.path),
              req.selectedComponent.relativePath,
            ),
            "utf8",
          );
          const lines = componentFileContent.split("\n");
          const selectedIndex = req.selectedComponent.lineNumber - 1;

          // Let's get one line before and three after for context.
          const startIndex = Math.max(0, selectedIndex - 1);
          const endIndex = Math.min(lines.length, selectedIndex + 4);

          const snippetLines = lines.slice(startIndex, endIndex);
          const selectedLineInSnippetIndex = selectedIndex - startIndex;

          if (snippetLines[selectedLineInSnippetIndex]) {
            snippetLines[selectedLineInSnippetIndex] =
              `${snippetLines[selectedLineInSnippetIndex]} // <-- EDIT HERE`;
          }

          componentSnippet = snippetLines.join("\n");
        } catch (err) {
          logger.error(`Error reading selected component file content: ${err}`);
        }

        userPrompt += `\n\nSelected component: ${req.selectedComponent.name} (file: ${req.selectedComponent.relativePath})

Snippet:
\`\`\`
${componentSnippet}
\`\`\`
`;
      }
      await db
        .insert(messages)
        .values({
          chatId: req.chatId,
          role: "user",
          content: userPrompt,
        })
        .returning();

      // Add a placeholder assistant message immediately
      const [placeholderAssistantMessage] = await db
        .insert(messages)
        .values({
          chatId: req.chatId,
          role: "assistant",
          content: "", // Start with empty content
        })
        .returning();

      // Fetch updated chat data after possible deletions and additions
      const updatedChat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
          app: true, // Include app information
        },
      });

      if (!updatedChat) {
        throw new Error(`Chat not found: ${req.chatId}`);
      }

      // Send the messages right away so that the loading state is shown for the message.
      safeSend(event.sender, "chat:response:chunk", {
        chatId: req.chatId,
        messages: updatedChat.messages,
      });

      let fullResponse = "";

      // Check if this is a test prompt
      const testResponse = getTestResponse(req.prompt);

      if (testResponse) {
        // For test prompts, use the dedicated function
        fullResponse = await streamTestResponse(
          event,
          req.chatId,
          testResponse,
          abortController,
          updatedChat,
        );
      } else {
        // Normal AI processing for non-test prompts
        const settings = readSettings();

        // Extract codebase information if app is associated with the chat
        let codebaseInfo = "";
        let files: { path: string; content: string }[] = [];
        if (updatedChat.app) {
          const appPath = getDyadAppPath(updatedChat.app.path);
          try {
            const out = await extractCodebase({
              appPath,
              chatContext: req.selectedComponent
                ? {
                    contextPaths: [
                      {
                        globPath: req.selectedComponent.relativePath,
                      },
                    ],
                    smartContextAutoIncludes: [],
                  }
                : validateChatContext(updatedChat.app.chatContext),
            });
            codebaseInfo = out.formattedOutput;
            files = out.files;
            logger.log(`Extracted codebase information from ${appPath}`);
          } catch (error) {
            logger.error("Error extracting codebase:", error);
          }
        }
        logger.log(
          "codebaseInfo: length",
          codebaseInfo.length,
          "estimated tokens",
          codebaseInfo.length / 4,
        );
        const { modelClient, isEngineEnabled } = await getModelClient(
          settings.selectedModel,
          settings,
          files,
        );

        // Prepare message history for the AI
        const messageHistory = updatedChat.messages.map((message) => ({
          role: message.role as "user" | "assistant" | "system",
          content: message.content,
        }));

        // Limit chat history based on maxChatTurnsInContext setting
        // We add 1 because the current prompt counts as a turn.
        const maxChatTurns =
          (settings.maxChatTurnsInContext || MAX_CHAT_TURNS_IN_CONTEXT) + 1;

        // If we need to limit the context, we take only the most recent turns
        let limitedMessageHistory = messageHistory;
        if (messageHistory.length > maxChatTurns * 2) {
          // Each turn is a user + assistant pair
          // Calculate how many messages to keep (maxChatTurns * 2)
          let recentMessages = messageHistory
            .filter((msg) => msg.role !== "system")
            .slice(-maxChatTurns * 2);

          // Ensure the first message is a user message
          if (recentMessages.length > 0 && recentMessages[0].role !== "user") {
            // Find the first user message
            const firstUserIndex = recentMessages.findIndex(
              (msg) => msg.role === "user",
            );
            if (firstUserIndex > 0) {
              // Drop assistant messages before the first user message
              recentMessages = recentMessages.slice(firstUserIndex);
            } else if (firstUserIndex === -1) {
              logger.warn(
                "No user messages found in recent history, set recent messages to empty",
              );
              recentMessages = [];
            }
          }

          limitedMessageHistory = [...recentMessages];

          logger.log(
            `Limiting chat history from ${messageHistory.length} to ${limitedMessageHistory.length} messages (max ${maxChatTurns} turns)`,
          );
        }

        let systemPrompt = constructSystemPrompt({
          aiRules: await readAiRules(getDyadAppPath(updatedChat.app.path)),
        });
        if (
          updatedChat.app?.supabaseProjectId &&
          settings.supabase?.accessToken?.value
        ) {
          systemPrompt +=
            "\n\n" +
            SUPABASE_AVAILABLE_SYSTEM_PROMPT +
            "\n\n" +
            (await getSupabaseContext({
              supabaseProjectId: updatedChat.app.supabaseProjectId,
            }));
        } else {
          systemPrompt += "\n\n" + SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT;
        }
        const isSummarizeIntent = req.prompt.startsWith(
          "Summarize from chat-id=",
        );
        if (isSummarizeIntent) {
          systemPrompt = SUMMARIZE_CHAT_SYSTEM_PROMPT;
        }

        // Update the system prompt for images if there are image attachments
        const hasImageAttachments =
          req.attachments &&
          req.attachments.some((attachment) =>
            attachment.type.startsWith("image/"),
          );

        if (hasImageAttachments) {
          systemPrompt += `

# Image Analysis Capabilities
This conversation includes one or more image attachments. When the user uploads images:
1. If the user explicitly asks for analysis, description, or information about the image, please analyze the image content.
2. Describe what you see in the image if asked.
3. You can use images as references when the user has coding or design-related questions.
4. For diagrams or wireframes, try to understand the content and structure shown.
5. For screenshots of code or errors, try to identify the issue or explain the code.
`;
        }

        const codebasePrefix = isEngineEnabled
          ? // No codebase prefix if engine is set, we will take of it there.
            []
          : ([
              {
                role: "user",
                content: "This is my codebase. " + codebaseInfo,
              },
              {
                role: "assistant",
                content: "OK, got it. I'm ready to help",
              },
            ] as const);

        let chatMessages: CoreMessage[] = [
          ...codebasePrefix,
          ...limitedMessageHistory.map((msg) => ({
            role: msg.role as "user" | "assistant" | "system",
            // Why remove thinking tags?
            // Thinking tags are generally not critical for the context
            // and eats up extra tokens.
            content: removeThinkingTags(msg.content),
          })),
        ];

        // Check if the last message should include attachments
        if (chatMessages.length >= 2 && attachmentPaths.length > 0) {
          const lastUserIndex = chatMessages.length - 2;
          const lastUserMessage = chatMessages[lastUserIndex];

          if (lastUserMessage.role === "user") {
            // Replace the last message with one that includes attachments
            chatMessages[lastUserIndex] = await prepareMessageWithAttachments(
              lastUserMessage,
              attachmentPaths,
            );
          }
        }

        if (isSummarizeIntent) {
          const previousChat = await db.query.chats.findFirst({
            where: eq(chats.id, parseInt(req.prompt.split("=")[1])),
            with: {
              messages: {
                orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              },
            },
          });
          chatMessages = [
            {
              role: "user",
              content:
                "Summarize the following chat: " +
                formatMessages(previousChat?.messages ?? []),
            } satisfies CoreMessage,
          ];
        }

        // When calling streamText, the messages need to be properly formatted for mixed content
        const { fullStream } = streamText({
          maxTokens: await getMaxTokens(settings.selectedModel),
          temperature: 0,
          maxRetries: 2,
          model: modelClient.model,
          providerOptions: {
            "dyad-gateway": getExtraProviderOptions(
              modelClient.builtinProviderId,
            ),
            google: {
              thinkingConfig: {
                includeThoughts: true,
              },
            } satisfies GoogleGenerativeAIProviderOptions,
          },
          system: systemPrompt,
          messages: chatMessages.filter((m) => m.content),
          onError: (error: any) => {
            logger.error("Error streaming text:", error);
            let errorMessage = (error as any)?.error?.message;
            const responseBody = error?.error?.responseBody;
            if (errorMessage && responseBody) {
              errorMessage += "\n\nDetails: " + responseBody;
            }
            const message = errorMessage || JSON.stringify(error);
            event.sender.send(
              "chat:response:error",
              `Sorry, there was an error from the AI: ${message}`,
            );
            // Clean up the abort controller
            activeStreams.delete(req.chatId);
          },
          abortSignal: abortController.signal,
        });

        // Process the stream as before
        let inThinkingBlock = false;
        try {
          for await (const part of fullStream) {
            let chunk = "";
            if (part.type === "text-delta") {
              if (inThinkingBlock) {
                chunk = "</think>";
                inThinkingBlock = false;
              }
              chunk += part.textDelta;
            } else if (part.type === "reasoning") {
              if (!inThinkingBlock) {
                chunk = "<think>";
                inThinkingBlock = true;
              }
              // Escape dyad tags in reasoning content
              // We are replacing the opening tag with a look-alike character
              // to avoid issues where thinking content includes dyad tags
              // and are mishandled by:
              // 1. FE markdown parser
              // 2. Main process response processor
              chunk += part.textDelta
                .replace(/<dyad/g, "＜dyad")
                .replace(/<\/dyad/g, "＜/dyad");
            }

            if (!chunk) {
              continue;
            }

            fullResponse += chunk;
            fullResponse = cleanFullResponse(fullResponse);

            if (
              fullResponse.includes("$$SUPABASE_CLIENT_CODE$$") &&
              updatedChat.app?.supabaseProjectId
            ) {
              const supabaseClientCode = await getSupabaseClientCode({
                projectId: updatedChat.app?.supabaseProjectId,
              });
              fullResponse = fullResponse.replace(
                "$$SUPABASE_CLIENT_CODE$$",
                supabaseClientCode,
              );
            }
            // Store the current partial response
            partialResponses.set(req.chatId, fullResponse);

            // Update the placeholder assistant message content in the messages array
            const currentMessages = [...updatedChat.messages];
            if (
              currentMessages.length > 0 &&
              currentMessages[currentMessages.length - 1].role === "assistant"
            ) {
              currentMessages[currentMessages.length - 1].content =
                fullResponse;
            }

            // Update the assistant message in the database
            safeSend(event.sender, "chat:response:chunk", {
              chatId: req.chatId,
              messages: currentMessages,
            });

            // If the stream was aborted, exit early
            if (abortController.signal.aborted) {
              logger.log(`Stream for chat ${req.chatId} was aborted`);
              break;
            }
          }
        } catch (streamError) {
          // Check if this was an abort error
          if (abortController.signal.aborted) {
            const chatId = req.chatId;
            const partialResponse = partialResponses.get(req.chatId);
            // If we have a partial response, save it to the database
            if (partialResponse) {
              try {
                // Update the placeholder assistant message with the partial content and cancellation note
                await db
                  .update(messages)
                  .set({
                    content: `${partialResponse}

[Response cancelled by user]`,
                  })
                  .where(eq(messages.id, placeholderAssistantMessage.id));

                logger.log(
                  `Updated cancelled response for placeholder message ${placeholderAssistantMessage.id} in chat ${chatId}`,
                );
                partialResponses.delete(req.chatId);
              } catch (error) {
                logger.error(
                  `Error saving partial response for chat ${chatId}:`,
                  error,
                );
              }
            }
            return req.chatId;
          }
          throw streamError;
        }
      }

      // Only save the response and process it if we weren't aborted
      if (!abortController.signal.aborted && fullResponse) {
        // Scrape from: <dyad-chat-summary>Renaming profile file</dyad-chat-title>
        const chatTitle = fullResponse.match(
          /<dyad-chat-summary>(.*?)<\/dyad-chat-summary>/,
        );
        if (chatTitle) {
          await db
            .update(chats)
            .set({ title: chatTitle[1] })
            .where(and(eq(chats.id, req.chatId), isNull(chats.title)));
        }
        const chatSummary = chatTitle?.[1];

        // Update the placeholder assistant message with the full response
        await db
          .update(messages)
          .set({ content: fullResponse })
          .where(eq(messages.id, placeholderAssistantMessage.id));

        if (readSettings().autoApproveChanges) {
          const status = await processFullResponseActions(
            fullResponse,
            req.chatId,
            { chatSummary, messageId: placeholderAssistantMessage.id }, // Use placeholder ID
          );

          const chat = await db.query.chats.findFirst({
            where: eq(chats.id, req.chatId),
            with: {
              messages: {
                orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              },
            },
          });

          safeSend(event.sender, "chat:response:chunk", {
            chatId: req.chatId,
            messages: chat!.messages,
          });

          if (status.error) {
            safeSend(
              event.sender,
              "chat:response:error",
              `Sorry, there was an error applying the AI's changes: ${status.error}`,
            );
          }

          // Signal that the stream has completed
          safeSend(event.sender, "chat:response:end", {
            chatId: req.chatId,
            updatedFiles: status.updatedFiles ?? false,
            extraFiles: status.extraFiles,
            extraFilesError: status.extraFilesError,
          } satisfies ChatResponseEnd);
        } else {
          safeSend(event.sender, "chat:response:end", {
            chatId: req.chatId,
            updatedFiles: false,
          } satisfies ChatResponseEnd);
        }
      }

      // Clean up any temporary files
      if (attachmentPaths.length > 0) {
        for (const filePath of attachmentPaths) {
          try {
            // We don't immediately delete files because they might be needed for reference
            // Instead, schedule them for deletion after some time
            setTimeout(
              async () => {
                if (fs.existsSync(filePath)) {
                  await unlink(filePath);
                  logger.log(`Deleted temporary file: ${filePath}`);
                }
              },
              30 * 60 * 1000,
            ); // Delete after 30 minutes
          } catch (error) {
            logger.error(`Error scheduling file deletion: ${error}`);
          }
        }
      }

      // Return the chat ID for backwards compatibility
      return req.chatId;
    } catch (error) {
      logger.error("Error calling LLM:", error);
      safeSend(
        event.sender,
        "chat:response:error",
        `Sorry, there was an error processing your request: ${error}`,
      );
      // Clean up the abort controller
      activeStreams.delete(req.chatId);
      return "error";
    }
  });

  // Handler to cancel an ongoing stream
  ipcMain.handle("chat:cancel", async (event, chatId: number) => {
    const abortController = activeStreams.get(chatId);

    if (abortController) {
      // Abort the stream
      abortController.abort();
      activeStreams.delete(chatId);
      logger.log(`Aborted stream for chat ${chatId}`);
    } else {
      logger.warn(`No active stream found for chat ${chatId}`);
    }

    // Send the end event to the renderer
    safeSend(event.sender, "chat:response:end", {
      chatId,
      updatedFiles: false,
    } satisfies ChatResponseEnd);

    return true;
  });
}

export function formatMessages(
  messages: { role: string; content: string | undefined }[],
) {
  return messages
    .map((m) => `<message role="${m.role}">${m.content}</message>`)
    .join("\n");
}

// Helper function to replace text attachment placeholders with full content
async function replaceTextAttachmentWithContent(
  text: string,
  filePath: string,
  fileName: string,
): Promise<string> {
  try {
    if (await isTextFile(filePath)) {
      // Read the full content
      const fullContent = await readFile(filePath, "utf-8");

      // Replace the placeholder tag with the full content
      const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tagPattern = new RegExp(
        `<dyad-text-attachment filename="[^"]*" type="[^"]*" path="${escapedPath}">\\s*<\\/dyad-text-attachment>`,
        "g",
      );

      const replacedText = text.replace(
        tagPattern,
        `Full content of ${fileName}:\n\`\`\`\n${fullContent}\n\`\`\``,
      );

      logger.log(
        `Replaced text attachment content for: ${fileName} - length before: ${text.length} - length after: ${replacedText.length}`,
      );
      return replacedText;
    }
    return text;
  } catch (error) {
    logger.error(`Error processing text file: ${error}`);
    return text;
  }
}

// Helper function to convert traditional message to one with proper image attachments
async function prepareMessageWithAttachments(
  message: CoreMessage,
  attachmentPaths: string[],
): Promise<CoreMessage> {
  let textContent = message.content;
  // Get the original text content
  if (typeof textContent !== "string") {
    logger.warn(
      "Message content is not a string - shouldn't happen but using message as-is",
    );
    return message;
  }

  // Process text file attachments - replace placeholder tags with full content
  for (const filePath of attachmentPaths) {
    const fileName = path.basename(filePath);
    textContent = await replaceTextAttachmentWithContent(
      textContent,
      filePath,
      fileName,
    );
  }

  // For user messages with attachments, create a content array
  const contentParts: (TextPart | ImagePart)[] = [];

  // Add the text part first with possibly modified content
  contentParts.push({
    type: "text",
    text: textContent,
  });

  // Add image parts for any image attachments
  for (const filePath of attachmentPaths) {
    const ext = path.extname(filePath).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
      try {
        // Read the file as a buffer
        const imageBuffer = await readFile(filePath);

        // Add the image to the content parts
        contentParts.push({
          type: "image",
          image: imageBuffer,
        });

        logger.log(`Added image attachment: ${filePath}`);
      } catch (error) {
        logger.error(`Error reading image file: ${error}`);
      }
    }
  }

  // Return the message with the content array
  return {
    role: "user",
    content: contentParts,
  };
}

function removeThinkingTags(text: string): string {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  return text.replace(thinkRegex, "").trim();
}
