/**
 * Joy Assistant Service
 *
 * Main-process singleton that orchestrates the AI assistant.
 * Handles intent classification, smart routing (local vs cloud),
 * tool-calling based actions, and session management.
 *
 * Capabilities mirror OpenClaw: system operations, file management,
 * shell commands, app launching, plus JoyCreate-specific navigation
 * and UI automation.
 *
 * Reuses:
 *  - SmartRouter for model selection
 *  - AI SDK (streamText + tool calling) for inference
 *  - Knowledge base for platform awareness
 *  - joy_assistant_tools for system-level operations
 */

import log from "electron-log";
import { streamText, tool, type TextStreamPart, type ToolSet } from "ai";
import { z } from "zod";
import { readSettings } from "../main/settings";
import { getModelClient } from "../ipc/utils/get_model_client";
import {
  buildSystemPrompt,
  findFeatures,
  getSuggestions as getKnowledgeSuggestions,
} from "./joy_assistant_knowledge";
import {
  runCommand,
  readFileContent,
  writeFileContent,
  listDirectory,
  openApp,
  openUrl,
  getSystemInfo,
  isCommandSafe,
} from "./joy_assistant_tools";
import type {
  AssistantIntent,
  AssistantAction,
  AssistantMessage,
  AssistantSession,
  AssistantMode,
  AssistantPageContext,
  AssistantSuggestion,
} from "@/types/joy_assistant_types";

const logger = log.scope("joy-assistant");

// ============================================================================
// Intent Classification
// ============================================================================

/** Keyword patterns for fast intent classification (no AI call needed). */
const INTENT_PATTERNS: { pattern: RegExp; intent: AssistantIntent }[] = [
  // Navigate
  { pattern: /\b(go to|navigate|open|show me|take me to|switch to)\b/i, intent: "navigate" },
  // Explain
  { pattern: /\b(how (do|can|to)|what (is|are|does)|explain|help me understand|tell me about|guide)\b/i, intent: "explain" },
  // Fill
  { pattern: /\b(fill|type|enter|put|set the|write in|input)\b.*(field|box|input|form)/i, intent: "fill" },
  // Create
  { pattern: /\b(create|make|build|generate|new|start a)\b.*(document|doc|spreadsheet|presentation|agent|workflow|app|report)/i, intent: "create" },
  // Search
  { pattern: /\b(search|find|look for|browse|discover|show me)\b.*(marketplace|asset|agent|workflow|model|plugin)/i, intent: "search" },
  // Configure
  { pattern: /\b(configure|set up|change|update|toggle|enable|disable)\b.*(setting|api key|theme|provider|model|preference)/i, intent: "configure" },
  // Analyze
  { pattern: /\b(analyze|show|review)\b.*(stats|analytics|earnings|downloads|performance|metrics)/i, intent: "analyze" },
  // System operations
  { pattern: /\b(run|execute|shell|terminal|command|cmd|powershell|bash)\b/i, intent: "system" },
  { pattern: /\b(read|write|list|delete|move|copy|rename)\b\s+(file|folder|directory|dir)/i, intent: "system" },
  { pattern: /\b(open|launch|start)\b\s+(app|program|application|notepad|calc|browser|explorer|vscode|code)\b/i, intent: "system" },
  { pattern: /\b(system|hardware|cpu|ram|memory|disk|process|network)\b\s*(info|status|usage|check)/i, intent: "system" },
  { pattern: /\b(what|how much|check)\b.*(free space|disk space|memory|cpu|ram|storage)/i, intent: "system" },
];

export function classifyIntent(
  message: string,
  _context: AssistantPageContext,
): AssistantIntent {
  const lower = message.toLowerCase().trim();

  for (const { pattern, intent } of INTENT_PATTERNS) {
    if (pattern.test(lower)) return intent;
  }

  // Check if the message references a known feature name → likely navigate or explain
  const features = findFeatures(lower, 1);
  if (
    features.length > 0 &&
    (lower.startsWith("go") || lower.startsWith("open") || lower.startsWith("show"))
  ) {
    return "navigate";
  }
  if (features.length > 0) return "explain";

  return "general";
}

// ============================================================================
// Action Planning (deterministic, no AI needed)
// ============================================================================

