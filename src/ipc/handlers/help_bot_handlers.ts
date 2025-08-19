import { ipcMain } from "electron";
import { streamText } from "ai";
import { readSettings } from "../../main/settings";
import { getModelClient } from "../utils/get_model_client";
import log from "electron-log";
import { safeSend } from "../utils/safe_sender";
import { openai, OpenAIResponsesProviderOptions } from "@ai-sdk/openai";

const logger = log.scope("help-bot");

interface StartHelpChatParams {
  sessionId: string;
  message: string;
}

// In-memory session store for help bot conversations
type HelpMessage = { role: "user" | "assistant"; content: string };
const helpSessions = new Map<string, HelpMessage[]>();
const activeHelpStreams = new Map<string, AbortController>();

export function registerHelpBotHandlers() {
  ipcMain.handle(
    "help:chat:start",
    async (event, params: StartHelpChatParams) => {
      const { sessionId, message } = params;
      try {
        if (!sessionId || !message?.trim()) {
          throw new Error("Missing sessionId or message");
        }

        // Append user message to session history
        const history = helpSessions.get(sessionId) ?? [];
        const updatedHistory: HelpMessage[] = [
          ...history,
          { role: "user", content: message },
        ];

        const abortController = new AbortController();
        activeHelpStreams.set(sessionId, abortController);

        const systemPrompt = `You are a helpful support bot for Dyad, the AI app builder.

# Role and Objective
- Assist users with questions related to Dyad using only verified information from https://www.dyad.sh/.

# Instructions
- Reference exclusively information available on https://www.dyad.sh/. DO NOT USE docs.dyad.sh - it does NOT exist and does not contain relevant information.
- If you are unsure or information is not available, clearly state that you do not know rather than guessing.
- For reporting bugs, advise users to close the chat and file a bug report.
- Do not generate or provide any code.
- Keep responses concise, clear, and helpful.

# Output Format
- Use clear, direct language.
- Default to plain text. Use Markdown formatting only where it improves readability, such as lists or emphasis.

# Stop Conditions
- End interaction when user queries are fully resolved or require escalation (like a bug report).
- Do not attempt to answer queries beyond the Dyad platform's scope.`;

        let assistantContent = "";

        const stream = await streamText({
          model: openai.responses("gpt-5-mini"),
          providerOptions: {
            openai: {
              reasoningSummary: "auto",
            } satisfies OpenAIResponsesProviderOptions,
          },
          tools: {
            web_search_preview: openai.tools.webSearchPreview({
              searchContextSize: "high",
            }),
          },
          system: systemPrompt,
          messages: updatedHistory as any,
          maxRetries: 2,
          onError: (err) => {
            logger.error("help bot stream error", err);
            safeSend(event.sender, "help:chat:response:error", {
              sessionId,
              error: String(err instanceof Error ? err.message : err),
            });
          },
        });

        (async () => {
          try {
            for await (const part of stream.fullStream) {
              console.log("part", part);
              if (abortController.signal.aborted) break;

              if (part.type === "text-delta") {
                assistantContent += part.text;
                safeSend(event.sender, "help:chat:response:chunk", {
                  sessionId,
                  delta: part.text,
                  type: "text",
                });
              } else if (part.type === "reasoning-delta") {
                // Stream reasoning content separately
                safeSend(event.sender, "help:chat:response:reasoning", {
                  sessionId,
                  delta: part.text,
                  type: "reasoning",
                });
              }
            }

            // Finalize session history
            const finalHistory: HelpMessage[] = [
              ...updatedHistory,
              { role: "assistant", content: assistantContent },
            ];
            helpSessions.set(sessionId, finalHistory);

            safeSend(event.sender, "help:chat:response:end", { sessionId });
          } catch (err) {
            if ((err as any)?.name === "AbortError") {
              logger.log("help bot stream aborted", sessionId);
              return;
            }
            logger.error("help bot stream loop error", err);
            safeSend(event.sender, "help:chat:response:error", {
              sessionId,
              error: String(err instanceof Error ? err.message : err),
            });
          } finally {
            activeHelpStreams.delete(sessionId);
          }
        })();

        return { ok: true } as const;
      } catch (err) {
        logger.error("help:chat:start error", err);
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
  );

  ipcMain.handle("help:chat:cancel", async (_event, sessionId: string) => {
    const controller = activeHelpStreams.get(sessionId);
    if (controller) {
      controller.abort();
      activeHelpStreams.delete(sessionId);
    }
    return { ok: true } as const;
  });
}
