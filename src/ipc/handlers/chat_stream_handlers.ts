import { ipcMain } from "electron";
import { streamText } from "ai";
import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { SYSTEM_PROMPT } from "../../prompts/system_prompt";
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

const logger = log.scope("chat_stream_handlers");

// Track active streams for cancellation
const activeStreams = new Map<number, AbortController>();

// Track partial responses for cancelled streams
const partialResponses = new Map<number, string>();

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
                eq(messages.id, chatMessages[lastUserMessageIndex + 1].id)
              );
          }
        }
      }

      // Add user message to database
      await db
        .insert(messages)
        .values({
          chatId: req.chatId,
          role: "user",
          content: req.prompt,
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
          updatedChat
        );
      } else {
        // Normal AI processing for non-test prompts
        const settings = readSettings();
        const modelClient = getModelClient(settings.selectedModel, settings);

        // Extract codebase information if app is associated with the chat
        let codebaseInfo = "";
        if (updatedChat.app) {
          const appPath = getDyadAppPath(updatedChat.app.path);
          try {
            codebaseInfo = await extractCodebase(appPath);
            logger.log(`Extracted codebase information from ${appPath}`);
          } catch (error) {
            logger.error("Error extracting codebase:", error);
          }
        }
        logger.log(
          "codebaseInfo: length",
          codebaseInfo.length,
          "estimated tokens",
          codebaseInfo.length / 4
        );

        // Prepare message history for the AI
        const messageHistory = updatedChat.messages.map((message) => ({
          role: message.role as "user" | "assistant" | "system",
          content: message.content,
        }));
        let systemPrompt = SYSTEM_PROMPT;
        if (readSettings().experiments?.enableSupabaseIntegration) {
          if (updatedChat.app?.supabaseProjectId) {
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
        }
        const { textStream } = streamText({
          maxTokens: 8_000,
          temperature: 0,
          model: modelClient,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: "This is my codebase. " + codebaseInfo,
            },
            {
              role: "assistant",
              content: "OK, got it. I'm ready to help",
            },
            ...messageHistory,
          ],
          onError: (error) => {
            logger.error("Error streaming text:", error);
            const message =
              (error as any)?.error?.message || JSON.stringify(error);
            event.sender.send(
              "chat:response:error",
              `Sorry, there was an error from the AI: ${message}`
            );
            // Clean up the abort controller
            activeStreams.delete(req.chatId);
          },
          abortSignal: abortController.signal,
        });

        // Process the stream as before
        try {
          for await (const textPart of textStream) {
            fullResponse += textPart;
            if (
              fullResponse.includes("$$SUPABASE_CLIENT_CODE$$") &&
              updatedChat.app?.supabaseProjectId
            ) {
              const supabaseClientCode = await getSupabaseClientCode({
                projectId: updatedChat.app?.supabaseProjectId,
              });
              fullResponse = fullResponse.replace(
                "$$SUPABASE_CLIENT_CODE$$",
                supabaseClientCode
              );
            }
            // Store the current partial response
            partialResponses.set(req.chatId, fullResponse);

            // Update the assistant message in the database
            event.sender.send("chat:response:chunk", {
              chatId: req.chatId,
              messages: [
                ...updatedChat.messages,
                {
                  role: "assistant",
                  content: fullResponse,
                },
              ],
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
                // Insert a new assistant message with the partial content
                await db.insert(messages).values({
                  chatId,
                  role: "assistant",
                  content: `${partialResponse}\n\n[Response cancelled by user]`,
                });
                logger.log(`Saved partial response for chat ${chatId}`);
                partialResponses.delete(chatId);
              } catch (error) {
                logger.error(
                  `Error saving partial response for chat ${chatId}:`,
                  error
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
          /<dyad-chat-summary>(.*?)<\/dyad-chat-summary>/
        );
        if (chatTitle) {
          await db
            .update(chats)
            .set({ title: chatTitle[1] })
            .where(and(eq(chats.id, req.chatId), isNull(chats.title)));
        }
        const chatSummary = chatTitle?.[1];

        // Create initial assistant message
        const [assistantMessage] = await db
          .insert(messages)
          .values({
            chatId: req.chatId,
            role: "assistant",
            content: fullResponse,
          })
          .returning();

        if (readSettings().autoApproveChanges) {
          const status = await processFullResponseActions(
            fullResponse,
            req.chatId,
            { chatSummary, messageId: assistantMessage.id }
          );

          const chat = await db.query.chats.findFirst({
            where: eq(chats.id, req.chatId),
            with: {
              messages: {
                orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              },
            },
          });

          event.sender.send("chat:response:chunk", {
            chatId: req.chatId,
            messages: chat!.messages,
          });

          if (status.error) {
            event.sender.send(
              "chat:response:error",
              `Sorry, there was an error applying the AI's changes: ${status.error}`
            );
          }

          // Signal that the stream has completed
          event.sender.send("chat:response:end", {
            chatId: req.chatId,
            updatedFiles: status.updatedFiles ?? false,
          } satisfies ChatResponseEnd);
        } else {
          event.sender.send("chat:response:end", {
            chatId: req.chatId,
            updatedFiles: false,
          } satisfies ChatResponseEnd);
        }
      }

      // Return the chat ID for backwards compatibility
      return req.chatId;
    } catch (error) {
      logger.error("Error calling LLM:", error);
      event.sender.send(
        "chat:response:error",
        `Sorry, there was an error processing your request: ${error}`
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
    event.sender.send("chat:response:end", {
      chatId,
      updatedFiles: false,
    } satisfies ChatResponseEnd);

    return true;
  });
}
