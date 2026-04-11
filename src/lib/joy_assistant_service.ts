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
import { getModelClient, type ModelClient } from "../ipc/utils/get_model_client";
import { recordAICost } from "../ipc/utils/cost_tracking";
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
import { createOllamaProvider } from "../ipc/utils/ollama_provider";
import { getOllamaApiUrl } from "../ipc/handlers/local_model_ollama_handler";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { LM_STUDIO_BASE_URL } from "../ipc/utils/lm_studio_utils";
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
  // Create — neural network (must come before generic "create" to win priority)
  { pattern: /\b(create|make|build|train|design|generate)\b.*(neural|network|model|cnn|rnn|lstm|transformer|classifier|detector)/i, intent: "create" },
  { pattern: /\b(neural|deep learning|machine learning|ml model|nn|conv2d|dense layer|automl)\b/i, intent: "create" },
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
    if (/neural|network|model|cnn|rnn|lstm|transformer|classifier|detector|deep learning|machine learning|ml model|conv2d|dense layer|automl/i.test(lower)) {
      actions.push({ type: "navigate", route: "/neural-builder", label: "Open Neural Builder" });
    } else if (/spreadsheet|excel/i.test(lower)) {
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

// ============================================================================
// Local-First Model Resolution
// ============================================================================

interface LocalProbeResult {
  modelClient: ModelClient;
  providerId: string;
  modelId: string;
}

/** Probe Ollama for available models and return the first one ready. */
async function probeOllama(): Promise<LocalProbeResult | null> {
  try {
    const baseUrl = getOllamaApiUrl();
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { models?: { name: string }[] };
    const models = data.models ?? [];
    if (models.length === 0) return null;

    // Pick the first available model
    const modelName = models[0].name;
    const provider = createOllamaProvider({ baseURL: baseUrl });
    logger.info(`Local-first: Ollama available with model "${modelName}"`);
    return {
      modelClient: { model: provider(modelName), builtinProviderId: "ollama" },
      providerId: "ollama",
      modelId: modelName,
    };
  } catch {
    return null;
  }
}

/** Probe LM Studio for availability and return the default model. */
async function probeLMStudio(): Promise<LocalProbeResult | null> {
  try {
    const baseUrl = LM_STUDIO_BASE_URL;
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { data?: { id: string }[] };
    const models = data.data ?? [];
    if (models.length === 0) return null;

    const modelName = models[0].id;
    const provider = createOpenAICompatible({
      name: "lmstudio",
      baseURL: `${baseUrl}/v1`,
    });
    logger.info(`Local-first: LM Studio available with model "${modelName}"`);
    return {
      modelClient: { model: provider(modelName), builtinProviderId: "lmstudio" },
      providerId: "lmstudio",
      modelId: modelName,
    };
  } catch {
    return null;
  }
}

/** Try local providers (Ollama, then LM Studio). Returns null if none available. */
async function tryGetLocalModelClient(): Promise<LocalProbeResult | null> {
  // Try Ollama first (most common local provider)
  const ollama = await probeOllama();
  if (ollama) return ollama;

  // Fall back to LM Studio
  const lmStudio = await probeLMStudio();
  if (lmStudio) return lmStudio;

  return null;
}

/**
 * Stream a response from the assistant. Handles:
 * 1. Intent classification
 * 2. Smart router model selection (local-first, cloud fallback)
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

  // 6. Resolve model — local-first, then fall back to configured provider
  // 7. Stream response with tool calling
  let assistantContent = "";
  let allActions: AssistantAction[] = [...plannedActions];

  try {
    const settings = readSettings();

    // Local-first: probe Ollama / LM Studio before falling back to cloud
    let modelClient: ModelClient;
    let providerId: string;
    let modelId: string;
    let isLocal: boolean;

    const localResult = await tryGetLocalModelClient();
    if (localResult) {
      modelClient = localResult.modelClient;
      providerId = localResult.providerId;
      modelId = localResult.modelId;
      isLocal = true;
      logger.info("Joy assistant using LOCAL model", { providerId, modelId });
    } else {
      // No local model available — fall back to cloud/auto routing
      const selectedModel = settings.selectedModel ?? { provider: "auto", name: "auto" };
      const resolved = await getModelClient(selectedModel, settings);
      modelClient = resolved.modelClient;
      providerId = modelClient.builtinProviderId ?? selectedModel.provider;
      modelId = selectedModel.name ?? "unknown";
      isLocal = false;
      logger.info("Joy assistant falling back to CLOUD model", { providerId, modelId });
    }

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

    // Record cost with the smart cost engine
    try {
      const usage = await stream.usage;
      if (usage) {
        recordAICost({
          model: modelId,
          provider: providerId ?? "unknown",
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          taskType: "assistant",
          source: "chat-stream",
        });
      }
    } catch { /* best-effort */ }

    // Send actions to renderer
    if (allActions.length > 0) {
      callbacks.onActions(allActions);
    }

    // ── Raw tool-call fallback for local models ──
    // Local models may emit JSON tool calls as text instead of using
    // the AI SDK's structured tool-calling protocol. Detect, execute,
    // and stream back real results.
    const rawCalls = parseRawToolCalls(assistantContent);
    if (rawCalls.length > 0) {
      logger.info(`Detected ${rawCalls.length} raw tool call(s) in text output — executing`);
      for (const rawCall of rawCalls) {
        try {
          const { result, action } = await executeRawToolCall(rawCall);
          if (result != null) {
            // Stream the real result back to the user
            const resultText = `\n\n${formatToolResult(rawCall.name, result)}`;
            callbacks.onDelta(resultText);
            assistantContent += resultText;
          }
          if (action) {
            allActions.push(action);
          }
        } catch (toolErr) {
          logger.warn(`Raw tool call "${rawCall.name}" failed:`, toolErr);
          const errText = `\n\n> Tool "${rawCall.name}" failed: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`;
          callbacks.onDelta(errText);
          assistantContent += errText;
        }
      }
      if (allActions.length > 0) {
        callbacks.onActions(allActions);
      }
    }

    // Clean the response content (remove <actions> tags and raw tool-call JSON)
    let cleanContent = assistantContent
      .replace(/<actions>[\s\S]*?<\/actions>/g, "")
      .trim();
    if (rawCalls.length > 0) {
      cleanContent = stripRawToolCalls(cleanContent);
    }

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
// Raw Tool-Call Fallback (for local models without native tool calling)
// ============================================================================

