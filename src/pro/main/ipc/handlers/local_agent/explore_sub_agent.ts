/**
 * Explore Sub-Agent
 *
 * A lightweight agent that uses a cheaper/faster model (e.g., Gemini 3 Flash)
 * to gather codebase context before the main agent starts processing.
 * This is particularly useful at the beginning of a chat conversation to
 * understand the codebase structure and find relevant files.
 */

import { IpcMainInvokeEvent } from "electron";
import {
  streamText,
  ToolSet,
  stepCountIs,
  type ToolExecutionOptions,
} from "ai";
import log from "electron-log";

import type { UserSettings, LargeLanguageModel } from "@/lib/schemas";
import { isDyadProEnabled } from "@/lib/schemas";
import { getModelClient, type ModelClient } from "@/ipc/utils/get_model_client";
import { getEnvVar } from "@/ipc/utils/read_env";
import { getProviderOptions, getAiHeaders } from "@/ipc/utils/provider_options";
import { GEMINI_3_FLASH } from "@/ipc/shared/language_model_constants";

import { readFileTool } from "./tools/read_file";
import { listFilesTool } from "./tools/list_files";
import { grepTool } from "./tools/grep";
import { codeSearchTool } from "./tools/code_search";
import type { AgentContext, ToolDefinition } from "./tools/types";

const logger = log.scope("explore_sub_agent");

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of tool call steps the explore agent can take */
const MAX_EXPLORE_STEPS = 10;

/** Maximum output tokens for the explore agent's response */
const MAX_EXPLORE_OUTPUT_TOKENS = 8192;

/** Read-only tools available to the explore agent */
const EXPLORE_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  listFilesTool,
  grepTool,
  readFileTool,
  codeSearchTool,
];

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration assistant. Your role is to quickly gather relevant context from the user's codebase to help understand and answer their question or task.

## Instructions

1. **Understand the request**: Read the user's prompt carefully to understand what they need.
2. **Explore the codebase**: Use the available tools to find relevant files and code.
3. **Be efficient**: Gather the minimum context needed. Don't read every file.
4. **Focus on relevance**: Only read files that are directly relevant to the user's question.
5. **Summarize findings**: After exploring, provide a brief summary of what you found.

## Strategy

- Start with \`list_files\` to understand the project structure.
- Use \`grep\` to search for specific patterns, keywords, or function names related to the user's question.
- Use \`read_file\` to read the most relevant files you discover.
- If available, use \`code_search\` for semantic code search.

## Important

- You are ONLY gathering context. Do NOT try to solve the problem or write code.
- Keep your response concise - focus on summarizing the relevant architecture and code you found.
- You can call multiple tools at once when they are independent.
`;

// ============================================================================
// Types
// ============================================================================

export interface ExploreResult {
  /** The context summary gathered by the explore agent */
  contextSummary: string;
  /**
   * The XML output from tool calls that was streamed to the UI.
   * This uses standard dyad tags (dyad-grep, dyad-read, etc.) so they
   * render normally in the chat, with a dyad-status header.
   */
  xmlOutput: string;
}

export interface ExploreSubAgentParams {
  appPath: string;
  chatId: number;
  appId: number;
  userPrompt: string;
  event: IpcMainInvokeEvent;
  abortController: AbortController;
  placeholderMessageId: number;
  settings: UserSettings;
  dyadRequestId: string;
  /**
   * Callback to update the UI with the explore agent's progress.
   * Called with the accumulated full response text.
   */
  onProgress: (fullResponse: string) => Promise<void>;
}

// ============================================================================
// Model Selection
// ============================================================================

/**
 * Get a cheap/fast model client for the explore sub-agent.
 *
 * Priority:
 * 1. Pro users: Use the "value" tier through the Dyad engine
 * 2. Non-Pro with Google API key: Use Gemini 3 Flash (cheapest)
 * 3. Fallback: Use the user's selected model
 */
async function getExploreModelClient(settings: UserSettings): Promise<{
  modelClient: ModelClient;
  exploreModel: LargeLanguageModel;
}> {
  // For Pro users, use the "value" tier through the engine
  if (isDyadProEnabled(settings)) {
    const exploreModel: LargeLanguageModel = {
      provider: "auto",
      name: "value",
    };
    const { modelClient } = await getModelClient(exploreModel, settings);
    return { modelClient, exploreModel };
  }

  // For non-Pro users, try cheaper models first
  const googleKey =
    settings.providerSettings?.google?.apiKey?.value ||
    getEnvVar("GEMINI_API_KEY");

  if (googleKey) {
    const exploreModel: LargeLanguageModel = {
      provider: "google",
      name: GEMINI_3_FLASH,
    };
    const { modelClient } = await getModelClient(exploreModel, settings);
    return { modelClient, exploreModel };
  }

  // Fallback to the user's selected model
  const { modelClient } = await getModelClient(
    settings.selectedModel,
    settings,
  );
  return { modelClient, exploreModel: settings.selectedModel };
}

// ============================================================================
// Tool Set Builder
// ============================================================================

/**
 * Build a limited tool set for the explore sub-agent.
 * Only includes read-only tools suitable for codebase exploration.
 */
function buildExploreToolSet(ctx: AgentContext): ToolSet {
  const toolSet: Record<string, any> = {};

  for (const tool of EXPLORE_TOOL_DEFINITIONS) {
    // Skip tools that aren't enabled in this context
    if (tool.isEnabled && !tool.isEnabled(ctx)) {
      continue;
    }

    toolSet[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args: any, _execCtx: ToolExecutionOptions) => {
        const result = await tool.execute(args, ctx);
        // Tool results are strings (ToolResult type)
        return typeof result === "string"
          ? { type: "text" as const, value: result }
          : result;
      },
    };
  }

  return toolSet;
}

