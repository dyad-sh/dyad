/**
 * Auto-Tagger & Classifier
 *
 * Two layers:
 *  1. Rule-based (always runs, fast) — domain categorisation, MIME type,
 *     keyword extraction, content type detection from structured data
 *  2. AI-powered (runs when LLM available) — sentiment analysis, topic
 *     classification, entity extraction, quality assessment
 *
 * Supports both local LLMs (Ollama, LM Studio) and cloud providers
 * (OpenAI, Anthropic) — uses whatever the user has configured.
 */

import { generateText } from "ai";
import log from "electron-log";
import { readSettings } from "@/main/settings";
import { getModelClient } from "@/ipc/utils/get_model_client";
import type {
  ScrapedPage,
  TaggingResult,
  ScrapingConfig,
} from "./types";

const logger = log.scope("scraping:tagger");

// ── Main entry point ────────────────────────────────────────────────────────

export async function tagContent(
  page: ScrapedPage,
  config: ScrapingConfig,
): Promise<TaggingResult> {
  // Rule-based layer (always runs)
  const ruleResult = applyRuleBasedTags(page);

  // AI layer (if enabled and a model is available)
  if (config.autoTag?.enabled) {
    try {
      const aiResult = await applyAiTags(page, config, ruleResult);
      return mergeResults(ruleResult, aiResult);
    } catch (err) {
      logger.warn(`AI tagging failed, using rule-based only: ${(err as Error).message}`);
    }
  }

  return ruleResult;
}

// ── Rule-based tagging ──────────────────────────────────────────────────────

function applyRuleBasedTags(page: ScrapedPage): TaggingResult {
  return {
    mimeCategory: categorizeMime(page.contentType),
    domainCategory: categorizeDomain(page.url),
    contentType: detectContentType(page),
    language: page.language,
    keywords: extractKeywords(page.content),
  };
}

// Domain categorisation
const DOMAIN_CATEGORIES: Record<string, string[]> = {
  news: ["bbc.", "cnn.", "reuters.", "nytimes.", "theguardian.", "wsj.", "apnews.", "news.", "washingtonpost."],
  ecommerce: ["amazon.", "ebay.", "shopify.", "etsy.", "alibaba.", "walmart.", "shop.", "store."],
  social: ["twitter.", "x.com", "facebook.", "instagram.", "reddit.", "linkedin.", "tiktok.", "mastodon."],
  academic: [".edu", "scholar.google", "arxiv.org", "researchgate.", "pubmed.", "jstor.", "springer.", ".ac."],
  government: [".gov", ".mil", "europa.eu", ".gob.", ".gouv."],
  technology: ["github.", "stackoverflow.", "dev.to", "medium.com", "hackernews", "techcrunch.", "arstechnica."],
  finance: ["bloomberg.", "cnbc.", "marketwatch.", "yahoo.com/finance", "investing.com", "coindesk."],
  entertainment: ["youtube.", "netflix.", "spotify.", "imdb.", "rottentomatoes.", "twitch."],
  health: ["webmd.", "mayoclinic.", "nih.gov", "who.int", "healthline.", "medscape."],
  recipes: ["allrecipes.", "foodnetwork.", "epicurious.", "tasty.", "cooking.", "recipe."],
  realestate: ["zillow.", "realtor.", "redfin.", "trulia.", "rightmove.", "zoopla."],
  jobs: ["indeed.", "glassdoor.", "linkedin.com/jobs", "monster.", "ziprecruiter."],
};

function categorizeDomain(url: string): string {
  const lower = url.toLowerCase();
  for (const [category, patterns] of Object.entries(DOMAIN_CATEGORIES)) {
    for (const pat of patterns) {
      if (lower.includes(pat)) return category;
    }
  }
  return "general";
}

// MIME categorisation
function categorizeMime(contentType: string): string {
  if (contentType.includes("html")) return "webpage";
  if (contentType.includes("json")) return "api-response";
  if (contentType.includes("xml")) return "feed";
  if (contentType.includes("pdf")) return "document";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "video";
  return "other";
}

// Content type detection from structured data and page structure
function detectContentType(page: ScrapedPage): string {
  // Check JSON-LD @type
  for (const sd of page.structuredData) {
    if (sd.type === "json-ld" && sd.data["@type"]) {
      const ldType = String(sd.data["@type"]).toLowerCase();
      if (ldType.includes("article") || ldType.includes("newsarticle") || ldType.includes("blogposting")) return "article";
      if (ldType.includes("product")) return "product";
      if (ldType.includes("recipe")) return "recipe";
      if (ldType.includes("event")) return "event";
      if (ldType.includes("person") || ldType.includes("profilepage")) return "profile";
      if (ldType.includes("organization")) return "organization";
      if (ldType.includes("review")) return "review";
      if (ldType.includes("faq")) return "faq";
      if (ldType.includes("howto")) return "howto";
      if (ldType.includes("jobposting")) return "job-listing";
      if (ldType.includes("video")) return "video";
      if (ldType.includes("course") || ldType.includes("learningresource")) return "educational";
    }
  }

  // Check OG type
  if (page.metadata.ogType) {
    const ogType = page.metadata.ogType.toLowerCase();
    if (ogType === "article") return "article";
    if (ogType === "product") return "product";
    if (ogType === "profile") return "profile";
    if (ogType === "video.other" || ogType === "video.movie") return "video";
  }

  // Heuristic detection
  if (page.tables.length > 2) return "data-table";
  if (page.content.length > 3000 && page.author) return "article";
  if (page.images.length > 10 && page.content.length < 500) return "gallery";

  return "webpage";
}