export function planActions(
  intent: AssistantIntent,
  message: string,
  context: AssistantPageContext,
): AssistantAction[] {
  const actions: AssistantAction[] = [];

  if (intent === "navigate") {
    const features = findFeatures(message, 1);
    if (features.length > 0) {
      actions.push({
        type: "navigate",
        route: features[0].route,
        label: `Go to ${features[0].name}`,
      });
    }
  }

  if (intent === "search") {
    // Extract search target and query
    const marketMatch = message.match(
      /(?:search|find|look for|browse)\s+(?:for\s+)?(?:a\s+)?(.+?)(?:\s+(?:on|in|from)\s+(?:the\s+)?marketplace)?$/i,
    );
    if (marketMatch) {
      actions.push({
        type: "search",
        target: "marketplace",
        query: marketMatch[1].trim(),
      });
    }
  }

  if (intent === "create") {
    const lower = message.toLowerCase();
    if (/spreadsheet|excel/i.test(lower)) {
      actions.push({ type: "create-document", documentType: "spreadsheet", name: "New Spreadsheet" });
    } else if (/presentation|slide|powerpoint/i.test(lower)) {
      actions.push({ type: "create-document", documentType: "presentation", name: "New Presentation" });
    } else if (/document|doc|report|letter|word/i.test(lower)) {
      actions.push({ type: "create-document", documentType: "document", name: "New Document" });
    } else if (/agent/i.test(lower)) {
      actions.push({ type: "navigate", route: "/agents", label: "Go to Agents" });
    } else if (/workflow/i.test(lower)) {
      actions.push({ type: "navigate", route: "/workflows", label: "Go to Workflows" });
    }
  }

  return actions;
}

// ============================================================================
// Session Management
// ============================================================================

const sessions = new Map<string, AssistantSession>();

export function getSession(sessionId: string): AssistantSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { id: sessionId, messages: [], mode: "auto", createdAt: Date.now() };
    sessions.set(sessionId, session);
  }
  return session;
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function setSessionMode(sessionId: string, mode: AssistantMode): void {
  const session = getSession(sessionId);
  session.mode = mode;
}

export function getSessionHistory(sessionId: string): AssistantMessage[] {
  return getSession(sessionId).messages;
}

// ============================================================================
// Main Chat Function (streaming)
// ============================================================================

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onActions: (actions: AssistantAction[]) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

/**
 * Stream a response from the assistant. Handles:
 * 1. Intent classification
 * 2. Smart router model selection (local-first)
 * 3. Streaming inference with tool calling
 * 4. Action planning (deterministic + AI-driven)
 * 5. Session history update
 */
