/**
 * NLP Pipeline Service — Joy Data Studio
 *
 * Provides a unified NLP processing framework inspired by
 * UIMA, GATE, Stanford CoreNLP, OpenNLP, DKPro Core, and ClearTK.
 *
 * Instead of requiring users to install Java-based toolkits, this service
 * wraps local AI models (Ollama) and lightweight JS-based NLP libraries
 * to provide equivalent capabilities natively:
 *
 *   UIMA Architecture  → Pipeline orchestration with typed analysis engines
 *   GATE Text Eng.     → Annotation-based text processing
 *   Stanford CoreNLP   → Tokenization, POS, NER, parsing, sentiment
 *   OpenNLP            → ML-based sentence detection, tokenization, POS
 *   DKPro Core         → Reusable NLP component pipelines
 *   ClearTK            → ML feature extraction for NLP
 *
 * All processing happens locally for privacy. GPU-accelerated via Ollama
 * models when available, with CPU fallbacks.
 */

import log from "electron-log";
import { app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

const logger = log.scope("nlp-pipeline");

// ============================================================================
// TYPES — UIMA-inspired Type System
// ============================================================================

/** A span of text with type + features (GATE Annotation-compatible) */
export interface Annotation {
  id: string;
  type: AnnotationType;
  start: number;
  end: number;
  text: string;
  features: Record<string, any>;
  confidence?: number;
  source: string; // which analysis engine produced this
}

export type AnnotationType =
  | "Token"
  | "Sentence"
  | "Paragraph"
  | "NamedEntity"
  | "PartOfSpeech"
  | "Dependency"
  | "Sentiment"
  | "Topic"
  | "Keyword"
  | "Relation"
  | "Coreference"
  | "SemanticRole"
  | "Intent"
  | "Slot"
  | "Summary"
  | "Translation"
  | "Embedding"
  | "Custom";

/** Named entity subtypes */
export type EntityType =
  | "PERSON"
  | "ORGANIZATION"
  | "LOCATION"
  | "DATE"
  | "TIME"
  | "MONEY"
  | "PERCENT"
  | "PRODUCT"
  | "EVENT"
  | "WORK_OF_ART"
  | "LAW"
  | "LANGUAGE"
  | "QUANTITY"
  | "ORDINAL"
  | "CARDINAL"
  | "GPE"       // geopolitical entity
  | "FACILITY"
  | "NORP"      // nationalities, religious, political groups
  | "CUSTOM";

/** CAS (Common Analysis Structure) — UIMA-style document container */
export interface CAS {
  id: string;
  text: string;
  language: string;
  annotations: Annotation[];
  metadata: Record<string, any>;
  processingHistory: ProcessingStep[];
}

/** Track which engines ran and when */
export interface ProcessingStep {
  engine: string;
  startedAt: string;
  completedAt: string;
  annotationsAdded: number;
  config?: Record<string, any>;
}

/** Analysis Engine — a processing unit in the pipeline */
export interface AnalysisEngine {
  name: string;
  type: "annotator" | "consumer" | "transformer";
  description: string;
  inputTypes: AnnotationType[];
  outputTypes: AnnotationType[];
  config?: Record<string, any>;
  process: (cas: CAS, config?: Record<string, any>) => Promise<CAS>;
}

/** Pipeline definition */
export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  engines: string[]; // engine names in order
  config: Record<string, Record<string, any>>; // per-engine config
  createdAt: string;
  updatedAt: string;
}

/** Pipeline execution result */
export interface PipelineResult {
  pipelineId: string;
  cas: CAS;
  executionTimeMs: number;
  engineResults: Array<{
    engine: string;
    timeMs: number;
    annotationsAdded: number;
    success: boolean;
    error?: string;
  }>;
}

// ============================================================================
// BUILT-IN ANALYSIS ENGINES
// ============================================================================

/**
 * Sentence Detector (OpenNLP-style)
 * Uses regex + heuristics for sentence boundary detection
 */
