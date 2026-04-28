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
import {
  clearSessionMessages,
  deleteSessionById,
  getOrCreateSession,
  listSessions as listPersistentSessions,
  popLastAssistantMessage,
  setSessionTitle as setPersistentSessionTitle,
  touchSession,
} from "./joy_assistant_sessions";
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
// Session Management (disk-backed)
// ============================================================================

export function getSession(sessionId: string): AssistantSession {
  return getOrCreateSession(sessionId);
}

export function clearSession(sessionId: string): void {
  clearSessionMessages(sessionId);
}

export function deleteSession(sessionId: string): void {
  deleteSessionById(sessionId);
}

export function setSessionMode(sessionId: string, mode: AssistantMode): void {
  const session = getOrCreateSession(sessionId);
  session.mode = mode;
  touchSession(sessionId);
}

export function getSessionHistory(sessionId: string): AssistantMessage[] {
  return getOrCreateSession(sessionId).messages;
}

export function listSessions() {
  return listPersistentSessions();
}

export function setSessionTitle(sessionId: string, title: string): void {
  setPersistentSessionTitle(sessionId, title);
}

/** Drop the last assistant message and return the prior user prompt for re-streaming. */
export function popLastForRegenerate(sessionId: string): string | undefined {
  return popLastAssistantMessage(sessionId);
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

/** Probe Ollama for available models. Prefers the user's configured model if it's an Ollama model. */
async function probeOllama(preferredModel?: string): Promise<LocalProbeResult | null> {
  try {
    const baseUrl = getOllamaApiUrl();
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { models?: { name: string }[] };
    const models = data.models ?? [];
    if (models.length === 0) return null;

    // Prefer the user's configured model if it exists on this Ollama instance.
    // Otherwise, prefer chat-tuned conversational models over heavy reasoning/code
    // models — the side panel does short Q&A, and 70B reasoning models like
    // deepseek-r1 take minutes to first-token and frequently stall on tool calls.
    let modelName: string;
    const preferred = preferredModel
      ? models.find(
          (m) => m.name === preferredModel || m.name.startsWith(`${preferredModel}:`),
        )
      : null;
    if (preferred) {
      modelName = preferred.name;
    } else {
      // Preference order: small chat models first, reasoning/code last.
      const preferOrder = [
        // Small chat models first (fast first-token, good for side-panel Q&A)
        /^deepseek-r1:8b/i, /^deepseek-r1:7b/i,
        /^llama3\.2[:\b]/i, /^llama3\.1[:\b]/i, /^llama3[:\b]/i,
        /^qwen2\.5[:\b]/i, /^qwen2[:\b]/i,
        /^mistral[:\b]/i, /^mixtral[:\b]/i,
        /^phi3[:\b]/i, /^gemma2?[:\b]/i,
      ];
      let picked: string | null = null;
      for (const re of preferOrder) {
        const m = models.find((mm) => re.test(mm.name));
        if (m) { picked = m.name; break; }
      }
      modelName = picked ?? models[0].name;
    }

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
async function tryGetLocalModelClient(preferredModel?: string): Promise<LocalProbeResult | null> {
  // Try Ollama first (most common local provider)
  const ollama = await probeOllama(preferredModel);
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
  selectedModelOverride?: { provider: string; name: string },
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
  touchSession(sessionId);

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
    // Pass configured model name so Ollama picks the user's preferred model
    let modelClient: ModelClient;
    let providerId: string;
    let modelId: string;
    let isLocal: boolean;

    // Effective selected model:
    //   1. Explicit override from the panel UI (user clicked a model)
    //   2. settings.selectedModel (global app default)
    //   3. "auto" sentinel — triggers local-first auto-detect
    const effectiveSelected =
      selectedModelOverride && selectedModelOverride.provider !== "auto"
        ? selectedModelOverride
        : (settings.selectedModel ?? { provider: "auto", name: "auto" });

    if (effectiveSelected.provider === "ollama" || effectiveSelected.provider === "lmstudio") {
      // Explicit local model — honor exactly what the user picked
      const localResult =
        effectiveSelected.provider === "ollama"
          ? await probeOllama(effectiveSelected.name)
          : await probeLMStudio();
      if (!localResult) {
        throw new Error(
          `Local model "${effectiveSelected.name}" is not available on ${effectiveSelected.provider}. ` +
            `Make sure the local server is running and the model is pulled.`,
        );
      }
      modelClient = localResult.modelClient;
      providerId = localResult.providerId;
      modelId = localResult.modelId;
      isLocal = true;
      logger.info("Joy assistant using EXPLICIT LOCAL model", { providerId, modelId });
    } else if (effectiveSelected.provider === "auto" || effectiveSelected.name === "auto") {
      // No explicit choice — local-first auto-detect, then cloud fallback
      const localResult = await tryGetLocalModelClient();
      if (localResult) {
        modelClient = localResult.modelClient;
        providerId = localResult.providerId;
        modelId = localResult.modelId;
        isLocal = true;
        logger.info("Joy assistant using AUTO LOCAL model", { providerId, modelId });
      } else {
        const resolved = await getModelClient(effectiveSelected, settings);
        modelClient = resolved.modelClient;
        providerId = modelClient.builtinProviderId ?? effectiveSelected.provider;
        modelId = effectiveSelected.name ?? "unknown";
        isLocal = false;
        logger.info("Joy assistant AUTO fell back to CLOUD model", { providerId, modelId });
      }
    } else {
      // Explicit cloud model — honor exactly what the user picked, do NOT
      // silently fall through to local. (This was the Opus-vs-Sonnet bug.)
      const resolved = await getModelClient(effectiveSelected, settings);
      modelClient = resolved.modelClient;
      providerId = modelClient.builtinProviderId ?? effectiveSelected.provider;
      modelId = effectiveSelected.name ?? "unknown";
      isLocal = false;
      logger.info("Joy assistant using EXPLICIT CLOUD model", { providerId, modelId });
    }

    // Build AI SDK tools for the assistant.
    // Local Ollama models (especially reasoning models like deepseek-r1, qwen3-r1)
    // hang or never emit tokens when given large tool catalogs, because the model
    // gets stuck deciding whether to call a tool. For conversational intents on
    // local models we therefore omit tools entirely — the user can still ask
    // tool-using questions (system, fill, configure, navigate, create) and tools
    // will be re-enabled for those.
    const conversationalIntents: AssistantIntent[] = ["explain", "general", "analyze"];
    const skipToolsForLocal = isLocal && conversationalIntents.includes(intent);
    const assistantTools = skipToolsForLocal ? undefined : buildAssistantTools(intent);

    // Stream the response
    const stream = streamText({
      model: modelClient.model,
      messages: aiMessages as any,
      ...(assistantTools ? { tools: assistantTools, maxSteps: 5 } : {}),
      maxRetries: 1,
      abortSignal,
    });

    // Stall watchdog: if no token arrives within 60s, surface an error
    // instead of letting the user stare at a spinner forever (common when a
    // large local model is loading from disk for the first time).
    let lastChunkAt = Date.now();
    const stallTimer = setInterval(() => {
      if (Date.now() - lastChunkAt > 60_000) {
        clearInterval(stallTimer);
        callbacks.onError(
          `${isLocal ? "Local model" : "Model"} "${modelId}" did not respond within 60s. ` +
            (isLocal
              ? "It may still be loading into memory. Try again, or pick a smaller model in Settings."
              : "Please try again."),
        );
      }
    }, 5_000);

    try {
      for await (const part of stream.fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
        if (abortSignal?.aborted) break;
        lastChunkAt = Date.now();
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
    } finally {
      clearInterval(stallTimer);
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
    touchSession(sessionId);

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
 * Skips malformed calls where parameters look like JSON Schema ({"type":"","properties":{}})
 * rather than actual tool arguments.
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
        // Skip malformed params that look like JSON Schema definitions
        // (e.g. {"type":"","properties":{}}) instead of actual tool arguments
        const keys = Object.keys(params);
        const isSchemaLike =
          keys.length <= 2 &&
          ("type" in params || "properties" in params) &&
          !keys.some((k) => ["infoType", "command", "filePath", "dirPath", "url", "appName", "query", "route", "content", "documentType", "name", "cwd", "args", "category"].includes(k));
        if (isSchemaLike) {
          logger.debug(`Skipping malformed raw tool call "${name}" — params look like JSON Schema`, params);
          continue;
        }
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
  // Remove JSON blocks that look like tool calls (including malformed params)
  let cleaned = text
    .replace(/\{[^{}]*"name"\s*:\s*"[^"]+?"[^{}]*(?:"parameters"|"arguments")\s*:\s*\{[^{}]*\}[^{}]*\}/g, "")
    // Also catch tool calls where parameters contain nested braces (e.g. "type":"","properties":{})
    .replace(/\{[^{}]*"name"\s*:\s*"[^"]+?"[^{}]*\}/g, (match) => {
      // Only strip if it looks like a tool call (has "parameters" or "arguments" key)
      if (/"parameters"|"arguments"/.test(match)) return "";
      return match;
    })
    // Remove surrounding markdown fences if the JSON was the only code block content
    .replace(/```(?:json)?\s*\n?\s*\n?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // If after stripping, the content is empty or only whitespace, return empty
  // This handles the case where the entire response was a raw tool call
  if (!cleaned || /^\s*$/.test(cleaned)) {
    cleaned = "";
  }

  return cleaned;
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
## Important Response Guidelines

- For conversational questions about JoyCreate (features, capabilities, what it can do, how it works), answer directly from your knowledge. Do NOT call any tools for these questions.
- Only use tools when the user explicitly asks you to perform an action (run a command, read/write files, open an app, get real-time system data, navigate, or search the marketplace).
- Never output raw JSON tool-call objects as text. If you are unsure whether to use a tool, respond conversationally instead.

## System-Level Tools

You have access to the user's operating system through these tools. Use them ONLY when the user's request requires performing an action or retrieving real-time data.

### Available Tools
- **run_command** — Execute a shell command (PowerShell on Windows, bash on Linux/macOS).
- **read_file** — Read file contents from disk.
- **write_file** — Write or create files on disk.
- **list_directory** — List files/folders in a directory.
- **search_workspace** — Recursively search files for a regex/text pattern under a root directory.
- **open_app** — Launch an application (notepad, vscode, calculator, etc.)
- **open_url** — Open a URL in the default browser.
- **system_info** — Get real-time system data (os, hardware, processes, disk, memory, network).
- **web_fetch** — Fetch a web page or HTTP(S) endpoint and get readable text.
- **web_search** — Search the public web for information.
- **navigate** — Navigate to a JoyCreate page.
- **search_marketplace** — Search the JoyCreate marketplace.
- **create_document** — Create documents, spreadsheets, or presentations.

### Tool Usage Guidelines
- For safe read-only operations (listing files, reading, system info), just do it — no need to ask.
- For potentially destructive commands (rm, del, format, drop), explain the impact first.
- Chain multiple tool calls when needed for complex tasks (e.g., read file → modify → write back).
- Show file contents and command outputs in code blocks.
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

  // ── Web tools — always available so the assistant can research ─────
  tools.web_fetch = tool({
    description:
      "Fetch a web page and return its readable text content. Use for retrieving article text, docs, JSON APIs, etc.",
    parameters: z.object({
      url: z.string().describe("Absolute http(s) URL to fetch"),
      maxChars: z
        .number()
        .int()
        .min(500)
        .max(50_000)
        .optional()
        .describe("Maximum characters to return (default 8000)"),
    }),
    execute: async ({ url, maxChars }) => {
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) {
          return { error: `Unsupported protocol: ${parsed.protocol}`, executed: false };
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12_000);
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; JoyCreate-Assistant/1.0; +https://joycreate.app)",
            accept: "text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.5",
          },
          redirect: "follow",
        });
        clearTimeout(timer);
        const ct = res.headers.get("content-type") || "";
        const raw = await res.text();
        let text = raw;
        if (/html/i.test(ct)) {
          text = raw
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, " ")
            .trim();
        }
        const limit = maxChars ?? 8000;
        return {
          status: res.status,
          contentType: ct,
          url: res.url,
          text: text.slice(0, limit),
          truncated: text.length > limit,
          executed: true,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), executed: false };
      }
    },
  });

  tools.web_search = tool({
    description:
      "Search the public web (DuckDuckGo) and return the top results with title, URL, and snippet. Use for general research or finding documentation.",
    parameters: z.object({
      query: z.string().describe("Search query"),
      maxResults: z.number().int().min(1).max(15).optional(),
    }),
    execute: async ({ query, maxResults }) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        const res = await fetch(
          `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
          {
            signal: ctrl.signal,
            headers: {
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            },
            redirect: "follow",
          },
        );
        clearTimeout(timer);
        const html = await res.text();
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        // Parse DuckDuckGo HTML result blocks
        const re =
          /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let m: RegExpExecArray | null;
        const cap = maxResults ?? 8;
        while ((m = re.exec(html)) !== null && results.length < cap) {
          const href = m[1];
          const titleHtml = m[2];
          const snippetHtml = m[3];
          // DDG wraps real URL inside /l/?uddg=... — extract it
          let realUrl = href;
          const uddg = href.match(/[?&]uddg=([^&]+)/);
          if (uddg) {
            try {
              realUrl = decodeURIComponent(uddg[1]);
            } catch { /* keep raw */ }
          }
          const strip = (s: string) =>
            s
              .replace(/<[^>]+>/g, "")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#x27;/g, "'")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/\s+/g, " ")
              .trim();
          results.push({
            title: strip(titleHtml),
            url: realUrl,
            snippet: strip(snippetHtml),
          });
        }
        return { query, results, executed: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), executed: false };
      }
    },
  });

  tools.search_workspace = tool({
    description:
      "Search files in a directory for a regex/text pattern. Returns matching file paths with line numbers and snippets. Use for finding code or text inside the user's workspace.",
    parameters: z.object({
      rootDir: z.string().describe("Absolute root directory to search under"),
      pattern: z.string().describe("Plain text or regex pattern to match"),
      isRegex: z.boolean().optional().describe("Treat pattern as a regex (default false)"),
      maxResults: z.number().int().min(1).max(200).optional(),
      filePattern: z
        .string()
        .optional()
        .describe('Optional filename glob-ish substring filter, e.g. ".ts" or "test"'),
    }),
    execute: async ({ rootDir, pattern, isRegex, maxResults, filePattern }) => {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
          return { error: `Not a directory: ${rootDir}`, executed: false };
        }
        const cap = maxResults ?? 50;
        const SKIP = new Set([
          "node_modules",
          ".git",
          "dist",
          "out",
          "build",
          ".next",
          ".turbo",
          ".cache",
          ".vite",
        ]);
        const matcher = isRegex
          ? new RegExp(pattern, "i")
          : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        const matches: Array<{ file: string; line: number; text: string }> = [];

        const walk = (dir: string, depth: number) => {
          if (matches.length >= cap || depth > 10) return;
          let entries: import("node:fs").Dirent[];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (matches.length >= cap) return;
            if (e.name.startsWith(".") && SKIP.has(e.name)) continue;
            if (SKIP.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              walk(full, depth + 1);
            } else if (e.isFile()) {
              if (filePattern && !full.toLowerCase().includes(filePattern.toLowerCase())) continue;
              try {
                const stat = fs.statSync(full);
                if (stat.size > 1024 * 1024) continue; // skip >1MB
                const content = fs.readFileSync(full, "utf-8");
                const lines = content.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                  if (matcher.test(lines[i])) {
                    matches.push({ file: full, line: i + 1, text: lines[i].slice(0, 300) });
                    if (matches.length >= cap) return;
                  }
                }
              } catch {
                /* skip unreadable */
              }
            }
          }
        };

        walk(rootDir, 0);
        return { rootDir, pattern, count: matches.length, matches, executed: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), executed: false };
      }
    },
  });

  // ── System-level tools — always available so the assistant can act ─
  // (Previously gated by intent, but a full agent needs them on by default.
  //  The system prompt + intent classification still steer when to use them.)
  void intent;
  tools.run_command = tool({
    description:
      "Execute a shell command on the user's system. Uses PowerShell on Windows, bash on Linux/macOS. Use carefully — destructive commands are blocked.",
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
    description: "Write content to a file on the user's system. Creates parent directories as needed.",
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
      infoType: z
        .enum(["os", "hardware", "processes", "disk", "memory", "network"])
        .describe("Type of system information to retrieve"),
    }),
    execute: async ({ infoType }) => {
      const info = await getSystemInfo(infoType);
      return { info, executed: true };
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
    case "web_fetch":
      return {
        type: "open-url",
        url: args.url as string,
        label: `Fetched: ${args.url}`,
      };
    case "web_search":
    case "search_workspace":
      // Informational tools — no DOM action to surface
      return null;
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
