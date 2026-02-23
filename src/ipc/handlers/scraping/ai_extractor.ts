/**
 * AI-Powered Smart Extractor
 *
 * Uses the user's configured LLM (local via Ollama / LM Studio, or cloud via
 * OpenAI / Anthropic) to:
 *  - Extract structured data from a page when CSS selectors aren't sufficient
 *  - Infer extractable fields from a sample page (schema detection)
 *  - Summarise long content
 *
 * Falls back gracefully when no model is available.
 */

import { generateText } from "ai";
import log from "electron-log";
import { readSettings } from "@/main/settings";
import { getModelClient } from "@/ipc/utils/get_model_client";
import type {
  AIExtractionResult,
  ScrapingConfig,
  ScrapingField,
} from "./types";

const logger = log.scope("scraping:ai-extractor");

// ── Smart extraction ────────────────────────────────────────────────────────

/**
 * Send page content + user instructions to the LLM and receive structured
 * JSON back.  Returns `{ success: false }` if the model is unavailable.
 */
export async function aiExtract(
  content: string,
  config: ScrapingConfig,
): Promise<AIExtractionResult> {
  if (!config.aiExtraction?.enabled) {
    return { success: false, data: {}, confidence: 0 };
  }

  try {
    const settings = readSettings();
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    const systemPrompt = buildExtractionSystemPrompt(config);
    const userPrompt = buildExtractionUserPrompt(content, config);

    const result = await generateText({
      model: modelClient.model,
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 4096,
      temperature: 0.1,
    });

    const parsed = parseJsonFromResponse(result.text);

    return {
      success: true,
      data: parsed,
      confidence: 0.85,
      tokensUsed: {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      },
      provider: settings.selectedModel?.provider ?? "unknown",
    };
  } catch (err) {
    logger.warn(`AI extraction failed: ${(err as Error).message}`);
    return { success: false, data: {}, confidence: 0 };
  }
}

// ── Schema detection ────────────────────────────────────────────────────────

/**
 * Ask the LLM to infer what data fields are extractable from a sample page.
 */
export async function detectSchema(
  sampleContent: string,
  instructions?: string,
): Promise<ScrapingField[]> {
  try {
    const settings = readSettings();
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    const systemPrompt = `You are a data extraction expert. Analyse the provided web page content and identify all extractable data fields that would be useful for creating a dataset.

For each field, provide:
- id: lowercase snake_case identifier
- name: human-readable name
- type: one of text, number, url, image, date, boolean, array, object, html
- selectorStrategy: "css" (preferred) or "ai-extract"
- selector: CSS selector to target this field (best guess from content structure)
- required: whether this field is essential (true/false)

Return ONLY a JSON array of field objects. No markdown, no explanation.`;

    const userPrompt = `${instructions ? `Additional instructions: ${instructions}\n\n` : ""}Analyse this page content and identify all extractable fields:\n\n${truncate(sampleContent, 8000)}`;

    const result = await generateText({
      model: modelClient.model,
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 2048,
      temperature: 0.1,
    });

    const parsed = parseJsonFromResponse(result.text);
    if (Array.isArray(parsed)) {
      return parsed as ScrapingField[];
    }
    return [];
  } catch (err) {
    logger.warn(`Schema detection failed: ${(err as Error).message}`);
    return [];
  }
}

// ── Content summarisation ───────────────────────────────────────────────────

export async function summariseContent(content: string): Promise<string | null> {
  try {
    const settings = readSettings();
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    const result = await generateText({
      model: modelClient.model,
      system: "You are a concise summariser. Summarise the provided content in 2-3 sentences. Return only the summary, no preamble.",
      prompt: truncate(content, 6000),
      maxOutputTokens: 256,
      temperature: 0.2,
    });

    return result.text.trim() || null;
  } catch (err) {
    logger.warn(`Summarisation failed: ${(err as Error).message}`);
    return null;
  }
}

// ── Prompt builders ─────────────────────────────────────────────────────────

function buildExtractionSystemPrompt(config: ScrapingConfig): string {
  let prompt = `You are a precise data extraction engine. Extract structured data from the provided web page content.

Rules:
1. Return ONLY valid JSON — no markdown fences, no explanation text.
2. Extract every requested field. Use null for missing values.
3. For arrays, return all matching items found.
4. Clean and normalise values (trim whitespace, normalise dates to ISO 8601).
5. Preserve numerical precision for prices, ratings, etc.`;

  if (config.aiExtraction?.outputSchema) {
    prompt += `\n\nExpected output schema:\n${JSON.stringify(config.aiExtraction.outputSchema, null, 2)}`;
  }

  return prompt;
}

function buildExtractionUserPrompt(content: string, config: ScrapingConfig): string {
  const parts: string[] = [];

  if (config.aiExtraction?.instructions) {
    parts.push(`Instructions: ${config.aiExtraction.instructions}`);
  }

  if (config.fields?.length) {
    const fieldList = config.fields
      .filter((f) => f.selectorStrategy === "ai-extract")
      .map((f) => `- ${f.name} (${f.type})${f.required ? " [required]" : ""}`)
      .join("\n");
    if (fieldList) {
      parts.push(`Extract these fields:\n${fieldList}`);
    }
  }

  parts.push(`Page content:\n${truncate(content, 8000)}`);

  return parts.join("\n\n");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseJsonFromResponse(text: string): Record<string, unknown> {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find JSON in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // give up
      }
    }
    return {};
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n... [truncated]";
}