interface RawToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

/**
 * Local models often emit raw JSON tool calls as text instead of using the
 * structured tool-calling protocol. This parses all such patterns:
 *
 *   {"name": "system_info", "parameters": {"infoType": "os"}}
 *   {"name": "run_command", "parameters": {"command": "dir"}}
 *
 * Also handles markdown-fenced JSON blocks and `arguments` as alias.
 */
function parseRawToolCalls(text: string): RawToolCall[] {
  const calls: RawToolCall[] = [];
  // Match JSON objects containing "name" and "parameters" or "arguments"
  const pattern = /\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*(?:"parameters"|"arguments")\s*:\s*(\{[^{}]*\})[^{}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    try {
      const name = match[1];
      const params = JSON.parse(match[2]);
      if (name && typeof params === "object") {
        calls.push({ name, parameters: params });
      }
    } catch {
      // Malformed JSON — skip
    }
  }
  return calls;
}

/**
 * Execute a parsed raw tool call using the real tool implementations.
 * Returns the tool output or null if the tool name is unknown.
 */
async function executeRawToolCall(
  call: RawToolCall,
): Promise<{ result: unknown; action: AssistantAction | null }> {
  const { name, parameters: p } = call;

  switch (name) {
    case "system_info": {
      const infoType = (p.infoType as string) || "os";
      const validTypes = ["os", "hardware", "processes", "disk", "memory", "network"] as const;
      const safeType = validTypes.includes(infoType as any) ? (infoType as typeof validTypes[number]) : "os";
      const info = await getSystemInfo(safeType);
      return {
        result: info,
        action: { type: "system-info", infoType: safeType, label: `System info: ${safeType}` },
      };
    }
    case "run_command": {
      const command = p.command as string;
      if (!command) return { result: { error: "No command provided" }, action: null };
      const safety = isCommandSafe(command);
      if (!safety.safe) return { result: { error: safety.reason }, action: null };
      const result = await runCommand(command, p.cwd as string | undefined);
      return {
        result,
        action: { type: "run-command", command, cwd: p.cwd as string | undefined, label: `Run: ${command.slice(0, 60)}` },
      };
    }
    case "read_file": {
      const filePath = p.filePath as string;
      if (!filePath) return { result: { error: "No filePath provided" }, action: null };
      const content = await readFileContent(filePath);
      return {
        result: { content: content.slice(0, 20_000) },
        action: { type: "read-file", filePath, label: `Read: ${filePath}` },
      };
    }
    case "write_file": {
      const filePath = p.filePath as string;
      const content = p.content as string;
      if (!filePath || content == null) return { result: { error: "Missing filePath or content" }, action: null };
      await writeFileContent(filePath, content);
      return {
        result: { filePath, size: content.length },
        action: { type: "write-file", filePath, content, label: `Write: ${filePath}` },
      };
    }
    case "list_directory": {
      const dirPath = (p.dirPath ?? p.path ?? p.directory) as string;
      if (!dirPath) return { result: { error: "No dirPath provided" }, action: null };
      const entries = await listDirectory(dirPath);
      return {
        result: { entries },
        action: { type: "list-directory", dirPath, label: `List: ${dirPath}` },
      };
    }
    case "open_app": {
      const appName = p.appName as string;
      if (!appName) return { result: { error: "No appName provided" }, action: null };
      await openApp(appName, p.args as string[] | undefined);
      return {
        result: { opened: appName },
        action: { type: "open-app", appName, label: `Open: ${appName}` },
      };
    }
    case "open_url": {
      const url = p.url as string;
      if (!url) return { result: { error: "No url provided" }, action: null };
      await openUrl(url);
      return {
        result: { opened: url },
        action: { type: "open-url", url, label: `Open: ${url}` },
      };
    }
    case "navigate": {
      const route = p.route as string;
      return {
        result: { navigated: route },
        action: { type: "navigate", route: route || "/", label: (p.label as string) || `Go to ${route}` },
      };
    }
    default:
      logger.warn(`Unknown raw tool call: ${name}`);
      return { result: null, action: null };
  }
}

