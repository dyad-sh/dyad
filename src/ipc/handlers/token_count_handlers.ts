import { ipcMain } from "electron";
import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import { SYSTEM_PROMPT } from "../../prompts/system_prompt";
import {
  SUPABASE_AVAILABLE_SYSTEM_PROMPT,
  SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT,
} from "../../prompts/supabase_prompt";
import { getDyadAppPath } from "../../paths/paths";
import log from "electron-log";
import { extractCodebase } from "../../utils/codebase";
import { getSupabaseContext } from "../../supabase_admin/supabase_context";
import { readSettings } from "../../main/settings";
import { MODEL_OPTIONS } from "../../constants/models";
import { TokenCountParams } from "../ipc_types";
import { TokenCountResult } from "../ipc_types";
import { estimateTokens, getContextWindow } from "../utils/token_utils";

const logger = log.scope("token_count_handlers");

export function registerTokenCountHandlers() {
  ipcMain.handle(
    "chat:count-tokens",
    async (event, req: TokenCountParams): Promise<TokenCountResult> => {
      try {
        // Get the chat with messages
        const chat = await db.query.chats.findFirst({
          where: eq(chats.id, req.chatId),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.createdAt)],
            },
            app: true,
          },
        });

        if (!chat) {
          throw new Error(`Chat not found: ${req.chatId}`);
        }

        // Prepare message history for token counting
        const messageHistory = chat.messages
          .map((message) => message.content)
          .join("");
        const messageHistoryTokens = estimateTokens(messageHistory);

        // Count input tokens
        const inputTokens = estimateTokens(req.input);

        // Count system prompt tokens
        let systemPrompt = SYSTEM_PROMPT;
        let supabaseContext = "";

        if (chat.app?.supabaseProjectId) {
          systemPrompt += "\n\n" + SUPABASE_AVAILABLE_SYSTEM_PROMPT;
          supabaseContext = await getSupabaseContext({
            supabaseProjectId: chat.app.supabaseProjectId,
          });
        } else {
          systemPrompt += "\n\n" + SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT;
        }

        const systemPromptTokens = estimateTokens(
          systemPrompt + supabaseContext,
        );

        // Extract codebase information if app is associated with the chat
        let codebaseInfo = "";
        let codebaseTokens = 0;

        if (chat.app) {
          const appPath = getDyadAppPath(chat.app.path);
          try {
            codebaseInfo = await extractCodebase(appPath);
            codebaseTokens = estimateTokens(codebaseInfo);
            logger.log(
              `Extracted codebase information from ${appPath}, tokens: ${codebaseTokens}`,
            );
          } catch (error) {
            logger.error("Error extracting codebase:", error);
          }
        }

        // Calculate total tokens
        const totalTokens =
          messageHistoryTokens +
          inputTokens +
          systemPromptTokens +
          codebaseTokens;

        return {
          totalTokens,
          messageHistoryTokens,
          codebaseTokens,
          inputTokens,
          systemPromptTokens,
          contextWindow: getContextWindow(),
        };
      } catch (error) {
        logger.error("Error counting tokens:", error);
        throw error;
      }
    },
  );
}
