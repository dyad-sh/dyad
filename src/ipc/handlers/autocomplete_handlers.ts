import { generateText } from "ai";
import { createTypedHandler } from "./base";
import { autocompleteContracts } from "../types/autocomplete";
import { readSettings } from "../../main/settings";
import { getModelClient } from "../utils/get_model_client";
import { getEnvVar } from "../utils/read_env";
import { sendTelemetryEvent } from "../utils/telemetry";
import { db } from "../../db";
import { chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";

const logger = log.scope("autocomplete");

// Active abort controllers keyed by requestId
const activeRequests = new Map<string, AbortController>();

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
  const index = Math.floor(Math.random() * SYSTEM_PROMPT_VARIANTS.length);
  return SYSTEM_PROMPT_VARIANTS[index];
}

// =============================================================================
// Model Selection (smart fallback chain)
// =============================================================================

async function getAutocompleteModelClient() {
  const settings = readSettings();

  // Priority 1: Dyad Pro turbo
  const dyadApiKey = settings.providerSettings?.auto?.apiKey?.value;
  if (dyadApiKey && settings.enableDyadPro) {
    try {
      const { modelClient } = await getModelClient(
        { provider: "auto", name: "turbo" },
        settings,
      );
      return { model: modelClient.model, provider: "auto:turbo" };
    } catch {
      // Fall through
    }
  }

  // Priority 2: Google Gemini Flash (free tier available)
  const googleKey =
    settings.providerSettings?.google?.apiKey?.value ||
    getEnvVar("GEMINI_API_KEY");
  if (googleKey) {
    try {
      const { modelClient } = await getModelClient(
        { provider: "google", name: "gemini-flash-latest" },
        settings,
      );
      return { model: modelClient.model, provider: "google" };
    } catch {
      // Fall through
    }
  }

  // Priority 3: OpenAI (gpt-5-mini)
  const openaiKey =
    settings.providerSettings?.openai?.apiKey?.value ||
    getEnvVar("OPENAI_API_KEY");
  if (openaiKey) {
    try {
      const { modelClient } = await getModelClient(
        { provider: "openai", name: "gpt-5-mini" },
        settings,
      );
      return { model: modelClient.model, provider: "openai" };
    } catch {
      // Fall through
    }
  }

  // Priority 4: OpenRouter (free model)
  const openrouterKey =
    settings.providerSettings?.openrouter?.apiKey?.value ||
    getEnvVar("OPENROUTER_API_KEY");
  if (openrouterKey) {
    try {
      const { modelClient } = await getModelClient(
        { provider: "openrouter", name: "qwen/qwen3-coder:free" },
        settings,
      );
      return { model: modelClient.model, provider: "openrouter" };
    } catch {
      // Fall through
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
        const modelResult = await getAutocompleteModelClient();
        if (!modelResult) {
          return emptyResponse;
        }

        const abortController = new AbortController();
        activeRequests.set(req.requestId, abortController);

        // 3-second timeout
        const timeout = setTimeout(() => abortController.abort(), 3000);

        const variant = selectVariant();

        // Build context from recent messages
        let contextMessages = "";
        if (req.chatId) {
          try {
            const chat = await db.query.chats.findFirst({
              where: eq(chats.id, req.chatId),
              with: {
                messages: {
                  orderBy: (messages, { asc }) => [asc(messages.createdAt)],
                },
              },
            });
            if (chat?.messages?.length) {
              const recent = chat.messages.slice(-4);
              contextMessages = recent
                .map(
                  (m) =>
                    `${m.role}: ${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}`,
                )
                .join("\n");
            }
          } catch {
            // Context fetch failed, continue without it
          }
        }

        const userMessage = contextMessages
          ? `Recent conversation:\n${contextMessages}\n\nUser is currently typing: "${req.inputText}"`
          : `User is currently typing: "${req.inputText}"`;

        try {
          const result = await generateText({
            model: modelResult.model,
            system: variant.prompt,
            messages: [{ role: "user", content: userMessage }],
            maxOutputTokens: 50,
            temperature: 0,
            abortSignal: abortController.signal,
          });

          clearTimeout(timeout);
          activeRequests.delete(req.requestId);

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
          clearTimeout(timeout);
          activeRequests.delete(req.requestId);

          if (error?.name === "AbortError" || abortController.signal.aborted) {
            return emptyResponse;
          }

          logger.warn("Autocomplete generation failed:", error?.message);
          return emptyResponse;
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
      const controller = activeRequests.get(requestId);
      if (controller) {
        controller.abort();
        activeRequests.delete(requestId);
      }
      return true;
    },
  );
}