export async function chat(
  sessionId: string,
  message: string,
  pageContext: AssistantPageContext,
  mode: AssistantMode,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<void> {
  const session = getSession(sessionId);
  if (mode !== session.mode) session.mode = mode;

  // 1. Classify intent
  const intent = classifyIntent(message, pageContext);
  logger.debug("Classified intent", { intent, message: message.slice(0, 80) });

  // 2. Plan deterministic actions (may be overridden/extended by AI)
  const plannedActions = planActions(intent, message, pageContext);

  // 3. Add user message to history
  const userMsg: AssistantMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: message,
    timestamp: Date.now(),
  };
  session.messages.push(userMsg);

  // 4. Build system prompt with knowledge context + system capabilities
  const knowledgePrompt = buildSystemPrompt(pageContext, mode);
  const systemPrompt = `${knowledgePrompt}\n\n${SYSTEM_TOOLS_PROMPT}`;

  // 5. Build conversation messages for the AI
  const aiMessages: { role: "user" | "assistant" | "system"; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  // Include last 20 messages for context
  const recentMessages = session.messages.slice(-20);
  for (const msg of recentMessages) {
    aiMessages.push({ role: msg.role, content: msg.content });
  }

  // 6. Resolve model — use the same model resolution as the main chat
  // 7. Stream response with tool calling
  let assistantContent = "";
  let allActions: AssistantAction[] = [...plannedActions];

  try {
    const settings = readSettings();
    const selectedModel = settings.selectedModel ?? { provider: "auto", name: "auto" };

    // Use the same getModelClient that powers the main chat
    const { modelClient } = await getModelClient(selectedModel, settings);
    const providerId = modelClient.builtinProviderId ?? selectedModel.provider;
    const modelId = selectedModel.name ?? "unknown";
    const isLocal = providerId === "ollama" || providerId === "lmstudio";

    logger.info("Joy assistant using model", { providerId, modelId, isLocal });

    // Build AI SDK tools for the assistant
    const assistantTools = buildAssistantTools(intent);

    // Stream the response
    const stream = streamText({
      model: modelClient.model,
      messages: aiMessages as any,
      tools: assistantTools,
      maxSteps: 5,
      maxRetries: 1,
      abortSignal,
    });

    for await (const part of stream.fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
      if (abortSignal?.aborted) break;
      if (part.type === "text-delta") {
        assistantContent += part.text;
        callbacks.onDelta(part.text);
      } else if (part.type === "tool-result") {
        const toolAction = toolResultToAction(part.toolName, part.input as Record<string, unknown>, part.output);
        if (toolAction) {
          allActions.push(toolAction);
        }
      }
    }

    // Send actions to renderer
    if (allActions.length > 0) {
      callbacks.onActions(allActions);
    }

    // Clean the response content (remove <actions> tags from displayed text)
    const cleanContent = assistantContent
      .replace(/<actions>[\s\S]*?<\/actions>/g, "")
      .trim();

    // Parse any inline actions from model output (fallback for models without tool calling)
    const inlineActions = parseActionsFromResponse(assistantContent);
    if (inlineActions.length > 0) {
      allActions.push(...inlineActions);
      callbacks.onActions(inlineActions);
    }

    // Save assistant message to session
    const assistantMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: cleanContent,
      actions: allActions.length > 0 ? allActions : undefined,
      intent,
      timestamp: Date.now(),
      routingInfo: {
        providerId,
        modelId,
        isLocal,
      },
    };
    session.messages.push(assistantMsg);

    callbacks.onEnd();
  } catch (err) {
    if ((err as any)?.name === "AbortError") {
      logger.debug("Joy assistant stream aborted", sessionId);
      return;
    }
    logger.error("Joy assistant stream error", err);
    callbacks.onError(err instanceof Error ? err.message : String(err));
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Parse <actions>[...]</actions> blocks from AI response */
function parseActionsFromResponse(content: string): AssistantAction[] {
  const match = content.match(/<actions>([\s\S]*?)<\/actions>/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    return [];
  }
}

// ============================================================================
// AI SDK Tool Definitions
// ============================================================================

const SYSTEM_TOOLS_PROMPT = `
## System-Level Tools

You have full access to the user's operating system through these tools. Use them proactively when the user's request involves files, commands, system info, or applications.

### Available Tools
- **run_command** — Execute any shell command (PowerShell on Windows, bash on Linux/macOS). Use for installs, builds, git, file operations, etc.
- **read_file** — Read file contents. Show relevant sections to the user.
- **write_file** — Write or create files. Always preview what you'll write.
- **list_directory** — List files/folders in a directory.
- **open_app** — Launch any app (notepad, vscode, calculator, browser, explorer, etc.)
- **open_url** — Open a URL in the default browser.
- **system_info** — Get real-time system data: os, hardware, processes, disk, memory, network.
- **navigate** — Navigate to any JoyCreate page.
- **search_marketplace** — Search the JoyCreate marketplace for assets.
- **create_document** — Create documents, spreadsheets, or presentations.

### Tool Usage Guidelines
- For safe read-only operations (listing files, reading, system info), just do it — no need to ask.
- For potentially destructive commands (rm, del, format, drop), explain the impact first.
- Chain multiple tool calls when needed for complex tasks (e.g., read file → modify → write back).
- Show file contents and command outputs in code blocks.
- When asked about the system, always use the system_info tool for accurate real-time data.
`;

function buildAssistantTools(intent: AssistantIntent) {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  // Always provide navigation tools
  tools.navigate = tool({
    description: "Navigate to a page within JoyCreate",
    parameters: z.object({
      route: z.string().describe("The route path, e.g. /marketplace, /settings, /agents"),
      label: z.string().describe("Brief description of the navigation"),
    }),
    execute: async ({ route, label }) => {
      return { type: "navigate", route, label, executed: true };
    },
  });

  // System tools — available for all intents, but especially "system"
  tools.run_command = tool({
    description: "Execute a shell command on the user's system. Use PowerShell on Windows, bash on Linux/macOS.",
    parameters: z.object({
      command: z.string().describe("The shell command to execute"),
      cwd: z.string().optional().describe("Working directory (defaults to user home)"),
    }),
    execute: async ({ command, cwd }) => {
      const safety = isCommandSafe(command);
      if (!safety.safe) {
        return { error: safety.reason, executed: false };
      }
      const result = await runCommand(command, cwd);
      return { ...result, executed: true };
    },
  });

  tools.read_file = tool({
    description: "Read the contents of a file on the user's system",
    parameters: z.object({
      filePath: z.string().describe("Absolute path to the file to read"),
    }),
    execute: async ({ filePath }) => {
      const content = await readFileContent(filePath);
      return { content: content.slice(0, 20_000), executed: true };
    },
  });

  tools.write_file = tool({
    description: "Write content to a file on the user's system",
    parameters: z.object({
      filePath: z.string().describe("Absolute path for the file"),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async ({ filePath, content }) => {
      await writeFileContent(filePath, content);
      return { filePath, size: content.length, executed: true };
    },
  });

  tools.list_directory = tool({
    description: "List files and directories in a directory",
    parameters: z.object({
      dirPath: z.string().describe("Absolute path to the directory"),
    }),
    execute: async ({ dirPath }) => {
      const entries = await listDirectory(dirPath);
      return { entries, executed: true };
    },
  });

  tools.open_app = tool({
    description: "Open an application on the user's system (e.g. notepad, calculator, vscode, file explorer)",
    parameters: z.object({
      appName: z.string().describe("Application name or path"),
      args: z.array(z.string()).optional().describe("Arguments to pass to the app"),
    }),
    execute: async ({ appName, args }) => {
      await openApp(appName, args);
      return { opened: appName, executed: true };
    },
  });

  tools.open_url = tool({
    description: "Open a URL in the user's default browser",
    parameters: z.object({
      url: z.string().describe("The URL to open"),
    }),
    execute: async ({ url }) => {
      await openUrl(url);
      return { opened: url, executed: true };
    },
  });

  tools.system_info = tool({
    description: "Get system information: os, hardware, processes, disk, memory, or network",
    parameters: z.object({
      infoType: z.enum(["os", "hardware", "processes", "disk", "memory", "network"])
        .describe("Type of system information to retrieve"),
    }),
    execute: async ({ infoType }) => {
      const info = await getSystemInfo(infoType);
      return { info, executed: true };
    },
  });

  tools.search_marketplace = tool({
    description: "Search the JoyCreate marketplace for agents, workflows, models, or assets",
    parameters: z.object({
      query: z.string().describe("Search query"),
      category: z.enum(["agents", "workflows", "models", "assets", "all"]).optional(),
    }),
    execute: async ({ query, category }) => {
      return { type: "search", target: category || "marketplace", query, executed: true };
    },
  });

  tools.create_document = tool({
    description: "Create a new document, spreadsheet, or presentation",
    parameters: z.object({
      documentType: z.enum(["document", "spreadsheet", "presentation"]),
      name: z.string().describe("Name for the new document"),
    }),
    execute: async ({ documentType, name }) => {
      return { type: "create-document", documentType, name, executed: true };
    },
  });

  return tools;
}

/**
 * Convert a tool result into an AssistantAction for the renderer.
 */
function toolResultToAction(
  toolName: string,
  args: Record<string, unknown>,
  _result: unknown,
): AssistantAction | null {
  switch (toolName) {
    case "navigate":
      return {
        type: "navigate",
        route: args.route as string,
        label: (args.label as string) || `Go to ${args.route}`,
      };
    case "run_command":
      return {
        type: "run-command",
        command: args.command as string,
        cwd: args.cwd as string | undefined,
        label: `Run: ${(args.command as string).slice(0, 60)}`,
      };
    case "read_file":
      return {
        type: "read-file",
        filePath: args.filePath as string,
        label: `Read: ${args.filePath}`,
      };
    case "write_file":
      return {
        type: "write-file",
        filePath: args.filePath as string,
        content: args.content as string,
        label: `Write: ${args.filePath}`,
      };
    case "list_directory":
      return {
        type: "list-directory",
        dirPath: args.dirPath as string,
        label: `List: ${args.dirPath}`,
      };
    case "open_app":
      return {
        type: "open-app",
        appName: args.appName as string,
        args: args.args as string[] | undefined,
        label: `Open: ${args.appName}`,
      };
    case "open_url":
      return {
        type: "open-url",
        url: args.url as string,
        label: `Open: ${args.url}`,
      };
    case "system_info":
      return {
        type: "system-info",
        infoType: args.infoType as "os" | "hardware" | "processes" | "disk" | "memory" | "network",
        label: `System info: ${args.infoType}`,
      };
    case "search_marketplace":
      return {
        type: "search",
        target: (args.category as string) || "marketplace",
        query: args.query as string,
      };
    case "create_document":
      return {
        type: "create-document",
        documentType: args.documentType as "document" | "spreadsheet" | "presentation",
        name: args.name as string,
      };
    default:
      return null;
  }
}

/** Get suggestions for the current page context. */
export function getPageSuggestions(
  pageContext: AssistantPageContext,
): AssistantSuggestion[] {
  return getKnowledgeSuggestions(pageContext);
}
