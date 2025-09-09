import { ipcMain } from "electron";
import { streamText, Tool } from "ai";
import { readSettings } from "../../main/settings";

import log from "electron-log";
import { safeSend } from "../utils/safe_sender";
import {
  createOpenAI,
  openai,
  OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
import { StartHelpChatParams } from "../ipc_types";

const logger = log.scope("help-bot");

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

        // Clear any existing active streams (only one session at a time)
        for (const [existingSessionId, controller] of activeHelpStreams) {
          controller.abort();
          activeHelpStreams.delete(existingSessionId);
          helpSessions.delete(existingSessionId);
        }

        // Append user message to session history
        const history = helpSessions.get(sessionId) ?? [];
        const updatedHistory: HelpMessage[] = [
          ...history,
          { role: "user", content: message },
        ];

        const abortController = new AbortController();
        activeHelpStreams.set(sessionId, abortController);
        const settings = await readSettings();
        const apiKey = settings.providerSettings?.["auto"]?.apiKey?.value;
        const provider = createOpenAI({
          baseURL: "https://helpchat.dyad.sh/v1",
          apiKey,
        });

        let assistantContent = "";

        const stream = streamText({
          model: provider.responses("gpt-5-nano"),
          providerOptions: {
            openai: {
              reasoningSummary: "auto",
            } satisfies OpenAIResponsesProviderOptions,
          },
          tools: {
            web_search_preview: openai.tools.webSearchPreview({
              searchContextSize: "high",
            }) as Tool,
          },
          messages: updatedHistory as any,
          maxRetries: 1,
          onError: (error) => {
            let errorMessage = (error as any)?.error?.message;
            logger.error("help bot stream error", errorMessage);
            safeSend(event.sender, "help:chat:response:error", {
              sessionId,
              error: String(errorMessage),
            });
          },
        });

        (async () => {
          try {
            for await (const part of stream.fullStream) {
              if (abortController.signal.aborted) break;

              if (part.type === "text-delta") {
                assistantContent += part.text;
                safeSend(event.sender, "help:chat:response:chunk", {
                  sessionId,
                  delta: part.text,
                  type: "text",
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
