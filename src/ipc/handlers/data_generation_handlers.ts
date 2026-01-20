/**
 * Data Generation Handlers
 * Synthetic and hybrid data generation for datasets
 * 
 * Features:
 * - Synthetic text generation using LLMs
 * - Image generation prompts and pipelines
 * - Conversation/dialogue generation
 * - Q&A pair generation
 * - Data augmentation
 * - Template-based generation
 * - Hybrid data mixing
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, sql } from "drizzle-orm";
import {
  datasetItems,
  studioDatasets,
  datasetGenerationJobs,
  provenanceRecords,
  type ItemLineage,
} from "@/db/schema";

const logger = log.scope("data_generation");

// ============================================================================
// Types
// ============================================================================

interface GenerationTemplate {
  id: string;
  name: string;
  description: string;
  type: "text" | "conversation" | "qa" | "instruction" | "classification" | "code" | "custom";
  promptTemplate: string;
  outputSchema?: Record<string, any>;
  variables: string[];
  examples?: any[];
  createdAt: Date;
  updatedAt: Date;
}

interface GenerationConfig {
  templateId?: string;
  promptTemplate?: string;
  model: string;
  provider: "local" | "openai" | "anthropic" | "together" | "custom";
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  systemPrompt?: string;
  batchSize?: number;
  totalCount: number;
  variableSource?: {
    type: "static" | "dataset" | "file" | "function";
    data?: any;
    datasetId?: string;
    filePath?: string;
  };
}

interface AugmentationConfig {
  type: "paraphrase" | "backtranslate" | "synonym" | "noise" | "shuffle" | "mask" | "expand" | "summarize";
  params?: Record<string, any>;
  model?: string;
  provider?: string;
}

interface HybridMixConfig {
  sources: Array<{
    type: "synthetic" | "scraped" | "imported" | "generated";
    datasetId?: string;
    percentage: number;
    filters?: Record<string, any>;
  }>;
  shuffle?: boolean;
  deduplicateBy?: "content" | "hash" | "semantic";
  balanceBy?: string; // Field to balance distribution
}

interface GenerationJobState {
  id: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  progress: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  errors: Array<{ index: number; error: string }>;
  startedAt?: Date;
  completedAt?: Date;
}

// ============================================================================
// Storage
// ============================================================================

let templatesDir: string;
let templates: Map<string, GenerationTemplate> = new Map();
let activeJobs: Map<string, GenerationJobState> = new Map();

function getContentStoreDir(): string {
  return path.join(app.getPath("userData"), "content-store");
}

async function initializeGenerationStorage() {
  templatesDir = path.join(app.getPath("userData"), "generation-templates");
  await fs.ensureDir(templatesDir);
  
  // Load templates
  const templatesFile = path.join(templatesDir, "templates.json");
  if (await fs.pathExists(templatesFile)) {
    const data = await fs.readJson(templatesFile);
    templates = new Map(Object.entries(data));
  } else {
    // Initialize with default templates
    initializeDefaultTemplates();
  }
}

async function saveTemplates() {
  const templatesFile = path.join(templatesDir, "templates.json");
  await fs.writeJson(templatesFile, Object.fromEntries(templates), { spaces: 2 });
}

function initializeDefaultTemplates() {
  const defaults: GenerationTemplate[] = [
    {
      id: "qa-pair",
      name: "Q&A Pair Generator",
      description: "Generate question-answer pairs from context",
      type: "qa",
      promptTemplate: `Based on the following context, generate a question and its answer.

Context: {{context}}

Generate a JSON object with "question" and "answer" fields.`,
      outputSchema: { question: "string", answer: "string" },
      variables: ["context"],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "conversation",
      name: "Conversation Generator",
      description: "Generate multi-turn conversations",
      type: "conversation",
      promptTemplate: `Generate a realistic conversation between {{participants}} about {{topic}}.

The conversation should be {{turns}} turns long and have a {{tone}} tone.

Output as JSON array with objects containing "speaker" and "message" fields.`,
      outputSchema: { conversation: [{ speaker: "string", message: "string" }] },
      variables: ["participants", "topic", "turns", "tone"],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "instruction-following",
      name: "Instruction-Following Pair",
      description: "Generate instruction and response pairs for fine-tuning",
      type: "instruction",
      promptTemplate: `Generate an instruction-following example for the domain: {{domain}}

The instruction should be about: {{task_type}}
Difficulty level: {{difficulty}}

Output as JSON with "instruction", "input" (optional context), and "output" fields.`,
      outputSchema: { instruction: "string", input: "string", output: "string" },
      variables: ["domain", "task_type", "difficulty"],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "text-classification",
      name: "Classification Data Generator",
      description: "Generate text with classification labels",
      type: "classification",
      promptTemplate: `Generate a {{category}} text example for classification.

The text should be a {{text_type}} that clearly belongs to the "{{label}}" category.
Length: approximately {{length}} words.

Output as JSON with "text" and "label" fields.`,
      outputSchema: { text: "string", label: "string" },
      variables: ["category", "text_type", "label", "length"],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "code-generation",
      name: "Code Generation Pair",
      description: "Generate code problems and solutions",
      type: "code",
      promptTemplate: `Generate a coding problem and solution in {{language}}.

Topic: {{topic}}
Difficulty: {{difficulty}}
Include: {{requirements}}

Output as JSON with "problem", "solution", "explanation", and "test_cases" fields.`,
      outputSchema: { problem: "string", solution: "string", explanation: "string", test_cases: "array" },
      variables: ["language", "topic", "difficulty", "requirements"],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "paraphrase",
      name: "Paraphrase Generator",
      description: "Generate paraphrased versions of text",
      type: "text",
      promptTemplate: `Paraphrase the following text while maintaining its meaning:

Original: {{text}}

Generate {{count}} different paraphrased versions.
Style: {{style}}

Output as JSON array of paraphrased strings.`,
      outputSchema: { paraphrases: ["string"] },
      variables: ["text", "count", "style"],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  
  for (const template of defaults) {
    templates.set(template.id, template);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function fillTemplate(template: string, variables: Record<string, any>): string {
  let filled = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    filled = filled.replace(regex, String(value));
  }
  return filled;
}

async function storeContent(content: string): Promise<{ hash: string; size: number }> {
  const contentBuffer = Buffer.from(content, "utf-8");
  const hash = crypto.createHash("sha256").update(contentBuffer).digest("hex");
  
  const storeDir = getContentStoreDir();
  const prefix = hash.substring(0, 2);
  const contentDir = path.join(storeDir, prefix);
  await fs.ensureDir(contentDir);
  
  const contentPath = path.join(contentDir, hash);
  if (!(await fs.pathExists(contentPath))) {
    await fs.writeFile(contentPath, contentBuffer);
  }
  
  return { hash, size: contentBuffer.length };
}

// Internal augmentation function (to avoid recursive IPC calls)
async function augmentItemInternal(itemId: string, config: AugmentationConfig): Promise<string> {
  // Get original item
  const [item] = await db.select().from(datasetItems).where(eq(datasetItems.id, itemId));
  if (!item) throw new Error("Item not found");
  
  // Load content
  const storeDir = getContentStoreDir();
  const prefix = item.contentHash.substring(0, 2);
  const contentPath = path.join(storeDir, prefix, item.contentHash);
  const originalContent = await fs.readFile(contentPath, "utf-8");
  
  // Apply augmentation (placeholder - would use actual LLM/transformations)
  let augmentedContent: string;
  
  switch (config.type) {
    case "paraphrase":
      augmentedContent = `[Paraphrased] ${originalContent}`;
      break;
    case "expand":
      augmentedContent = `[Expanded] ${originalContent}\n\nAdditional details...`;
      break;
    case "summarize":
      augmentedContent = `[Summary] ${originalContent.substring(0, 100)}...`;
      break;
    case "noise":
      // Add random character noise
      augmentedContent = originalContent.split("").map(c => 
        Math.random() < 0.02 ? c + String.fromCharCode(97 + Math.floor(Math.random() * 26)) : c
      ).join("");
      break;
    default:
      augmentedContent = originalContent;
  }
  
  // Store augmented version
  return await createDatasetItem({
    datasetId: item.datasetId,
    content: augmentedContent,
    sourceType: "generated",
    generator: config.model ? "provider_api" : "local_model",
    lineage: null,
  });
}

async function createDatasetItem(args: {
  datasetId: string;
  content: string;
  sourceType: "generated" | "scraped" | "api";
  generator?: string;
  lineage?: ItemLineage | null;
  labels?: Record<string, any>;
}): Promise<string> {
  const { datasetId, content, sourceType, generator, lineage, labels } = args;
  
  const { hash, size } = await storeContent(content);
  const itemId = uuidv4();
  const contentUri = `content://${hash}`;
  
  await db.insert(datasetItems).values({
    id: itemId,
    datasetId,
    modality: "text",
    contentHash: hash,
    byteSize: size,
    sourceType,
    generator: generator as any,
    lineageJson: lineage ?? null,
    labelsJson: labels as any,
    contentUri,
    license: "synthetic",
    split: "unassigned",
  });
  
  // Record provenance
  await db.insert(provenanceRecords).values({
    id: uuidv4(),
    itemId,
    action: "generated",
    actorType: generator === "local_model" ? "local_model" : "remote_api",
    actorId: generator,
    outputHash: hash,
    parametersJson: { generator, sourceType } as any,
    timestamp: new Date(),
  });
  
  return itemId;
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerDataGenerationHandlers() {
  logger.info("Registering Data Generation handlers");

  app.whenReady().then(() => {
    initializeGenerationStorage().catch(err => {
      logger.error("Failed to initialize generation storage:", err);
    });
  });

  // ========== Templates ==========

  /**
   * List generation templates
   */
  ipcMain.handle("generation:list-templates", async () => {
    try {
      return { success: true, templates: Array.from(templates.values()) };
    } catch (error) {
      logger.error("List templates failed:", error);
      throw error;
    }
  });

  /**
   * Get template by ID
   */
  ipcMain.handle("generation:get-template", async (_event, templateId: string) => {
    try {
      const template = templates.get(templateId);
      if (!template) throw new Error("Template not found");
      return { success: true, template };
    } catch (error) {
      logger.error("Get template failed:", error);
      throw error;
    }
  });

  /**
   * Create custom template
   */
  ipcMain.handle("generation:create-template", async (_event, template: Omit<GenerationTemplate, "id" | "createdAt" | "updatedAt">) => {
    try {
      const newTemplate: GenerationTemplate = {
        ...template,
        id: uuidv4(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      templates.set(newTemplate.id, newTemplate);
      await saveTemplates();
      
      return { success: true, template: newTemplate };
    } catch (error) {
      logger.error("Create template failed:", error);
      throw error;
    }
  });

  /**
   * Update template
   */
  ipcMain.handle("generation:update-template", async (_event, templateId: string, updates: Partial<GenerationTemplate>) => {
    try {
      const template = templates.get(templateId);
      if (!template) throw new Error("Template not found");
      
      const updated = { ...template, ...updates, id: template.id, updatedAt: new Date() };
      templates.set(templateId, updated);
      await saveTemplates();
      
      return { success: true, template: updated };
    } catch (error) {
      logger.error("Update template failed:", error);
      throw error;
    }
  });

  /**
   * Delete template
   */
  ipcMain.handle("generation:delete-template", async (_event, templateId: string) => {
    try {
      if (!templates.has(templateId)) throw new Error("Template not found");
      templates.delete(templateId);
      await saveTemplates();
      return { success: true };
    } catch (error) {
      logger.error("Delete template failed:", error);
      throw error;
    }
  });

  // ========== Generation ==========

  /**
   * Generate single item
   */
  ipcMain.handle("generation:generate-single", async (_event, args: {
    datasetId: string;
    config: GenerationConfig;
    variables: Record<string, any>;
  }) => {
    try {
      const { datasetId, config, variables } = args;
      
      // Get template or use inline prompt
      let promptTemplate = config.promptTemplate;
      if (config.templateId) {
        const template = templates.get(config.templateId);
        if (!template) throw new Error("Template not found");
        promptTemplate = template.promptTemplate;
      }
      
      if (!promptTemplate) throw new Error("No prompt template provided");
      
      // Fill template
      const prompt = fillTemplate(promptTemplate, variables);
      
      // Call LLM (this would integrate with your existing LLM infrastructure)
      // For now, we'll create a placeholder that shows the structure
      const generatedContent = JSON.stringify({
        prompt,
        model: config.model,
        provider: config.provider,
        generated: true,
        timestamp: new Date().toISOString(),
        // In production, this would be the actual LLM response
      }, null, 2);
      
      // Store the generated item
      const itemId = await createDatasetItem({
        datasetId,
        content: generatedContent,
        sourceType: "generated",
        generator: config.provider === "local" ? "local_model" : "provider_api",
        lineage: null,
      });
      
      return { success: true, itemId, content: generatedContent };
    } catch (error) {
      logger.error("Generate single failed:", error);
      throw error;
    }
  });

  /**
   * Start batch generation job
   */
  ipcMain.handle("generation:start-batch", async (event, args: {
    datasetId: string;
    config: GenerationConfig;
    variablesList: Array<Record<string, any>>;
  }) => {
    try {
      const { datasetId, config, variablesList } = args;
      const jobId = uuidv4();
      
      // Create job state
      const jobState: GenerationJobState = {
        id: jobId,
        status: "running",
        progress: 0,
        totalItems: variablesList.length,
        completedItems: 0,
        failedItems: 0,
        errors: [],
        startedAt: new Date(),
      };
      activeJobs.set(jobId, jobState);
      
      // Record job in database
      await db.insert(datasetGenerationJobs).values({
        id: jobId,
        datasetId,
        jobType: "text_generation",
        configJson: config as any,
        providerType: config.provider === "local" ? "local" : "remote",
        providerId: config.provider,
        modelId: config.model,
        status: "running",
        progress: 0,
        totalItems: variablesList.length,
        completedItems: 0,
        failedItems: 0,
        createdAt: new Date(),
        startedAt: new Date(),
      });
      
      // Process in background
      (async () => {
        let promptTemplate = config.promptTemplate;
        if (config.templateId) {
          const template = templates.get(config.templateId);
          if (template) promptTemplate = template.promptTemplate;
        }
        
        for (let i = 0; i < variablesList.length; i++) {
          const job = activeJobs.get(jobId);
          if (!job || job.status === "cancelled" || job.status === "paused") break;
          
          try {
            const variables = variablesList[i];
            const prompt = fillTemplate(promptTemplate || "", variables);
            
            // Generate content (placeholder - would call actual LLM)
            const generatedContent = JSON.stringify({
              index: i,
              prompt,
              model: config.model,
              variables,
              generated: true,
            }, null, 2);
            
            await createDatasetItem({
              datasetId,
              content: generatedContent,
              sourceType: "generated",
              generator: config.provider === "local" ? "local_model" : "provider_api",
              lineage: null,
            });
            
            job.completedItems++;
          } catch (err) {
            const job = activeJobs.get(jobId);
            if (job) {
              job.failedItems++;
              job.errors.push({ index: i, error: err instanceof Error ? err.message : String(err) });
            }
          }
          
          // Update progress
          const currentJob = activeJobs.get(jobId);
          if (currentJob) {
            currentJob.progress = Math.round(((i + 1) / variablesList.length) * 100);
            
            // Send progress update
            event.sender.send("generation:batch-progress", {
              jobId,
              progress: currentJob.progress,
              completed: currentJob.completedItems,
              failed: currentJob.failedItems,
              total: currentJob.totalItems,
            });
          }
        }
        
        // Mark completed
        const finalJob = activeJobs.get(jobId);
        if (finalJob && finalJob.status === "running") {
          finalJob.status = "completed";
          finalJob.completedAt = new Date();
          
          await db.update(datasetGenerationJobs)
            .set({
              status: "completed",
              progress: 100,
              completedItems: finalJob.completedItems,
              failedItems: finalJob.failedItems,
              completedAt: new Date(),
            })
            .where(eq(datasetGenerationJobs.id, jobId));
        }
      })();
      
      return { success: true, jobId };
    } catch (error) {
      logger.error("Start batch generation failed:", error);
      throw error;
    }
  });

  /**
   * Get generation job status
   */
  ipcMain.handle("generation:get-job-status", async (_event, jobId: string) => {
    try {
      const job = activeJobs.get(jobId);
      if (job) {
        return { success: true, job };
      }
      
      // Check database
      const [dbJob] = await db.select().from(datasetGenerationJobs).where(eq(datasetGenerationJobs.id, jobId));
      if (dbJob) {
        return {
          success: true,
          job: {
            id: dbJob.id,
            status: dbJob.status,
            progress: dbJob.progress,
            totalItems: dbJob.totalItems,
            completedItems: dbJob.completedItems,
            failedItems: dbJob.failedItems,
            errors: [],
            startedAt: dbJob.startedAt,
            completedAt: dbJob.completedAt,
          },
        };
      }
      
      throw new Error("Job not found");
    } catch (error) {
      logger.error("Get job status failed:", error);
      throw error;
    }
  });

  /**
   * Cancel generation job
   */
  ipcMain.handle("generation:cancel-job", async (_event, jobId: string) => {
    try {
      const job = activeJobs.get(jobId);
      if (job) {
        job.status = "cancelled";
      }
      
      await db.update(datasetGenerationJobs)
        .set({ status: "cancelled" })
        .where(eq(datasetGenerationJobs.id, jobId));
      
      return { success: true };
    } catch (error) {
      logger.error("Cancel job failed:", error);
      throw error;
    }
  });

  // ========== Augmentation ==========

  /**
   * Augment existing data
   */
  /**
   * Augment existing data
   */
  ipcMain.handle("generation:augment-item", async (_event, args: {
    itemId: string;
    config: AugmentationConfig;
  }) => {
    try {
      const { itemId, config } = args;
      const newItemId = await augmentItemInternal(itemId, config);
      return { success: true, itemId: newItemId };
    } catch (error) {
      logger.error("Augment item failed:", error);
      throw error;
    }
  });

  /**
   * Batch augment dataset
   */
  ipcMain.handle("generation:augment-dataset", async (event, args: {
    datasetId: string;
    config: AugmentationConfig;
    multiplier?: number;
  }) => {
    try {
      const { datasetId, config, multiplier = 1 } = args;
      
      const items = await db.select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      let augmented = 0;
      let failed = 0;
      
      for (let i = 0; i < items.length; i++) {
        for (let m = 0; m < multiplier; m++) {
          try {
            await augmentItemInternal(items[i].id, config);
            augmented++;
          } catch {
            failed++;
          }
        }
        
        event.sender.send("generation:augment-progress", {
          current: i + 1,
          total: items.length,
          augmented,
          failed,
        });
      }
      
      return { success: true, augmented, failed };
    } catch (error) {
      logger.error("Augment dataset failed:", error);
      throw error;
    }
  });

  // ========== Hybrid Mixing ==========

  /**
   * Create hybrid dataset from multiple sources
   */
  ipcMain.handle("generation:create-hybrid", async (_event, args: {
    name: string;
    description?: string;
    mixConfig: HybridMixConfig;
  }) => {
    try {
      const { name, description, mixConfig } = args;
      
      // Create new dataset
      const datasetId = uuidv4();
      await db.insert(studioDatasets).values({
        id: datasetId,
        name,
        description,
        datasetType: "mixed",
        license: "mixed",
        supportedModalities: ["text"],
        itemCount: 0,
        totalBytes: 0,
        publishStatus: "draft",
      });
      
      let totalCopied = 0;
      
      // Process each source
      for (const source of mixConfig.sources) {
        if (!source.datasetId) continue;
        
        const sourceItems = await db.select()
          .from(datasetItems)
          .where(eq(datasetItems.datasetId, source.datasetId));
        
        // Calculate how many items to take
        const takeCount = Math.floor(sourceItems.length * (source.percentage / 100));
        const selectedItems = mixConfig.shuffle
          ? sourceItems.sort(() => Math.random() - 0.5).slice(0, takeCount)
          : sourceItems.slice(0, takeCount);
        
        // Copy items to new dataset
        for (const item of selectedItems) {
          const contentUri = item.contentUri || `content://${item.contentHash}`;
          await db.insert(datasetItems).values({
            id: uuidv4(),
            datasetId,
            modality: item.modality,
            contentHash: item.contentHash,
            byteSize: item.byteSize,
            sourceType: item.sourceType,
            sourcePath: item.sourcePath,
            generator: item.generator,
            lineageJson: null,
            labelsJson: item.labelsJson,
            contentUri,
            license: item.license,
            split: "unassigned",
          });
          totalCopied++;
        }
      }
      
      // Update dataset stats
      await db.update(studioDatasets)
        .set({
          itemCount: totalCopied,
          updatedAt: new Date(),
        })
        .where(eq(studioDatasets.id, datasetId));
      
      return { success: true, datasetId, itemCount: totalCopied };
    } catch (error) {
      logger.error("Create hybrid dataset failed:", error);
      throw error;
    }
  });

  // ========== Variable Generation ==========

  /**
   * Generate variable combinations from schema
   */
  ipcMain.handle("generation:generate-variables", async (_event, args: {
    schema: Record<string, {
      type: "enum" | "range" | "list" | "template";
      values?: any[];
      min?: number;
      max?: number;
      step?: number;
      template?: string;
    }>;
    strategy: "cartesian" | "random" | "latin_hypercube";
    count?: number;
  }) => {
    try {
      const { schema, strategy, count = 100 } = args;
      const variables: Array<Record<string, any>> = [];
      
      // Generate values for each variable
      const variableValues: Record<string, any[]> = {};
      
      for (const [key, config] of Object.entries(schema)) {
        if (config.type === "enum" && config.values) {
          variableValues[key] = config.values;
        } else if (config.type === "range") {
          const min = config.min || 0;
          const max = config.max || 100;
          const step = config.step || 1;
          const vals = [];
          for (let v = min; v <= max; v += step) {
            vals.push(v);
          }
          variableValues[key] = vals;
        } else if (config.type === "list" && config.values) {
          variableValues[key] = config.values;
        }
      }
      
      if (strategy === "cartesian") {
        // Generate all combinations (limited)
        const keys = Object.keys(variableValues);
        const combine = (index: number, current: Record<string, any>) => {
          if (index === keys.length) {
            variables.push({ ...current });
            return;
          }
          if (variables.length >= count) return;
          
          const key = keys[index];
          for (const value of variableValues[key]) {
            if (variables.length >= count) return;
            combine(index + 1, { ...current, [key]: value });
          }
        };
        combine(0, {});
      } else if (strategy === "random") {
        // Random sampling
        const keys = Object.keys(variableValues);
        for (let i = 0; i < count; i++) {
          const combo: Record<string, any> = {};
          for (const key of keys) {
            const vals = variableValues[key];
            combo[key] = vals[Math.floor(Math.random() * vals.length)];
          }
          variables.push(combo);
        }
      }
      
      return { success: true, variables, count: variables.length };
    } catch (error) {
      logger.error("Generate variables failed:", error);
      throw error;
    }
  });

  logger.info("Data Generation handlers registered");
}
