/**
 * Joy Assistant Service
 *
 * Main-process singleton that orchestrates the AI assistant.
 * Handles intent classification, smart routing (local vs cloud),
 * action planning, and session management.
 *
 * Reuses:
 *  - SmartRouter for model selection
 *  - AI SDK (streamText) for inference
 *  - Knowledge base for platform awareness
 */

import log from "electron-log";
import { streamText, type TextStreamPart, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { readSettings } from "../main/settings";
import {
  smartRouter,
  type RoutingContext,
  type RoutingDecision,
} from "./smart_router";
import {
  buildSystemPrompt,
  findFeatures,
  getSuggestions as getKnowledgeSuggestions,
} from "./joy_assistant_knowledge";
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
// Smart Router Integration
// ============================================================================

function buildRoutingContext(
  intent: AssistantIntent,
  message: string,
): RoutingContext {
  // Map intents to routing parameters
  const mapping: Record<
    AssistantIntent,
    { taskType: RoutingContext["taskType"]; privacy: RoutingContext["privacyLevel"] }
  > = {
    navigate: { taskType: "chat", privacy: "standard" },
    explain: { taskType: "chat", privacy: "standard" },
    fill: { taskType: "extraction", privacy: "standard" },
    create: { taskType: "creative_writing", privacy: "standard" },
    search: { taskType: "chat", privacy: "standard" },
    configure: { taskType: "chat", privacy: "private" },
    analyze: { taskType: "reasoning", privacy: "standard" },
    general: { taskType: "chat", privacy: "standard" },
  };

  const { taskType, privacy } = mapping[intent];

  return {
    taskType,
    prompt: message,
    requiresStreaming: true,
    privacyLevel: privacy,
    maxLatencyMs: intent === "navigate" ? 5000 : 15000,
    budgetCents: intent === "explain" || intent === "navigate" ? 1 : 10,
  };
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
 * 2. Smart router model selection
 * 3. Streaming inference
 * 4. Action planning
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

  // 4. Build system prompt with knowledge context
  const systemPrompt = buildSystemPrompt(pageContext, mode);

  // 5. Build conversation messages for the AI
  const aiMessages: { role: "user" | "assistant" | "system"; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  // Include last 20 messages for context (avoid token explosion)
  const recentMessages = session.messages.slice(-20);
  for (const msg of recentMessages) {
    aiMessages.push({ role: msg.role, content: msg.content });
  }

  // 6. Route to best model via smart router
  let routing: RoutingDecision | null = null;
  try {
    const routingCtx = buildRoutingContext(intent, message);
    routing = await smartRouter.route(routingCtx);
    logger.info("Routed to", {
      provider: routing.providerId,
      model: routing.modelId,
      confidence: routing.confidence,
      local: routing.providerId.startsWith("ollama") || routing.providerId.startsWith("lm-studio"),
    });
  } catch (err) {
    logger.warn("Smart router failed, falling back to default", err);
  }

  // 7. Stream response
  let assistantContent = "";
  let parsedActions: AssistantAction[] = [...plannedActions];

  try {
    const settings = await readSettings();
    const apiKey = settings.providerSettings?.["auto"]?.apiKey?.value;

    // Helper: build provider + stream for a given baseURL / model
    const doStream = (baseURL: string, modelId: string, key: string) => {
      const provider = createOpenAI({ baseURL, apiKey: key || undefined });
      return streamText({
        model: provider(modelId),
        messages: aiMessages as any,
        maxRetries: 1,
        abortSignal,
      });
    };

    /** Consume an entire stream in a single loop (never break + re-iterate). */
    const consumeStream = async (s: ReturnType<typeof streamText>) => {
      for await (const part of s.fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
        if (abortSignal?.aborted) break;
        if (part.type === "text-delta") {
          assistantContent += part.text;
          callbacks.onDelta(part.text);
        }
      }
    };

    const isLocal = routing
      ? routing.providerId.includes("ollama") ||
        routing.providerId.includes("lm-studio") ||
        routing.providerId.includes("llama")
      : false;

    const primaryBaseURL = routing
      ? getProviderBaseUrl(routing.providerId)
      : "https://help.joycreate.app/v1";
    const primaryModel = routing?.modelId || "gpt-4o-mini";

    let usedModel = primaryModel;
    let usedBaseURL = primaryBaseURL;

    try {
      const stream = doStream(primaryBaseURL, primaryModel, apiKey ?? "");
      await consumeStream(stream);
    } catch (primaryErr) {
      const errMsg = String(primaryErr);
      // If local model not found or unreachable, fall back to cloud
      if (isLocal && (errMsg.includes("not found") || errMsg.includes("404") || errMsg.includes("ECONNREFUSED"))) {
        logger.warn("Local model failed, falling back to cloud", { model: primaryModel, error: errMsg });
        usedBaseURL = "https://help.joycreate.app/v1";
        usedModel = "gpt-4o-mini";
        assistantContent = ""; // reset any partial content

        const fallback = doStream(usedBaseURL, usedModel, apiKey ?? "");
        await consumeStream(fallback);
      } else {
        throw primaryErr;
      }
    }

    // Update routing info to reflect what was actually used
    if (routing && (usedModel !== primaryModel || usedBaseURL !== primaryBaseURL)) {
      routing = { ...routing, providerId: "cloud-fallback", modelId: usedModel };
    }

    // 8. Parse actions from model output (if any)
    const aiActions = parseActionsFromResponse(assistantContent);
    if (aiActions.length > 0) {
      parsedActions = aiActions;
    }

    // Send planned/parsed actions
    if (parsedActions.length > 0) {
      callbacks.onActions(parsedActions);
    }

    // 9. Clean the response content (remove <actions> tags from displayed text)
    const cleanContent = assistantContent
      .replace(/<actions>[\s\S]*?<\/actions>/g, "")
      .trim();

    // 10. Save assistant message to session
    const assistantMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: cleanContent,
      actions: parsedActions.length > 0 ? parsedActions : undefined,
      intent,
      timestamp: Date.now(),
      routingInfo: routing
        ? {
            providerId: routing.providerId,
            modelId: routing.modelId,
            isLocal:
              routing.providerId.includes("ollama") ||
              routing.providerId.includes("lm-studio") ||
              routing.providerId.includes("llama"),
          }
        : undefined,
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

/** Map provider IDs to base URLs */
function getProviderBaseUrl(providerId: string): string {
  if (providerId.includes("ollama")) return "http://127.0.0.1:11434/v1";
  if (providerId.includes("lm-studio")) return "http://127.0.0.1:1234/v1";
  if (providerId.includes("llama-cpp")) return "http://127.0.0.1:8080/v1";
  if (providerId.includes("vllm")) return "http://127.0.0.1:8000/v1";
  // Default cloud endpoint
  return "https://help.joycreate.app/v1";
}

/** Get suggestions for the current page context. */
export function getPageSuggestions(
  pageContext: AssistantPageContext,
): AssistantSuggestion[] {
  return getKnowledgeSuggestions(pageContext);
}