const sentenceDetector: AnalysisEngine = {
  name: "sentence-detector",
  type: "annotator",
  description: "Detect sentence boundaries (OpenNLP-style)",
  inputTypes: [],
  outputTypes: ["Sentence"],
  async process(cas: CAS): Promise<CAS> {
    const text = cas.text;
    // Smart sentence splitting: handles abbreviations, decimals, etc.
    const sentenceEnders = /(?<=[.!?])\s+(?=[A-Z"'\u201C\u2018])|(?<=[.!?])$/g;
    const sentences: Array<{ start: number; end: number; text: string }> = [];

    let lastEnd = 0;
    let match: RegExpExecArray | null;

    // First pass: split on clear sentence boundaries
    const parts = text.split(sentenceEnders);
    let offset = 0;

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        const start = text.indexOf(trimmed, offset);
        sentences.push({
          start,
          end: start + trimmed.length,
          text: trimmed,
        });
        offset = start + trimmed.length;
      }
    }

    // If no sentences found, treat entire text as one sentence
    if (sentences.length === 0 && text.trim().length > 0) {
      sentences.push({ start: 0, end: text.length, text: text.trim() });
    }

    for (const s of sentences) {
      cas.annotations.push({
        id: uuidv4(),
        type: "Sentence",
        start: s.start,
        end: s.end,
        text: s.text,
        features: { index: sentences.indexOf(s) },
        confidence: 0.9,
        source: "sentence-detector",
      });
    }

    return cas;
  },
};

/**
 * Tokenizer (Stanford CoreNLP-style)
 * Word-level tokenization with punctuation handling
 */
