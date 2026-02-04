import { generateText } from "ai";
import { createTypedHandler } from "./base";
import { autocompleteContracts } from "../types/autocomplete";
import { readSettings } from "../../main/settings";
import { getModelClient } from "../utils/get_model_client";
import { getEnvVar } from "../utils/read_env";
import { sendTelemetryEvent } from "../utils/telemetry";
import { db } from "../../db";
import { messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";

const logger = log.scope("autocomplete");

// Active abort controllers and timeouts keyed by requestId
const activeRequests = new Map<
  string,
  { controller: AbortController; timeout: ReturnType<typeof setTimeout> }
>();

// Maximum number of active requests to prevent memory leaks
const MAX_ACTIVE_REQUESTS = 50;

// Session-based A/B variant assignment (persists for the session)
let sessionVariant: (typeof SYSTEM_PROMPT_VARIANTS)[number] | null = null;

// =============================================================================
// System Prompt Variants (A/B testing)
// =============================================================================

const SYSTEM_PROMPT_VARIANTS = [
  {
    id: "concise-v1",
    prompt: `You are an autocomplete assistant for a coding chat application.
The user is typing a message to an AI coding assistant.
Complete their thought with a SHORT continuation (max 15 words).
Only output the completion text, nothing else.
Do not repeat what the user already typed.
If you cannot suggest anything useful, respond with an empty string.`,
  },
  {
    id: "intent-v1",
    prompt: `You are a smart autocomplete for a coding chat.
Predict what the user wants to say next based on context.
Output ONLY the completion text (max 15 words).
Focus on completing the user's intent, not just grammar.
If the input is too short or ambiguous, respond with an empty string.`,
  },
  {
    id: "technical-v1",
    prompt: `You autocomplete messages in a coding assistant chat.
Complete the user's message naturally, focusing on technical accuracy.
Keep completions under 15 words. Only output the completion.
If uncertain, output an empty string.`,
  },
];

function selectVariant(): (typeof SYSTEM_PROMPT_VARIANTS)[number] {
  // Use session-sticky variant for consistent A/B testing
  if (!sessionVariant) {
    const index = Math.floor(Math.random() * SYSTEM_PROMPT_VARIANTS.length);
    sessionVariant = SYSTEM_PROMPT_VARIANTS[index];
  }
  return sessionVariant;
}

// =============================================================================
// Model Selection (smart fallback chain)
// =============================================================================

async function getAutocompleteModelClient() {
  const settings = readSettings();

  const providersToTry = [
    {
      id: "auto:turbo" as const,
      enabled:
        settings.providerSettings?.auto?.apiKey?.value &&
        settings.enableDyadPro,
      model: { provider: "auto" as const, name: "turbo" },
    },
    {
      id: "google" as const,
      enabled: !!(
        settings.providerSettings?.google?.apiKey?.value ||
        getEnvVar("GEMINI_API_KEY")
      ),
      model: { provider: "google" as const, name: "gemini-flash-latest" },
    },
    {
      id: "openai" as const,
      enabled: !!(
        settings.providerSettings?.openai?.apiKey?.value ||
        getEnvVar("OPENAI_API_KEY")
      ),
      model: { provider: "openai" as const, name: "gpt-5-mini" },
    },
    {
      id: "openrouter" as const,
      enabled: !!(
        settings.providerSettings?.openrouter?.apiKey?.value ||
        getEnvVar("OPENROUTER_API_KEY")
      ),
      model: { provider: "openrouter" as const, name: "qwen/qwen3-coder:free" },
    },
  ];

  for (const provider of providersToTry) {
    if (provider.enabled) {
      try {
        const { modelClient } = await getModelClient(provider.model, settings);
        return { model: modelClient.model, provider: provider.id };
      } catch {
        // Fall through to the next provider
      }
    }
  }

  return null;
}

// =============================================================================
// Handlers
// =============================================================================

export function registerAutocompleteHandlers() {
  createTypedHandler(
    autocompleteContracts.getSuggestion,
    async (_event, req) => {
      const emptyResponse = {
        suggestion: "",
        variantId: "none",
        requestId: req.requestId,
      };

      try {
        // Evict oldest requests if we exceed the limit
        if (activeRequests.size >= MAX_ACTIVE_REQUESTS) {
          const firstKey = activeRequests.keys().next().value;
          if (firstKey) {
            const entry = activeRequests.get(firstKey);
            if (entry) {
              clearTimeout(entry.timeout);
              entry.controller.abort();
            }
            activeRequests.delete(firstKey);
          }
        }

        const modelResult = await getAutocompleteModelClient();
        if (!modelResult) {
          return emptyResponse;
        }

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 3000);
        activeRequests.set(req.requestId, {
          controller: abortController,
          timeout,
        });

        const variant = selectVariant();

        // Build context from recent messages (fetch only last 4 from DB)
        let contextMessages = "";
        if (req.chatId) {
          try {
            const recentMessages = await db.query.messages.findMany({
              where: eq(messages.chatId, req.chatId),
              orderBy: (messages, { desc }) => [desc(messages.createdAt)],
              limit: 4,
            });
            if (recentMessages.length > 0) {
              contextMessages = recentMessages
                .reverse()
                .map((m) => {
                  const truncatedContent =
                    m.content.length > 200
                      ? m.content.slice(0, 200) + "..."
                      : m.content;
                  // Escape quotes to prevent prompt injection
                  const escapedContent = truncatedContent.replace(/"/g, '\\"');
                  return `${m.role}: ${escapedContent}`;
                })
                .join("\n");
            }
          } catch {
            // Context fetch failed, continue without it
          }
        }

        // Use JSON.stringify to safely escape user input and prevent prompt injection
        const escapedInput = JSON.stringify(req.inputText);
        const userMessage = contextMessages
          ? `Recent conversation:\n${contextMessages}\n\nUser is currently typing: ${escapedInput}`
          : `User is currently typing: ${escapedInput}`;

        try {
          const result = await generateText({
            model: modelResult.model,
            system: variant.prompt,
            messages: [{ role: "user", content: userMessage }],
            maxOutputTokens: 50,
            temperature: 0,
            abortSignal: abortController.signal,
          });

          const suggestion = result.text.trim();

          sendTelemetryEvent("autocomplete:generated", {
            variantId: variant.id,
            provider: modelResult.provider,
            hasSuggestion: suggestion.length > 0,
          });

          return {
            suggestion,
            variantId: variant.id,
            requestId: req.requestId,
          };
        } catch (error: any) {
          if (error?.name === "AbortError" || abortController.signal.aborted) {
            return emptyResponse;
          }

          logger.warn("Autocomplete generation failed:", error?.message);
          return emptyResponse;
        } finally {
          const entry = activeRequests.get(req.requestId);
          if (entry) {
            clearTimeout(entry.timeout);
            activeRequests.delete(req.requestId);
          }
        }
      } catch (error) {
        logger.warn("Autocomplete handler error:", error);
        return emptyResponse;
      }
    },
  );

  createTypedHandler(
    autocompleteContracts.cancelSuggestion,
    async (_event, requestId) => {
      const entry = activeRequests.get(requestId);
      if (entry) {
        clearTimeout(entry.timeout);
        entry.controller.abort();
        activeRequests.delete(requestId);
      }
      return true;
    },
  );
}