// ============================================================================
// Explore Sub-Agent
// ============================================================================

/**
 * Determines whether the explore sub-agent should run for this chat.
 *
 * Conditions:
 * - The setting is enabled
 * - It's the first user message in the chat (exploration is most useful at the start)
 */
export function shouldRunExploreAgent({
  settings,
  messageCount,
}: {
  settings: UserSettings;
  /** Total number of messages in the chat (including the just-inserted user + placeholder) */
  messageCount: number;
}): boolean {
  // Setting must be explicitly enabled
  if (!settings.enableExploreSubAgent) {
    return false;
  }

  // Only run on the first turn (2 messages = 1 user + 1 placeholder assistant)
  if (messageCount > 2) {
    return false;
  }

  return true;
}

/**
 * Run the explore sub-agent to gather codebase context.
 *
 * This agent uses a cheaper/faster model to:
 * 1. List project files to understand structure
 * 2. Search for relevant code patterns
 * 3. Read key files
 * 4. Return a context summary for the main agent
 *
 * Tool calls (list_files, grep, read_file, code_search) are rendered in the UI
 * using the standard dyad tags so they appear naturally in the chat message.
 * A <dyad-status> tag provides a visual header for the explore phase.
 */
export async function runExploreSubAgent(
  params: ExploreSubAgentParams,
): Promise<ExploreResult> {
  const {
    appPath,
    chatId,
    appId,
    userPrompt,
    event,
    abortController,
    settings,
    dyadRequestId,
    onProgress,
  } = params;

  logger.log(`Starting explore sub-agent for chat ${chatId}`);

  // Get a cheap model for exploration
  const { modelClient, exploreModel } = await getExploreModelClient(settings);
  logger.log(
    `Using explore model: ${exploreModel.provider}/${exploreModel.name}`,
  );

  // Start with a status tag to indicate the explore phase
  const statusHeader = `<dyad-status title="Exploring codebase">Gathering context with ${exploreModel.name}...</dyad-status>\n`;
  let xmlOutput = statusHeader;
  let exploreTextOutput = "";

  // Send the initial status header
  await onProgress(xmlOutput);

  // Build a lightweight agent context for tool execution
  const ctx: AgentContext = {
    event,
    appId,
    appPath,
    chatId,
    supabaseProjectId: null, // Not needed for exploration
    supabaseOrganizationSlug: null,
    messageId: params.placeholderMessageId,
    isSharedModulesChanged: false,
    todos: [],
    dyadRequestId,
    fileEditTracker: Object.create(null),
    isDyadPro: false, // Not needed for exploration (uses cheap model)
    onXmlStream: (accumulatedXml: string) => {
      // Stream tool output — tool calls use standard dyad tags
      // so they render normally in the chat UI
      void onProgress(xmlOutput + accumulatedXml);
    },
    onXmlComplete: (finalXml: string) => {
      xmlOutput += finalXml + "\n";
      void onProgress(xmlOutput);
    },
    requireConsent: async () => {
      // Explore tools are all read-only, auto-approve
      return true;
    },
    appendUserMessage: () => {
      // Not used in explore mode
    },
    onUpdateTodos: () => {
      // Not used in explore mode
    },
  };

  // Build limited tool set
  const tools = buildExploreToolSet(ctx);

  try {
    // Stream the explore agent
    const streamResult = streamText({
      model: modelClient.model,
      headers: getAiHeaders({
        builtinProviderId: modelClient.builtinProviderId,
      }),
      providerOptions: getProviderOptions({
        dyadAppId: appId,
        dyadRequestId: `explore-${dyadRequestId}`,
        dyadDisableFiles: true, // Tools handle file access
        files: [],
        mentionedAppsCodebases: [],
        builtinProviderId: modelClient.builtinProviderId,
        settings,
      }),
      maxOutputTokens: MAX_EXPLORE_OUTPUT_TOKENS,
      temperature: 0,
      maxRetries: 1,
      system: EXPLORE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
      tools,
      stopWhen: [stepCountIs(MAX_EXPLORE_STEPS)],
      abortSignal: abortController.signal,
      onError: (error: any) => {
        const errorMessage = error?.error?.message || JSON.stringify(error);
        logger.error("Explore sub-agent error:", errorMessage);
      },
    });

    // Process the stream
    for await (const part of streamResult.fullStream) {
      if (abortController.signal.aborted) {
        logger.log(`Explore sub-agent aborted for chat ${chatId}`);
        break;
      }

      if (part.type === "text-delta") {
        exploreTextOutput += part.text;
      }
      // Tool calls and results are handled by the execute callbacks
      // which update xmlOutput via ctx.onXmlComplete
    }

    // Build the final context summary
    const contextSummary = buildContextSummary(exploreTextOutput);

    logger.log(
      `Explore sub-agent completed for chat ${chatId}. ` +
        `Summary length: ${contextSummary.length} chars`,
    );

    return {
      contextSummary,
      xmlOutput,
    };
  } catch (error) {
    if (abortController.signal.aborted) {
      logger.log(`Explore sub-agent cancelled for chat ${chatId}`);
      return {
        contextSummary: "",
        xmlOutput,
      };
    }

    logger.error(`Explore sub-agent failed for chat ${chatId}:`, error);
    // Don't throw - the main agent can still work without explore context
    return {
      contextSummary: "",
      xmlOutput: "",
    };
  }
}

/**
 * Format the explore agent's text output into a context summary
 * that can be injected into the main agent's system prompt.
 */
function buildContextSummary(exploreText: string): string {
  if (!exploreText.trim()) {
    return "";
  }

  return `## Codebase Context (gathered by exploration)

The following context was gathered by an exploration agent that analyzed the codebase:

${exploreText.trim()}

Use this context to inform your response. You can read additional files if needed.`;
}