// Keyword extraction (TF-IDF-lite: frequency-based with stop-word removal)
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "this", "that", "was", "are",
  "be", "has", "had", "have", "not", "no", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "just", "about",
  "also", "more", "than", "very", "so", "if", "as", "up", "out", "all",
  "its", "they", "them", "their", "we", "our", "you", "your", "he", "she",
  "him", "her", "his", "been", "being", "each", "which", "when", "where",
  "how", "what", "who", "whom", "why", "some", "any", "many", "much",
  "both", "only", "own", "same", "other", "new", "like", "over", "such",
  "then", "into", "after", "before", "between", "under", "through",
]);

function extractKeywords(text: string, maxKeywords = 15): string[] {
  // Tokenize, clean, and filter
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  // Count frequencies
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Return top-N by frequency
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

// ── AI-powered tagging ──────────────────────────────────────────────────────

async function applyAiTags(
  page: ScrapedPage,
  config: ScrapingConfig,
  ruleBasedResult: TaggingResult,
): Promise<Partial<TaggingResult>> {
  const settings = readSettings();
  const { modelClient } = await getModelClient(
    settings.selectedModel,
    settings,
  );

  const tasks: string[] = [];
  if (config.autoTag?.detectSentiment) tasks.push("sentiment");
  if (config.autoTag?.classifyTopics) tasks.push("topics");
  if (config.autoTag?.extractEntities) tasks.push("entities");
  if (config.autoTag?.assessQuality) tasks.push("quality");

  if (!tasks.length) {
    // Default: run sentiment + topics + entities
    tasks.push("sentiment", "topics", "entities");
  }

  const systemPrompt = buildTaggingPrompt(tasks, config.autoTag?.customCategories);
  const contentPreview = truncateForTagging(page.content);

  const result = await generateText({
    model: modelClient.model,
    system: systemPrompt,
    prompt: `URL: ${page.url}\nTitle: ${page.title || "N/A"}\nDomain category: ${ruleBasedResult.domainCategory}\nContent type: ${ruleBasedResult.contentType}\n\nContent:\n${contentPreview}`,
    maxOutputTokens: 1024,
    temperature: 0.1,
  });

  return parseTaggingResponse(result.text);
}

function buildTaggingPrompt(tasks: string[], customCategories?: string[]): string {
  let prompt = `You are a content analysis engine. Analyse the provided web content and return a JSON object with the following fields (only include fields you're asked about):

`;

  if (tasks.includes("sentiment")) {
    prompt += `- "sentiment": { "label": "positive"|"negative"|"neutral"|"mixed", "score": 0.0-1.0 }\n`;
  }
  if (tasks.includes("topics")) {
    prompt += `- "topics": [{ "name": "topic name", "confidence": 0.0-1.0 }] (up to 5 topics)\n`;
  }
  if (tasks.includes("entities")) {
    prompt += `- "entities": [{ "text": "entity text", "type": "person"|"organization"|"location"|"date"|"product"|"price"|"technology"|"event", "confidence": 0.0-1.0 }] (up to 20 entities)\n`;
  }
  if (tasks.includes("quality")) {
    prompt += `- "qualityScore": 0.0-1.0 (overall content quality: completeness, coherence, informativeness)\n`;
  }
  if (tasks.includes("summary")) {
    prompt += `- "summary": "2-3 sentence summary"\n`;
  }

  if (customCategories?.length) {
    prompt += `\nAlso classify into these custom categories (provide confidence 0.0-1.0 for each):\n`;
    prompt += `- "customCategories": { ${customCategories.map((c) => `"${c}": 0.0-1.0`).join(", ")} }\n`;
  }

  prompt += `\nReturn ONLY valid JSON. No markdown fences, no explanation.`;

  return prompt;
}

function parseTaggingResponse(text: string): Partial<TaggingResult> {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const data = JSON.parse(cleaned);
    const result: Partial<TaggingResult> = {};

    if (data.sentiment) {
      result.sentiment = {
        label: data.sentiment.label,
        score: data.sentiment.score,
      };
    }

    if (data.topics) {
      result.topics = data.topics.map((t: any) => ({
        name: String(t.name),
        confidence: Number(t.confidence),
      }));
    }

    if (data.entities) {
      result.entities = data.entities.map((e: any) => ({
        text: String(e.text),
        type: String(e.type),
        confidence: Number(e.confidence),
      }));
    }

    if (data.qualityScore !== undefined) {
      result.qualityScore = Number(data.qualityScore);
    }

    if (data.summary) {
      result.summary = String(data.summary);
    }

    if (data.customCategories) {
      result.customCategories = data.customCategories;
    }

    return result;
  } catch (err) {
    logger.warn(`Failed to parse AI tagging response: ${(err as Error).message}`);
    return {};
  }
}

// ── Merge rule-based + AI results ───────────────────────────────────────────

function mergeResults(
  ruleBased: TaggingResult,
  aiResult: Partial<TaggingResult>,
): TaggingResult {
  return {
    ...ruleBased,
    ...aiResult,
    // Keep rule-based keywords but extend with AI topics as keywords too
    keywords: [
      ...new Set([
        ...ruleBased.keywords,
        ...(aiResult.topics?.map((t) => t.name) ?? []),
      ]),
    ],
  };
}

// ── Utility ─────────────────────────────────────────────────────────────────

function truncateForTagging(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n... [truncated]";
}
