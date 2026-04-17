/**
 * NLP Pipeline & Dataset Marketplace IPC Handlers
 *
 * Exposes the NLP Pipeline Orchestrator to the renderer via IPC,
 * and adds dataset tagging, auto-annotation, and marketplace publishing
 * capabilities to the Dataset Studio.
 *
 * Inspired by UIMA/GATE/CoreNLP/OpenNLP/DKPro/ClearTK architecture.
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, sql } from "drizzle-orm";
import { studioDatasets, datasetItems } from "@/db/schema";
import {
  getNLPOrchestrator,
  createNLPOrchestrator,
  type PipelineDefinition,
  type CAS,
  type PipelineResult,
} from "@/lib/nlp_pipeline_service";

const logger = log.scope("nlp-pipeline-handlers");

// ============================================================================
// Dataset Auto-Tagging Types
// ============================================================================

interface DatasetTag {
  key: string;
  value: string;
  confidence: number;
  source: "nlp" | "manual" | "ai" | "marketplace";
}

interface MarketplaceListingDraft {
  datasetId: string;
  name: string;
  description: string;
  tags: DatasetTag[];
  category: string;
  license: string;
  price: number;
  currency: string;
  previewItemCount: number;
  nlpStats: {
    totalAnnotations: number;
    entityCount: number;
    topicCount: number;
    sentimentDistribution: Record<string, number>;
    languages: string[];
    domains: string[];
  };
}

// ============================================================================
// HANDLER REGISTRATION
// ============================================================================

export function registerNlpPipelineHandlers() {
  logger.info("Registering NLP Pipeline handlers");

  // Initialize orchestrator
  const dataDir = path.join(app.getPath("userData"), "nlp");
  const orchestrator = createNLPOrchestrator(dataDir);

  // Load saved pipelines on startup
  orchestrator.loadPipelines().catch((err) => {
    logger.warn("Failed to load saved pipelines:", err);
  });

  // =========================================================================
  // ENGINE MANAGEMENT
  // =========================================================================

  /** List all available NLP engines */
  ipcMain.handle("nlp:list-engines", async () => {
    return orchestrator.listEngines();
  });

  // =========================================================================
  // PIPELINE MANAGEMENT (DKPro Core-style reusable pipelines)
  // =========================================================================

  /** List all pipelines (saved + built-in templates) */
  ipcMain.handle("nlp:list-pipelines", async () => {
    const saved = orchestrator.listPipelines();
    const builtIn = orchestrator.getBuiltInPipelines();
    return {
      saved,
      builtIn,
      total: saved.length + builtIn.length,
    };
  });

  /** Get a specific pipeline */
  ipcMain.handle("nlp:get-pipeline", async (_, pipelineId: string) => {
    const pipeline = orchestrator.getPipeline(pipelineId);
    if (pipeline) return pipeline;
    // Check built-in
    const builtIn = orchestrator.getBuiltInPipelines().find((p) => p.id === pipelineId);
    return builtIn || null;
  });

  /** Create / save a custom pipeline */
  ipcMain.handle(
    "nlp:save-pipeline",
    async (
      _,
      params: {
        name: string;
        description: string;
        engines: string[];
        config?: Record<string, Record<string, any>>;
        id?: string;
      },
    ) => {
      const pipeline: PipelineDefinition = {
        id: params.id || uuidv4(),
        name: params.name,
        description: params.description,
        engines: params.engines,
        config: params.config || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await orchestrator.savePipeline(pipeline);
      return pipeline;
    },
  );

  /** Delete a custom pipeline */
  ipcMain.handle("nlp:delete-pipeline", async (_, pipelineId: string) => {
    const deleted = await orchestrator.deletePipeline(pipelineId);
    return { success: deleted };
  });

  // =========================================================================
  // TEXT PROCESSING (UIMA CAS-based processing)
  // =========================================================================

  /** Run a pipeline on raw text → get annotated CAS */
  ipcMain.handle(
    "nlp:process-text",
    async (
      _,
      params: {
        text: string;
        pipeline: string | string[];
        config?: Record<string, Record<string, any>>;
        language?: string;
      },
    ) => {
      const result = await orchestrator.runPipeline(
        params.text,
        params.pipeline,
        params.config,
        params.language,
      );
      return result;
    },
  );

  /** Run a single engine on text (quick analysis) */
  ipcMain.handle(
    "nlp:run-engine",
    async (
      _,
      params: {
        text: string;
        engine: string;
        config?: Record<string, any>;
        language?: string;
        existingAnnotations?: any[];
      },
    ) => {
      let cas = orchestrator.createCAS(params.text, params.language);
      if (params.existingAnnotations) {
        cas.annotations = params.existingAnnotations;
      }
      cas = await orchestrator.runEngine(cas, params.engine, params.config);
      return cas;
    },
  );

  // =========================================================================
  // DATASET NLP PROCESSING
  // Apply NLP pipelines to entire datasets for auto-tagging/annotation
  // =========================================================================

  /** Process all items in a dataset through an NLP pipeline */
  ipcMain.handle(
    "nlp:process-dataset",
    async (
      _,
      params: {
        datasetId: string;
        pipeline: string | string[];
        config?: Record<string, Record<string, any>>;
        batchSize?: number;
        maxItems?: number;
      },
    ) => {
      const { datasetId, pipeline, config, batchSize = 10, maxItems } = params;
      logger.info(`Processing dataset ${datasetId} with NLP pipeline`);

      // Verify dataset exists
      const [dataset] = await db
        .select()
        .from(studioDatasets)
        .where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

      // Get text items
      const items = await db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));

      const textItems = items.filter((i) => i.modality === "text");
      const toProcess = maxItems ? textItems.slice(0, maxItems) : textItems;

      const results: Array<{
        itemId: string;
        success: boolean;
        annotationCount: number;
        tags: DatasetTag[];
        error?: string;
      }> = [];

      const contentStoreDir = path.join(app.getPath("userData"), "content-store");

      for (let i = 0; i < toProcess.length; i += batchSize) {
        const batch = toProcess.slice(i, i + batchSize);

        for (const item of batch) {
          try {
            // Read item content
            let text: string;
            if (item.contentHash) {
              const prefix = item.contentHash.substring(0, 2);
              const filePath = path.join(contentStoreDir, prefix, item.contentHash);
              if (await fs.pathExists(filePath)) {
                text = await fs.readFile(filePath, "utf-8");
              } else {
                text = "";
              }
            } else {
              text = "";
            }

            if (!text) {
              results.push({
                itemId: item.id,
                success: false,
                annotationCount: 0,
                tags: [],
                error: "Empty content",
              });
              continue;
            }

            // Run pipeline
            const pipelineResult = await orchestrator.runPipeline(text, pipeline, config);

            // Extract tags from annotations
            const tags = extractTagsFromCAS(pipelineResult.cas);

            // Store NLP results in item labels
            const existingLabels = (item.labelsJson as Record<string, any>) || {};
            const updatedLabels = {
              ...existingLabels,
              nlp_tags: tags,
              nlp_annotations_count: pipelineResult.cas.annotations.length,
              nlp_entities: pipelineResult.cas.annotations
                .filter((a) => a.type === "NamedEntity")
                .map((a) => ({ text: a.text, type: a.features.entityType })),
              nlp_sentiment: pipelineResult.cas.annotations
                .filter((a) => a.type === "Sentiment")
                .map((a) => ({
                  sentiment: a.features.sentiment,
                  score: a.features.score,
                  emotion: a.features.emotion,
                })),
              nlp_topics: pipelineResult.cas.annotations
                .filter((a) => a.type === "Topic")
                .map((a) => ({
                  label: a.text,
                  confidence: a.features.confidence,
                })),
              nlp_keywords: pipelineResult.cas.annotations
                .filter((a) => a.type === "Keyword")
                .slice(0, 10)
                .map((a) => a.text),
              nlp_processed_at: new Date().toISOString(),
            };

            await db
              .update(datasetItems)
              .set({ labelsJson: updatedLabels })
              .where(eq(datasetItems.id, item.id));

            results.push({
              itemId: item.id,
              success: true,
              annotationCount: pipelineResult.cas.annotations.length,
              tags,
            });
          } catch (err: any) {
            logger.warn(`Failed to process item ${item.id}:`, err);
            results.push({
              itemId: item.id,
              success: false,
              annotationCount: 0,
              tags: [],
              error: err.message,
            });
          }
        }
      }

      // Update dataset-level metadata
      const allTags = results.flatMap((r) => r.tags);
      const datasetTags = aggregateDatasetTags(allTags);

      const existingMeta = (dataset.metadata as Record<string, any>) || {};
      await db
        .update(studioDatasets)
        .set({
          metadata: {
            ...existingMeta,
            nlp_tags: datasetTags,
            nlp_processed_items: results.filter((r) => r.success).length,
            nlp_total_annotations: results.reduce((sum, r) => sum + r.annotationCount, 0),
            nlp_processed_at: new Date().toISOString(),
          },
        })
        .where(eq(studioDatasets.id, datasetId));

      const successCount = results.filter((r) => r.success).length;
      logger.info(
        `Dataset ${datasetId}: ${successCount}/${toProcess.length} items processed, ` +
          `${results.reduce((s, r) => s + r.annotationCount, 0)} total annotations`,
      );

      return {
        datasetId,
        totalItems: toProcess.length,
        processed: successCount,
        failed: results.filter((r) => !r.success).length,
        totalAnnotations: results.reduce((s, r) => s + r.annotationCount, 0),
        datasetTags,
        results,
      };
    },
  );

  // =========================================================================
  // DATASET TAGGING FOR MARKETPLACE
  // =========================================================================

  /** Auto-tag a dataset based on NLP analysis results */
  ipcMain.handle(
    "nlp:auto-tag-dataset",
    async (
      _,
      params: {
        datasetId: string;
        includeEntities?: boolean;
        includeTopics?: boolean;
        includeSentiment?: boolean;
        includeKeywords?: boolean;
        customTags?: Array<{ key: string; value: string }>;
      },
    ) => {
      const { datasetId } = params;

      // Get all items with NLP labels
      const items = await db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));

      const tags: DatasetTag[] = [];

      for (const item of items) {
        const labels = (item.labelsJson as any) || {};

        if (params.includeEntities !== false && labels.nlp_entities) {
          for (const entity of labels.nlp_entities) {
            tags.push({
              key: `entity:${entity.type}`,
              value: entity.text,
              confidence: 0.8,
              source: "nlp",
            });
          }
        }

        if (params.includeTopics !== false && labels.nlp_topics) {
          for (const topic of labels.nlp_topics) {
            tags.push({
              key: "topic",
              value: topic.label,
              confidence: topic.confidence,
              source: "nlp",
            });
          }
        }

        if (params.includeSentiment !== false && labels.nlp_sentiment) {
          for (const sent of labels.nlp_sentiment) {
            tags.push({
              key: "sentiment",
              value: sent.sentiment,
              confidence: Math.abs(sent.score),
              source: "nlp",
            });
          }
        }

        if (params.includeKeywords !== false && labels.nlp_keywords) {
          for (const kw of labels.nlp_keywords) {
            tags.push({
              key: "keyword",
              value: kw,
              confidence: 0.7,
              source: "nlp",
            });
          }
        }
      }

      // Add custom tags
      if (params.customTags) {
        for (const ct of params.customTags) {
          tags.push({ key: ct.key, value: ct.value, confidence: 1.0, source: "manual" });
        }
      }

      // Aggregate and deduplicate
      const aggregated = aggregateDatasetTags(tags);

      // Save to dataset
      const [dataset] = await db
        .select()
        .from(studioDatasets)
        .where(eq(studioDatasets.id, datasetId));

      if (dataset) {
        const meta = (dataset.metadata as Record<string, any>) || {};
        await db
          .update(studioDatasets)
          .set({
            metadata: {
              ...meta,
              marketplace_tags: aggregated,
              tagged_at: new Date().toISOString(),
            },
          })
          .where(eq(studioDatasets.id, datasetId));
      }

      return {
        datasetId,
        tagCount: aggregated.length,
        tags: aggregated,
      };
    },
  );

  /** Prepare a dataset for marketplace listing */
  ipcMain.handle(
    "nlp:prepare-marketplace-listing",
    async (
      _,
      params: {
        datasetId: string;
        name?: string;
        description?: string;
        category?: string;
        license?: string;
        price?: number;
        currency?: string;
        previewItemCount?: number;
      },
    ) => {
      const { datasetId } = params;

      const [dataset] = await db
        .select()
        .from(studioDatasets)
        .where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

      const items = await db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));

      const meta = (dataset.metadata as Record<string, any>) || {};

      // Compute NLP stats from items
      const allEntities: string[] = [];
      const allTopics: string[] = [];
      const sentimentDist: Record<string, number> = {};
      const languages = new Set<string>();
      const domains = new Set<string>();

      for (const item of items) {
        const labels = (item.labelsJson as any) || {};
        if (labels.nlp_entities) {
          allEntities.push(...labels.nlp_entities.map((e: any) => e.type));
        }
        if (labels.nlp_topics) {
          allTopics.push(...labels.nlp_topics.map((t: any) => t.label));
        }
        if (labels.nlp_sentiment) {
          for (const s of labels.nlp_sentiment) {
            sentimentDist[s.sentiment] = (sentimentDist[s.sentiment] || 0) + 1;
          }
        }
      }

      if (meta.nlp_tags) {
        for (const tag of meta.nlp_tags as DatasetTag[]) {
          if (tag.key === "topic" && tag.value) {
            // Extract domain from topics
            domains.add(tag.value.split("/")[0] || tag.value);
          }
        }
      }

      languages.add(dataset.language || "en");

      const draft: MarketplaceListingDraft = {
        datasetId,
        name: params.name || dataset.name,
        description:
          params.description ||
          `${dataset.name} — ${items.length} items, NLP-analyzed with entity extraction, ` +
            `sentiment analysis, and topic classification. Ready for AI model training.`,
        tags: meta.marketplace_tags || meta.nlp_tags || [],
        category: params.category || (meta.nlp_tags?.[0]?.value as string) || "dataset",
        license: params.license || dataset.license || "CC-BY-4.0",
        price: params.price ?? 0,
        currency: params.currency || "MATIC",
        previewItemCount: params.previewItemCount || Math.min(5, items.length),
        nlpStats: {
          totalAnnotations: meta.nlp_total_annotations || 0,
          entityCount: allEntities.length,
          topicCount: [...new Set(allTopics)].length,
          sentimentDistribution: sentimentDist,
          languages: [...languages],
          domains: [...domains],
        },
      };

      // Save draft
      const draftsDir = path.join(app.getPath("userData"), "marketplace-drafts");
      await fs.ensureDir(draftsDir);
      await fs.writeJson(path.join(draftsDir, `${datasetId}.json`), draft, { spaces: 2 });

      return draft;
    },
  );

  /** Publish dataset to Joy Marketplace (creates on-chain listing) */
  ipcMain.handle(
    "nlp:publish-dataset",
    async (
      _,
      params: {
        datasetId: string;
        draft?: MarketplaceListingDraft;
      },
    ) => {
      const { datasetId } = params;

      // Load draft
      let draft = params.draft;
      if (!draft) {
        const draftsDir = path.join(app.getPath("userData"), "marketplace-drafts");
        const draftPath = path.join(draftsDir, `${datasetId}.json`);
        if (await fs.pathExists(draftPath)) {
          draft = await fs.readJson(draftPath);
        }
      }
      if (!draft) throw new Error("No marketplace listing draft found. Run prepare-marketplace-listing first.");

      // Export dataset to publishable format
      const exportsDir = path.join(app.getPath("userData"), "marketplace-exports");
      await fs.ensureDir(exportsDir);
      const exportDir = path.join(exportsDir, datasetId);
      await fs.ensureDir(exportDir);

      // Write listing manifest
      const manifest = {
        ...draft,
        publishedAt: new Date().toISOString(),
        version: "1.0.0",
        format: "jsonl",
        platform: "joy-marketplace",
      };
      await fs.writeJson(path.join(exportDir, "listing.json"), manifest, { spaces: 2 });

      // Write preview items
      const items = await db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));

      const previewItems = items.slice(0, draft.previewItemCount).map((item) => ({
        id: item.id,
        modality: item.modality,
        labels: item.labelsJson,
        quality: item.qualitySignalsJson,
        license: item.license,
      }));
      await fs.writeJson(path.join(exportDir, "preview.json"), previewItems, { spaces: 2 });

      logger.info(`Dataset ${datasetId} published to ${exportDir}`);

      return {
        success: true,
        datasetId,
        exportDir,
        manifest,
        message: `Dataset "${draft.name}" ready for marketplace listing. ` +
          `${items.length} items with ${draft.nlpStats.totalAnnotations} NLP annotations.`,
      };
    },
  );

  // =========================================================================
  // AI MODEL CREATION HELPERS
  // =========================================================================

  /** Analyze a dataset to recommend suitable model architectures */
  ipcMain.handle(
    "nlp:recommend-model",
    async (_, datasetId: string) => {
      const [dataset] = await db
        .select()
        .from(studioDatasets)
        .where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

      const items = await db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));

      const meta = (dataset.metadata as Record<string, any>) || {};
      const modalities = [...new Set(items.map((i) => i.modality))];
      const itemCount = items.length;
      const tags = (meta.nlp_tags || []) as DatasetTag[];
      const hasEntities = tags.some((t) => t.key.startsWith("entity:"));
      const hasSentiment = tags.some((t) => t.key === "sentiment");
      const hasTopics = tags.some((t) => t.key === "topic");
      const hasIntents = items.some((i) =>
        ((i.labelsJson as any) || {}).nlp_annotations_count > 0,
      );

      const recommendations: Array<{
        task: string;
        architecture: string;
        description: string;
        baseModel: string;
        estimatedTrainingTime: string;
        suitability: number;
      }> = [];

      // Recommend based on data characteristics
      if (hasEntities) {
        recommendations.push({
          task: "Named Entity Recognition",
          architecture: "Token Classification (LoRA fine-tune)",
          description: "Train a model to extract entities like persons, orgs, locations from text",
          baseModel: "meta-llama/Llama-3.2-3B",
          estimatedTrainingTime: itemCount < 1000 ? "15-30 min" : "1-2 hours",
          suitability: 0.9,
        });
      }

      if (hasSentiment) {
        recommendations.push({
          task: "Sentiment Analysis",
          architecture: "Sequence Classification (LoRA fine-tune)",
          description: "Train a model to classify text sentiment and emotions",
          baseModel: "meta-llama/Llama-3.2-1B",
          estimatedTrainingTime: itemCount < 1000 ? "10-20 min" : "30-60 min",
          suitability: 0.85,
        });
      }

      if (hasTopics) {
        recommendations.push({
          task: "Topic Classification",
          architecture: "Multi-label Classification (LoRA fine-tune)",
          description: "Train a model to categorize text into topics",
          baseModel: "meta-llama/Llama-3.2-3B",
          estimatedTrainingTime: itemCount < 1000 ? "15-30 min" : "1-2 hours",
          suitability: 0.85,
        });
      }

      // General recommendations
      if (modalities.includes("text") && itemCount >= 50) {
        recommendations.push({
          task: "Text Generation / Instruction Following",
          architecture: "Causal LM (QLoRA fine-tune)",
          description: "Fine-tune a language model on your dataset for instruction following",
          baseModel: "meta-llama/Llama-3.2-3B",
          estimatedTrainingTime: itemCount < 500 ? "30 min - 1 hour" : "2-4 hours",
          suitability: 0.8,
        });
      }

      if (itemCount >= 100) {
        recommendations.push({
          task: "Embedding Model",
          architecture: "Contrastive Learning (sentence-transformers)",
          description: "Train a custom embedding model for semantic search on your domain",
          baseModel: "nomic-ai/nomic-embed-text-v1.5",
          estimatedTrainingTime: "1-2 hours",
          suitability: 0.7,
        });
      }

      return {
        datasetId,
        itemCount,
        modalities,
        recommendations: recommendations.sort((a, b) => b.suitability - a.suitability),
      };
    },
  );

  logger.info("NLP Pipeline handlers registered");
}