/**
 * Strip raw JSON tool calls from displayed text so the user
 * sees the actual results instead of the raw function-call JSON.
 */
function stripRawToolCalls(text: string): string {
  // Remove JSON blocks that look like tool calls
  return text
    .replace(/\{[^{}]*"name"\s*:\s*"[^"]+?"[^{}]*(?:"parameters"|"arguments")\s*:\s*\{[^{}]*\}[^{}]*\}/g, "")
    // Also remove surrounding markdown fences if the JSON was the only code block content
    .replace(/```(?:json)?\s*\n?\s*\n?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Format a raw tool result into readable markdown for the user.
 */
function formatToolResult(toolName: string, result: unknown): string {
  if (result == null) return "";

  if (toolName === "system_info") {
    const info = result as Record<string, unknown>;
    const lines: string[] = [];
    for (const [key, value] of Object.entries(info)) {
      if (typeof value === "object" && value !== null) {
        lines.push(`**${key}:** ${JSON.stringify(value, null, 2)}`);
      } else {
        lines.push(`**${key}:** ${value}`);
      }
    }
    return lines.join("\n");
  }

  if (toolName === "run_command") {
    const r = result as { stdout?: string; stderr?: string; exitCode?: number };
    let out = "";
    if (r.stdout) out += `\`\`\`\n${r.stdout}\n\`\`\`\n`;
    if (r.stderr) out += `\n**stderr:**\n\`\`\`\n${r.stderr}\n\`\`\`\n`;
    if (r.exitCode != null) out += `*Exit code: ${r.exitCode}*`;
    return out || "*Command completed*";
  }

  if (toolName === "read_file") {
    const r = result as { content?: string };
    return r.content ? `\`\`\`\n${r.content.slice(0, 5000)}\n\`\`\`` : "*Empty file*";
  }

  if (toolName === "list_directory") {
    const r = result as { entries?: string[] };
    return r.entries?.length ? r.entries.join("\n") : "*Empty directory*";
  }

  // Generic fallback
  return `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
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
