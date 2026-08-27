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
import {
  normalizeModelSelection,
  resolveDefaultModelSelection,
} from "@/ipc/utils/model_effort";
import { extractMentionedAppsCodebasesFromPrompt } from "../utils/mention_apps";
import {
  isDyadProEnabled,
  isBasicAgentMode,
  isLocalAgentBackedMode,
  isTurboEditsV2Enabled,
} from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveChatModeForTurn } from "./chat_mode_resolution";
import { isImplementerSubagentEnabled } from "@/lib/autoSidekick";
import { estimateAgentToolTokens } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import { buildChatMessageHistory } from "@/pro/main/ipc/handlers/local_agent/local_agent_handler";
import { collectMcpToolDefs } from "@/pro/main/ipc/handlers/local_agent/tools/mcp_type_defs";

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

      // Count input tokens
      const inputTokens = estimateTokens(req.input);

      const storedSettings = readSettings();
      const selectedModel = chat.modelSelection
        ? await normalizeModelSelection(chat.modelSelection)
        : await resolveDefaultModelSelection(storedSettings);
      const { mode: selectedChatMode } = await resolveChatModeForTurn({
        storedChatMode: chat.chatMode,
        settings: { ...storedSettings, selectedModel },
      });
      const settings = {
        ...storedSettings,
        selectedModel,
        selectedChatMode,
      };
      const willUseLocalAgentStream = isLocalAgentBackedMode(selectedChatMode);
      const messageHistoryTokens = willUseLocalAgentStream
        ? estimateTokens(JSON.stringify(buildChatMessageHistory(chat.messages)))
        : estimateTokens(
            chat.messages.map((message) => message.content).join(""),
          );

      // Count system prompt tokens
      // Migration on read converts "agent" to "build", so no need to check for it here
      const themePrompt = await getThemePromptById(chat.app?.themeId ?? null);
      const frameworkType = detectFrameworkType(getDyadAppPath(chat.app.path));
      const enableAppBlueprint =
        settings.enableAppBlueprint === true && chat.app.needsAppBlueprint;
      let systemPrompt = constructSystemPrompt({
        aiRules: await readAiRules(getDyadAppPath(chat.app.path)),
        chatMode: selectedChatMode === "ask" ? "local-agent" : selectedChatMode,
        enableTurboEditsV2: isTurboEditsV2Enabled(settings),
        themePrompt,
        readOnly: selectedChatMode === "ask",
        frameworkType,
        hasSupabaseProject: !!chat.app?.supabaseProjectId,
        implementerAvailable:
          selectedChatMode === "local-agent" &&
          isDyadProEnabled(settings) &&
          isImplementerSubagentEnabled(settings),
        testingEnabled: !!chat.app?.testingEnabled,
        enableAppBlueprint,
      });
      let supabaseContext = "";

      if (chat.app?.supabaseProjectId) {
        const supabaseClientCode = await getSupabaseClientCode({
          projectId: chat.app.supabaseProjectId,
          organizationSlug: chat.app.supabaseOrganizationSlug ?? null,
        });
        systemPrompt +=
          "\n\n" + getSupabaseAvailableSystemPrompt(supabaseClientCode);
        if (!willUseLocalAgentStream) {
          supabaseContext = await getSupabaseContext({
            supabaseProjectId: chat.app.supabaseProjectId,
            organizationSlug: chat.app.supabaseOrganizationSlug ?? null,
          });
        }
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
      } else if (!willUseLocalAgentStream) {
        // Neon projects don't need Supabase (already handled above).
        systemPrompt += "\n\n" + SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT;
      }

      const isDyadPro = isDyadProEnabled(settings);
      const mcpToolDefs =
        selectedChatMode === "local-agent" ? await collectMcpToolDefs() : [];
      const toolDefinitionTokens = await estimateAgentToolTokens({
        toolProfile: selectedChatMode === "build" ? "build" : "agent",
        readOnly: selectedChatMode === "ask",
        planModeOnly: selectedChatMode === "plan",
        basicAgentMode:
          selectedChatMode === "local-agent" && isBasicAgentMode(settings),
        enableAppBlueprint,
        isDyadPro,
        frameworkType,
        supabaseProjectId: chat.app.supabaseProjectId,
        neonProjectId: chat.app.neonProjectId,
        neonActiveBranchId:
          chat.app.neonActiveBranchId ?? chat.app.neonDevelopmentBranchId,
        testingEnabled: !!chat.app.testingEnabled,
        canUseExplorerSubagent:
          selectedChatMode !== "build" &&
          isDyadPro &&
          settings.enableExplorerSubagent !== false,
        canUseImplementerSubagent:
          selectedChatMode === "local-agent" &&
          isDyadPro &&
          isImplementerSubagentEnabled(settings),
        mcpToolDefs,
        canUseAdvancedSubagentTools:
          selectedChatMode === "local-agent" &&
          isDyadPro &&
          settings.enableAdvancedSubagents === true,
      });
      const systemPromptTokens =
        estimateTokens(systemPrompt + supabaseContext) + toolDefinitionTokens;

      // Tool-backed modes inspect the current app on demand, so they do not
      // inject the full codebase into the initial request.
      const codebaseTokens = 0;

      // Tool-backed modes reach referenced apps via tool calls rather than
      // injecting full codebases into the prompt, so mentioned apps contribute
      // ~0 tokens upfront. Match the extraction behavior in chat_stream_handlers
      // so the UI estimate tracks what's actually sent.
      let mentionedAppsTokens = 0;
      if (!willUseLocalAgentStream) {
        const mentionedAppsCodebases =
          await extractMentionedAppsCodebasesFromPrompt(
            req.input,
            chat.app?.id, // Exclude current app
          );

        if (mentionedAppsCodebases.length > 0) {
          const mentionedAppsContent = mentionedAppsCodebases
            .map(
              ({ appName, codebaseInfo }) =>
                `\n\n=== Referenced App: ${appName} ===\n${codebaseInfo}`,
            )
            .join("");

          mentionedAppsTokens = estimateTokens(mentionedAppsContent);

          logger.debug(
            `Extracted ${mentionedAppsCodebases.length} mentioned app codebases, tokens: ${mentionedAppsTokens}`,
          );
        }
      }

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
        contextWindow: await getContextWindow(selectedModel),
      };
    },
  );
}