// ============================================================================
// HELPERS
// ============================================================================

function extractTagsFromCAS(cas: CAS): DatasetTag[] {
  const tags: DatasetTag[] = [];

  // Extract entity tags
  for (const a of cas.annotations.filter((a) => a.type === "NamedEntity")) {
    tags.push({
      key: `entity:${a.features.entityType}`,
      value: a.text,
      confidence: a.confidence || 0.8,
      source: "nlp",
    });
  }

  // Extract topic tags
  for (const a of cas.annotations.filter((a) => a.type === "Topic")) {
    tags.push({
      key: "topic",
      value: a.text,
      confidence: a.confidence || 0.7,
      source: "nlp",
    });
  }

  // Extract sentiment tags
  for (const a of cas.annotations.filter((a) => a.type === "Sentiment")) {
    tags.push({
      key: "sentiment",
      value: a.features.sentiment,
      confidence: a.confidence || 0.7,
      source: "nlp",
    });
  }

  // Extract keyword tags
  for (const a of cas.annotations.filter((a) => a.type === "Keyword").slice(0, 10)) {
    tags.push({
      key: "keyword",
      value: a.text,
      confidence: a.confidence || 0.6,
      source: "nlp",
    });
  }

  // Domain tag
  if (cas.metadata.domain) {
    tags.push({
      key: "domain",
      value: cas.metadata.domain,
      confidence: 0.8,
      source: "nlp",
    });
  }

  // Language tag
  if (cas.metadata.language) {
    tags.push({
      key: "language",
      value: cas.metadata.language,
      confidence: 0.9,
      source: "nlp",
    });
  }

  return tags;
}

function aggregateDatasetTags(tags: DatasetTag[]): DatasetTag[] {
  // Deduplicate by key+value, keeping highest confidence
  const map = new Map<string, DatasetTag>();

  for (const tag of tags) {
    const key = `${tag.key}:${tag.value.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || tag.confidence > existing.confidence) {
      map.set(key, { ...tag, value: tag.value });
    }
  }

  // Sort by confidence descending, limit to top 50
  return [...map.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 50);
}
