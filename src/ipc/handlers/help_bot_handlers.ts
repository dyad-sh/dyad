import { ipcMain } from "electron";
import { streamText } from "ai";
import { readSettings } from "../../main/settings";
import { getModelClient } from "../utils/get_model_client";
import log from "electron-log";
import { safeSend } from "../utils/safe_sender";

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

        // Prepare model client (explicitly use OpenAI gpt-5-nano)
        const settings = await readSettings();
        const { modelClient } = await getModelClient(
          { provider: "openai", name: "gpt-5-nano" },
          settings,
        );

        const abortController = new AbortController();
        activeHelpStreams.set(sessionId, abortController);

        const systemPrompt =
          "You are the Dyad help bot. Provide concise, accurate assistance about using the Dyad app. If unsure, suggest checking the docs at https://www.dyad.sh/docs.";

        let assistantContent = "";

        const stream = await streamText({
          model: modelClient.model,
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
            for await (const part of stream.fullStream as any) {
              if (abortController.signal.aborted) break;
              if (part.type === "text-delta") {
                assistantContent +=
                  (part as any).text ?? (part as any).textDelta ?? "";
                safeSend(event.sender, "help:chat:response:chunk", {
                  sessionId,
                  delta: (part as any).text ?? (part as any).textDelta ?? "",
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