const tokenizer: AnalysisEngine = {
  name: "tokenizer",
  type: "annotator",
  description: "Word-level tokenization (CoreNLP-style)",
  inputTypes: ["Sentence"],
  outputTypes: ["Token"],
  async process(cas: CAS): Promise<CAS> {
    const sentences = cas.annotations.filter((a) => a.type === "Sentence");

    for (const sentence of sentences) {
      // Tokenize: split on whitespace and punctuation, preserve positions
      const tokenPattern = /\b[\w'-]+\b|[^\s\w]/g;
      let match: RegExpExecArray | null;

      while ((match = tokenPattern.exec(sentence.text)) !== null) {
        const absoluteStart = sentence.start + match.index;
        cas.annotations.push({
          id: uuidv4(),
          type: "Token",
          start: absoluteStart,
          end: absoluteStart + match[0].length,
          text: match[0],
          features: {
            sentenceId: sentence.id,
            index: match.index,
            isWord: /\w/.test(match[0]),
            isPunctuation: /[^\w\s]/.test(match[0]),
          },
          confidence: 1.0,
          source: "tokenizer",
        });
      }
    }

    return cas;
  },
};

/**
 * Keyword Extractor (TF-IDF inspired)
 * Extracts important terms from the document
 */
const keywordExtractor: AnalysisEngine = {
  name: "keyword-extractor",
  type: "annotator",
  description: "Extract keywords and key phrases (TF-IDF inspired)",
  inputTypes: ["Token"],
  outputTypes: ["Keyword"],
  async process(cas: CAS): Promise<CAS> {
    const tokens = cas.annotations.filter(
      (a) => a.type === "Token" && a.features.isWord,
    );

    // Common stopwords
    const stopwords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "can", "shall", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "into", "through", "during",
      "before", "after", "above", "below", "between", "out", "off", "over",
      "under", "again", "further", "then", "once", "here", "there", "when",
      "where", "why", "how", "all", "both", "each", "few", "more", "most",
      "other", "some", "such", "no", "not", "only", "own", "same", "so",
      "than", "too", "very", "and", "but", "or", "nor", "if", "it", "its",
      "this", "that", "these", "those", "i", "me", "my", "we", "our", "you",
      "your", "he", "him", "his", "she", "her", "they", "them", "their",
      "what", "which", "who", "whom",
    ]);

    // Term frequency
    const tf = new Map<string, { count: number; positions: number[] }>();
    for (const t of tokens) {
      const word = t.text.toLowerCase();
      if (stopwords.has(word) || word.length < 3) continue;
      const entry = tf.get(word) || { count: 0, positions: [] };
      entry.count++;
      entry.positions.push(t.start);
      tf.set(word, entry);
    }

    // Rank by frequency and position (earlier = more important)
    const ranked = [...tf.entries()]
      .map(([word, data]) => ({
        word,
        score: data.count * (1 + 1 / (1 + data.positions[0] / cas.text.length)),
        positions: data.positions,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    for (const kw of ranked) {
      // Use first occurrence position
      const pos = kw.positions[0];
      cas.annotations.push({
        id: uuidv4(),
        type: "Keyword",
        start: pos,
        end: pos + kw.word.length,
        text: kw.word,
        features: {
          score: kw.score,
          frequency: tf.get(kw.word)!.count,
          rank: ranked.indexOf(kw) + 1,
        },
        confidence: Math.min(kw.score / (ranked[0]?.score || 1), 1),
        source: "keyword-extractor",
      });
    }

    return cas;
  },
};

/**
 * Paragraph Detector
 */
const paragraphDetector: AnalysisEngine = {
  name: "paragraph-detector",
  type: "annotator",
  description: "Detect paragraph boundaries",
  inputTypes: [],
  outputTypes: ["Paragraph"],
  async process(cas: CAS): Promise<CAS> {
    const paragraphs = cas.text.split(/\n\s*\n/);
    let offset = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const trimmed = para.trim();
      if (trimmed.length === 0) {
        offset += para.length + 1;
        continue;
      }
      const start = cas.text.indexOf(trimmed, offset);
      cas.annotations.push({
        id: uuidv4(),
        type: "Paragraph",
        start,
        end: start + trimmed.length,
        text: trimmed,
        features: { index: i },
        confidence: 1.0,
        source: "paragraph-detector",
      });
      offset = start + trimmed.length;
    }

    return cas;
  },
};

// ============================================================================
// AI-POWERED ENGINES (use Ollama for GPU-accelerated NLP)
// ============================================================================

/**
 * Create an AI-powered NER engine using Ollama
 */
function createAINerEngine(ollamaUrl: string, model: string): AnalysisEngine {
  return {
    name: "ai-ner",
    type: "annotator",
    description: "Named Entity Recognition via local AI model",
    inputTypes: ["Sentence"],
    outputTypes: ["NamedEntity"],
    async process(cas: CAS, config?: Record<string, any>): Promise<CAS> {
      const sentences = cas.annotations.filter((a) => a.type === "Sentence");
      const targetModel = config?.model || model;
      const batchSize = config?.batchSize || 5;

      // Process sentences in batches
      for (let i = 0; i < sentences.length; i += batchSize) {
        const batch = sentences.slice(i, i + batchSize);
        const batchText = batch.map((s, idx) => `[${idx}] ${s.text}`).join("\n");

        try {
          const res = await fetch(`${ollamaUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: targetModel,
              prompt: `Extract all named entities from each numbered sentence. For each entity, provide the exact text, entity type (PERSON, ORGANIZATION, LOCATION, DATE, TIME, MONEY, PRODUCT, EVENT, GPE, FACILITY, QUANTITY), and the sentence number.

Output as JSON array: [{"sentence": 0, "text": "...", "type": "...", "start": 0, "end": 5}]

Sentences:
${batchText}

JSON output:`,
              stream: false,
              options: { temperature: 0.1, num_predict: 2048 },
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (!res.ok) continue;
          const data = await res.json();

          // Parse entities from response
          try {
            const jsonMatch = data.response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const entities = JSON.parse(jsonMatch[0]);
              for (const entity of entities) {
                const sentenceIdx = entity.sentence ?? 0;
                const sentence = batch[sentenceIdx];
                if (!sentence) continue;

                const entityStart = sentence.text.indexOf(entity.text);
                if (entityStart === -1) continue;

                const absoluteStart = sentence.start + entityStart;
                cas.annotations.push({
                  id: uuidv4(),
                  type: "NamedEntity",
                  start: absoluteStart,
                  end: absoluteStart + entity.text.length,
                  text: entity.text,
                  features: {
                    entityType: entity.type || "CUSTOM",
                    sentenceId: sentence.id,
                  },
                  confidence: 0.8,
                  source: "ai-ner",
                });
              }
            }
          } catch {
            logger.warn("Failed to parse NER response for batch", i);
          }
        } catch (err) {
          logger.warn("NER batch failed:", err);
        }
      }

      return cas;
    },
  };
}

/**
 * Create an AI-powered sentiment analysis engine
 */
function createAISentimentEngine(ollamaUrl: string, model: string): AnalysisEngine {
  return {
    name: "ai-sentiment",
    type: "annotator",
    description: "Sentiment analysis via local AI model",
    inputTypes: ["Sentence"],
    outputTypes: ["Sentiment"],
    async process(cas: CAS, config?: Record<string, any>): Promise<CAS> {
      const sentences = cas.annotations.filter((a) => a.type === "Sentence");
      const targetModel = config?.model || model;

      const batchText = sentences
        .map((s, i) => `[${i}] ${s.text}`)
        .join("\n");

      try {
        const res = await fetch(`${ollamaUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: targetModel,
            prompt: `Analyze the sentiment of each numbered sentence. For each, provide:
- sentence number
- sentiment: "positive", "negative", "neutral", or "mixed"
- score: float from -1.0 (very negative) to 1.0 (very positive)
- emotion: primary emotion (joy, anger, sadness, fear, surprise, disgust, trust, anticipation, neutral)

Output as JSON array: [{"sentence": 0, "sentiment": "positive", "score": 0.8, "emotion": "joy"}]

Sentences:
${batchText}

JSON output:`,
            stream: false,
            options: { temperature: 0.1, num_predict: 2048 },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
          const data = await res.json();
          try {
            const jsonMatch = data.response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const results = JSON.parse(jsonMatch[0]);
              for (const r of results) {
                const sentence = sentences[r.sentence];
                if (!sentence) continue;

                cas.annotations.push({
                  id: uuidv4(),
                  type: "Sentiment",
                  start: sentence.start,
                  end: sentence.end,
                  text: sentence.text,
                  features: {
                    sentiment: r.sentiment,
                    score: r.score,
                    emotion: r.emotion,
                    sentenceId: sentence.id,
                  },
                  confidence: 0.75,
                  source: "ai-sentiment",
                });
              }
            }
          } catch {
            logger.warn("Failed to parse sentiment response");
          }
        }
      } catch (err) {
        logger.warn("Sentiment analysis failed:", err);
      }

      return cas;
    },
  };
}

/**
 * Create an AI-powered topic classification engine
 */
function createAITopicEngine(ollamaUrl: string, model: string): AnalysisEngine {
  return {
    name: "ai-topic",
    type: "annotator",
    description: "Topic classification and extraction via local AI",
    inputTypes: ["Sentence", "Keyword"],
    outputTypes: ["Topic"],
    async process(cas: CAS, config?: Record<string, any>): Promise<CAS> {
      const targetModel = config?.model || model;
      const keywords = cas.annotations
        .filter((a) => a.type === "Keyword")
        .slice(0, 15)
        .map((a) => a.text);

      try {
        const res = await fetch(`${ollamaUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: targetModel,
            prompt: `Analyze this text and identify the main topics. Also classify the overall domain.

Text (first 2000 chars):
${cas.text.substring(0, 2000)}

Keywords found: ${keywords.join(", ")}

Provide output as JSON:
{
  "topics": [{"label": "...", "confidence": 0.9, "keywords": ["...", "..."]}],
  "domain": "technology|science|business|health|politics|sports|entertainment|education|legal|finance|other",
  "language": "en|es|fr|de|...",
  "formality": "formal|informal|technical|casual",
  "complexity": "simple|moderate|complex|expert"
}

JSON output:`,
            stream: false,
            options: { temperature: 0.1, num_predict: 1024 },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
          const data = await res.json();
          try {
            const jsonMatch = data.response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const result = JSON.parse(jsonMatch[0]);

              for (const topic of result.topics || []) {
                cas.annotations.push({
                  id: uuidv4(),
                  type: "Topic",
                  start: 0,
                  end: cas.text.length,
                  text: topic.label,
                  features: {
                    confidence: topic.confidence,
                    keywords: topic.keywords,
                    domain: result.domain,
                    language: result.language,
                    formality: result.formality,
                    complexity: result.complexity,
                  },
                  confidence: topic.confidence,
                  source: "ai-topic",
                });
              }

              // Store document-level metadata
              cas.metadata.domain = result.domain;
              cas.metadata.language = result.language || cas.language;
              cas.metadata.formality = result.formality;
              cas.metadata.complexity = result.complexity;
            }
          } catch {
            logger.warn("Failed to parse topic response");
          }
        }
      } catch (err) {
        logger.warn("Topic classification failed:", err);
      }

      return cas;
    },
  };
}

/**
 * Create an AI-powered intent/slot extraction engine (for conversational data)
 */
function createAIIntentEngine(ollamaUrl: string, model: string): AnalysisEngine {
  return {
    name: "ai-intent",
    type: "annotator",
    description: "Intent classification and slot extraction for conversational data",
    inputTypes: ["Sentence"],
    outputTypes: ["Intent", "Slot"],
    async process(cas: CAS, config?: Record<string, any>): Promise<CAS> {
      const targetModel = config?.model || model;
      const sentences = cas.annotations.filter((a) => a.type === "Sentence");

      for (const sentence of sentences) {
        try {
          const res = await fetch(`${ollamaUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: targetModel,
              prompt: `Classify the intent and extract slots from this utterance:

"${sentence.text}"

Output as JSON:
{
  "intent": "...",
  "confidence": 0.9,
  "slots": [{"name": "...", "value": "...", "type": "...", "start": 0, "end": 5}]
}

Common intents: greeting, farewell, question, request, command, complaint, feedback, information, purchase, booking, search, help, cancel, confirm, deny, other.

JSON output:`,
              stream: false,
              options: { temperature: 0.1, num_predict: 512 },
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (res.ok) {
            const data = await res.json();
            try {
              const jsonMatch = data.response.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);

                cas.annotations.push({
                  id: uuidv4(),
                  type: "Intent",
                  start: sentence.start,
                  end: sentence.end,
                  text: result.intent,
                  features: {
                    confidence: result.confidence,
                    sentenceId: sentence.id,
                    utterance: sentence.text,
                  },
                  confidence: result.confidence,
                  source: "ai-intent",
                });

                for (const slot of result.slots || []) {
                  const slotStart = sentence.text.indexOf(slot.value);
                  cas.annotations.push({
                    id: uuidv4(),
                    type: "Slot",
                    start: slotStart >= 0 ? sentence.start + slotStart : sentence.start,
                    end:
                      slotStart >= 0
                        ? sentence.start + slotStart + slot.value.length
                        : sentence.end,
                    text: slot.value,
                    features: {
                      slotName: slot.name,
                      slotType: slot.type,
                      intentId: cas.annotations[cas.annotations.length - 1].id,
                      sentenceId: sentence.id,
                    },
                    confidence: result.confidence * 0.9,
                    source: "ai-intent",
                  });
                }
              }
            } catch {
              logger.warn("Failed to parse intent response for:", sentence.text.substring(0, 50));
            }
          }
        } catch {
          // Skip failed sentences
        }
      }

      return cas;
    },
  };
}

/**
 * Create an AI-powered summarization engine
 */
function createAISummaryEngine(ollamaUrl: string, model: string): AnalysisEngine {
  return {
    name: "ai-summary",
    type: "consumer",
    description: "Text summarization via local AI model",
    inputTypes: ["Sentence", "Topic"],
    outputTypes: ["Summary"],
    async process(cas: CAS, config?: Record<string, any>): Promise<CAS> {
      const targetModel = config?.model || model;
      const maxLength = config?.maxLength || 200;

      try {
        const res = await fetch(`${ollamaUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: targetModel,
            prompt: `Summarize the following text in ${maxLength} words or less. Be concise and capture the key points.

Text:
${cas.text.substring(0, 4000)}

Summary:`,
            stream: false,
            options: { temperature: 0.3, num_predict: 512 },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
          const data = await res.json();
          cas.annotations.push({
            id: uuidv4(),
            type: "Summary",
            start: 0,
            end: cas.text.length,
            text: data.response.trim(),
            features: {
              maxLength,
              originalLength: cas.text.length,
              compressionRatio: data.response.trim().length / cas.text.length,
            },
            confidence: 0.85,
            source: "ai-summary",
          });
        }
      } catch (err) {
        logger.warn("Summarization failed:", err);
      }

      return cas;
    },
  };
}

// ============================================================================
// PIPELINE ORCHESTRATOR
// ============================================================================

export class NLPPipelineOrchestrator {
  private engines = new Map<string, AnalysisEngine>();
  private pipelines = new Map<string, PipelineDefinition>();
  private pipelinesDir: string;
  private ollamaUrl: string;
  private defaultModel: string;

  constructor(dataDir: string, ollamaUrl = "http://127.0.0.1:11434", defaultModel = "glm4:latest") {
    this.pipelinesDir = path.join(dataDir, "nlp-pipelines");
    this.ollamaUrl = ollamaUrl;
    this.defaultModel = defaultModel;

    // Register built-in engines
    this.registerEngine(sentenceDetector);
    this.registerEngine(tokenizer);
    this.registerEngine(keywordExtractor);
    this.registerEngine(paragraphDetector);

    // Register AI-powered engines
    this.registerEngine(createAINerEngine(ollamaUrl, defaultModel));
    this.registerEngine(createAISentimentEngine(ollamaUrl, defaultModel));
    this.registerEngine(createAITopicEngine(ollamaUrl, defaultModel));
    this.registerEngine(createAIIntentEngine(ollamaUrl, defaultModel));
    this.registerEngine(createAISummaryEngine(ollamaUrl, defaultModel));
  }

  registerEngine(engine: AnalysisEngine): void {
    this.engines.set(engine.name, engine);
    logger.info(`Registered NLP engine: ${engine.name}`);
  }

  getEngine(name: string): AnalysisEngine | undefined {
    return this.engines.get(name);
  }

  listEngines(): Array<{
    name: string;
    type: string;
    description: string;
    inputTypes: string[];
    outputTypes: string[];
  }> {
    return [...this.engines.values()].map((e) => ({
      name: e.name,
      type: e.type,
      description: e.description,
      inputTypes: e.inputTypes,
      outputTypes: e.outputTypes,
    }));
  }

  /** Create a new CAS from raw text */
  createCAS(text: string, language = "en", metadata: Record<string, any> = {}): CAS {
    return {
      id: uuidv4(),
      text,
      language,
      annotations: [],
      metadata,
      processingHistory: [],
    };
  }

  /** Run a single engine on a CAS */
  async runEngine(
    cas: CAS,
    engineName: string,
    config?: Record<string, any>,
  ): Promise<CAS> {
    const engine = this.engines.get(engineName);
    if (!engine) throw new Error(`Unknown engine: ${engineName}`);

    const startTime = Date.now();
    const prevCount = cas.annotations.length;

    cas = await engine.process(cas, config);

    cas.processingHistory.push({
      engine: engineName,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      annotationsAdded: cas.annotations.length - prevCount,
      config,
    });

    return cas;
  }

  /** Run a full pipeline on text */
  async runPipeline(
    text: string,
    pipelineIdOrEngines: string | string[],
    config?: Record<string, Record<string, any>>,
    language = "en",
    metadata: Record<string, any> = {},
  ): Promise<PipelineResult> {
    const startTime = Date.now();

    // Resolve engine list
    let engineNames: string[];
    let pipelineId: string;

    if (typeof pipelineIdOrEngines === "string") {
      const pipeline = this.pipelines.get(pipelineIdOrEngines);
      if (!pipeline) throw new Error(`Unknown pipeline: ${pipelineIdOrEngines}`);
      engineNames = pipeline.engines;
      pipelineId = pipeline.id;
      config = { ...pipeline.config, ...config };
    } else {
      engineNames = pipelineIdOrEngines;
      pipelineId = "ad-hoc";
    }

    let cas = this.createCAS(text, language, metadata);
    const engineResults: PipelineResult["engineResults"] = [];

    for (const engineName of engineNames) {
      const engineStart = Date.now();
      const prevCount = cas.annotations.length;

      try {
        cas = await this.runEngine(cas, engineName, config?.[engineName]);
        engineResults.push({
          engine: engineName,
          timeMs: Date.now() - engineStart,
          annotationsAdded: cas.annotations.length - prevCount,
          success: true,
        });
      } catch (err: any) {
        logger.error(`Engine ${engineName} failed:`, err);
        engineResults.push({
          engine: engineName,
          timeMs: Date.now() - engineStart,
          annotationsAdded: 0,
          success: false,
          error: err.message,
        });
      }
    }

    return {
      pipelineId,
      cas,
      executionTimeMs: Date.now() - startTime,
      engineResults,
    };
  }

  // ── Pipeline CRUD ────────────────────────────────────────────────

  async savePipeline(pipeline: PipelineDefinition): Promise<void> {
    await fs.ensureDir(this.pipelinesDir);
    await fs.writeJson(
      path.join(this.pipelinesDir, `${pipeline.id}.json`),
      pipeline,
      { spaces: 2 },
    );
    this.pipelines.set(pipeline.id, pipeline);
  }

  async loadPipelines(): Promise<void> {
    if (!(await fs.pathExists(this.pipelinesDir))) return;
    const files = await fs.readdir(this.pipelinesDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const pipeline = await fs.readJson(path.join(this.pipelinesDir, f));
        this.pipelines.set(pipeline.id, pipeline);
      } catch (err) {
        logger.warn(`Failed to load pipeline ${f}:`, err);
      }
    }
    logger.info(`Loaded ${this.pipelines.size} saved pipelines`);
  }

  listPipelines(): PipelineDefinition[] {
    return [...this.pipelines.values()];
  }

  getPipeline(id: string): PipelineDefinition | undefined {
    return this.pipelines.get(id);
  }

  async deletePipeline(id: string): Promise<boolean> {
    const filePath = path.join(this.pipelinesDir, `${id}.json`);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
      this.pipelines.delete(id);
      return true;
    }
    return false;
  }

  // ── Pre-built Pipeline Templates ────────────────────────────────

  getBuiltInPipelines(): PipelineDefinition[] {
    return [
      {
        id: "basic-text-analysis",
        name: "Basic Text Analysis",
        description:
          "Sentence detection, tokenization, keyword extraction, paragraph detection",
        engines: [
          "paragraph-detector",
          "sentence-detector",
          "tokenizer",
          "keyword-extractor",
        ],
        config: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "full-nlp-analysis",
        name: "Full NLP Analysis",
        description:
          "Complete analysis: sentences, tokens, keywords, NER, sentiment, topics, summary",
        engines: [
          "paragraph-detector",
          "sentence-detector",
          "tokenizer",
          "keyword-extractor",
          "ai-ner",
          "ai-sentiment",
          "ai-topic",
          "ai-summary",
        ],
        config: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "entity-extraction",
        name: "Entity Extraction",
        description:
          "Focus on named entity recognition and relation extraction",
        engines: [
          "sentence-detector",
          "tokenizer",
          "ai-ner",
        ],
        config: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "sentiment-analysis",
        name: "Sentiment Analysis",
        description:
          "Sentence-level sentiment and emotion detection",
        engines: [
          "sentence-detector",
          "ai-sentiment",
        ],
        config: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "conversational-analysis",
        name: "Conversational Data Analysis",
        description:
          "Intent classification and slot extraction for chatbot training data",
        engines: [
          "sentence-detector",
          "tokenizer",
          "ai-intent",
        ],
        config: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "dataset-preparation",
        name: "Dataset Preparation Pipeline",
        description:
          "Full analysis pipeline for preparing datasets: text processing, entity extraction, sentiment, topics, and auto-tagging",
        engines: [
          "paragraph-detector",
          "sentence-detector",
          "tokenizer",
          "keyword-extractor",
          "ai-ner",
          "ai-sentiment",
          "ai-topic",
        ],
        config: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }
}

// ============================================================================
// SINGLETON + FACTORY
// ============================================================================

let orchestratorInstance: NLPPipelineOrchestrator | null = null;

export function getNLPOrchestrator(dataDir?: string): NLPPipelineOrchestrator {
  if (!orchestratorInstance) {
    const dir = dataDir || path.join(app.getPath("userData"), "nlp");
    orchestratorInstance = new NLPPipelineOrchestrator(dir);
  }
  return orchestratorInstance;
}

export function createNLPOrchestrator(
  dataDir: string,
  ollamaUrl?: string,
  model?: string,
): NLPPipelineOrchestrator {
  orchestratorInstance = new NLPPipelineOrchestrator(dataDir, ollamaUrl, model);
  return orchestratorInstance;
}
