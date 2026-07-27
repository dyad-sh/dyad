import { db } from "../../db";
import { chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import {
  constructSystemPrompt,
  readAiRules,
} from "../../prompts/system_prompt";
import { getThemePromptById } from "../utils/theme_utils";
import {
  getSupabaseAvailableSystemPrompt,
  SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT,
} from "../../prompts/supabase_prompt";
import { buildNeonPromptForApp } from "../../neon_admin/neon_prompt_context";
import { getDyadAppPath } from "../../paths/paths";
import { detectFrameworkType } from "../utils/framework_utils";
import log from "electron-log";
import {
  getSupabaseContext,
  getSupabaseClientCode,
} from "../../supabase_admin/supabase_context";

import { TokenCountParams, TokenCountResult } from "@/ipc/types";
import { estimateTokens, getContextWindow } from "../utils/token_utils";
import { createLoggedHandler } from "./safe_handle";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveChatModeForTurn } from "./chat_mode_resolution";

const logger = log.scope("token_count_handlers");

const handle = createLoggedHandler(logger);

export function registerTokenCountHandlers() {
  handle(
    "chat:count-tokens",
    async (event, req: TokenCountParams): Promise<TokenCountResult> => {
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [
              asc(messages.createdAt),
              asc(messages.id),
            ],
          },
          app: true,
        },
      });

      if (!chat) {
        throw new DyadError(
          `Chat not found: ${req.chatId}`,
          DyadErrorKind.NotFound,
        );
      }

      // Prepare message history for token counting
      const messageHistory = chat.messages
        .map((message) => message.content)
        .join("");
      const messageHistoryTokens = estimateTokens(messageHistory);

      // Count input tokens
      const inputTokens = estimateTokens(req.input);

      const storedSettings = readSettings();
      const { mode: selectedChatMode } = await resolveChatModeForTurn({
        storedChatMode: chat.chatMode,
        settings: storedSettings,
      });
      // Count system prompt tokens
      const themePrompt = await getThemePromptById(chat.app?.themeId ?? null);
      const frameworkType = detectFrameworkType(getDyadAppPath(chat.app.path));
      let systemPrompt = constructSystemPrompt({
        aiRules: await readAiRules(getDyadAppPath(chat.app.path)),
        chatMode: selectedChatMode,
        readOnly: selectedChatMode === "ask",
        themePrompt,
        frameworkType,
        hasSupabaseProject: !!chat.app?.supabaseProjectId,
        testingEnabled: !!chat.app?.testingEnabled,
      });
      let supabaseContext = "";

      if (chat.app?.supabaseProjectId) {
        const supabaseClientCode = await getSupabaseClientCode({
          projectId: chat.app.supabaseProjectId,
          organizationSlug: chat.app.supabaseOrganizationSlug ?? null,
        });
        systemPrompt +=
          "\n\n" + getSupabaseAvailableSystemPrompt(supabaseClientCode);
        supabaseContext = await getSupabaseContext({
          supabaseProjectId: chat.app.supabaseProjectId,
          organizationSlug: chat.app.supabaseOrganizationSlug ?? null,
        });
      } else if (chat.app?.neonProjectId) {
        systemPrompt +=
          "\n\n" +
          (await buildNeonPromptForApp({
            appPath: chat.app.path,
            neonProjectId: chat.app.neonProjectId!,
            neonActiveBranchId: chat.app.neonActiveBranchId,
            neonDevelopmentBranchId: chat.app.neonDevelopmentBranchId,
            selectedChatMode,
          }));
      } else {
        // Neon projects don't need Supabase (already handled above).
        systemPrompt += "\n\n" + SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT;
      }

      const systemPromptTokens = estimateTokens(systemPrompt + supabaseContext);

      // Pi agents read app and referenced-app files through tools instead of
      // injecting complete codebases into each request.
      const codebaseTokens = 0;
      const mentionedAppsTokens = 0;

      // Calculate total tokens
      const totalTokens =
        messageHistoryTokens +
        inputTokens +
        systemPromptTokens +
        codebaseTokens +
        mentionedAppsTokens;

      // Find the last assistant message since totalTokens is only set on assistant messages
      const lastAssistantMessage = [...chat.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      const actualMaxTokens = lastAssistantMessage?.maxTokensUsed ?? null;

      return {
        estimatedTotalTokens: totalTokens,
        actualMaxTokens,
        messageHistoryTokens,
        codebaseTokens,
        mentionedAppsTokens,
        inputTokens,
        systemPromptTokens,
        contextWindow: await getContextWindow(),
      };
    },
  );
}
