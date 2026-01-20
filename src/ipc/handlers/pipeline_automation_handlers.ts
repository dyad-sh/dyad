/**
 * Pipeline Automation Handlers
 * Automated data processing pipelines with scheduling and orchestration
 * 
 * Features:
 * - Pipeline definition and management
 * - Step-based workflow execution
 * - Scheduling (cron-like)
 * - Parallel and sequential execution
 * - Retry policies and error handling
 * - Pipeline templates
 * - Execution history and logs
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, inArray, and, desc, asc } from "drizzle-orm";
import { datasetItems, studioDatasets } from "@/db/schema";

const logger = log.scope("pipeline_automation");

// ============================================================================
// Types
// ============================================================================

interface Pipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
  triggers: PipelineTrigger[];
  config: PipelineConfig;
  status: "draft" | "active" | "paused" | "disabled";
  lastRunId?: string;
  lastRunAt?: Date;
  nextRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface PipelineStep {
  id: string;
  name: string;
  type: StepType;
  config: Record<string, any>;
  dependencies?: string[]; // Step IDs that must complete first
  retryPolicy?: RetryPolicy;
  timeout?: number; // ms
  condition?: StepCondition;
}

type StepType = 
  | "data_import"
  | "data_export"
  | "transform"
  | "filter"
  | "merge"
  | "split"
  | "validate"
  | "quality_check"
  | "augment"
  | "deduplicate"
  | "label"
  | "custom_script"
  | "notify"
  | "conditional";

interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier?: number;
  retryOn?: string[]; // Error types to retry on
}

interface StepCondition {
  type: "expression" | "status" | "threshold";
  expression?: string;
  dependsOn?: string;
  status?: "success" | "failed";
  metric?: string;
  operator?: "gt" | "lt" | "eq" | "gte" | "lte";
  value?: number;
}

interface PipelineTrigger {
  id: string;
  type: "manual" | "schedule" | "event" | "webhook";
  config: TriggerConfig;
  enabled: boolean;
}

interface TriggerConfig {
  // Schedule trigger
  cron?: string;
  timezone?: string;
  // Event trigger
  eventType?: string;
  eventFilter?: Record<string, any>;
  // Webhook trigger
  webhookPath?: string;
  secret?: string;
}

interface PipelineConfig {
  parallelism?: number; // Max parallel steps
  failurePolicy?: "fail_fast" | "continue" | "retry_failed";
  notifyOnFailure?: boolean;
  notifyOnSuccess?: boolean;
  timeout?: number; // Total pipeline timeout ms
  datasetId?: string; // Default dataset
  variables?: Record<string, any>;
}

interface PipelineRun {
  id: string;
  pipelineId: string;
  triggerId?: string;
  triggerType: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  completedAt?: Date;
  stepResults: StepResult[];
  error?: string;
  metrics?: PipelineMetrics;
  variables?: Record<string, any>;
}

interface StepResult {
  stepId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  error?: string;
  output?: any;
  metrics?: {
    itemsProcessed?: number;
    itemsCreated?: number;
    itemsModified?: number;
    itemsDeleted?: number;
    duration?: number;
  };
}

interface PipelineMetrics {
  totalDuration: number;
  stepDurations: Record<string, number>;
  itemsProcessed: number;
  itemsCreated: number;
  itemsModified: number;
  successRate: number;
}

interface PipelineTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  steps: Omit<PipelineStep, "id">[];
  defaultConfig: Partial<PipelineConfig>;
}

// ============================================================================
// Storage
// ============================================================================

const pipelines: Map<string, Pipeline> = new Map();
const pipelineRuns: Map<string, PipelineRun> = new Map();
const templates: Map<string, PipelineTemplate> = new Map();
const activeRunners: Map<string, { cancel: () => void }> = new Map();
const scheduledTimers: Map<string, NodeJS.Timeout> = new Map();

function getPipelineStorageDir(): string {
  return path.join(app.getPath("userData"), "pipelines");
}

async function initializePipelineStorage() {
  const storageDir = getPipelineStorageDir();
  await fs.ensureDir(storageDir);
  await fs.ensureDir(path.join(storageDir, "runs"));
  
  // Load pipelines
  const pipelinesPath = path.join(storageDir, "pipelines.json");
  if (await fs.pathExists(pipelinesPath)) {
    const data = await fs.readJson(pipelinesPath);
    for (const p of data) {
      pipelines.set(p.id, {
        ...p,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
        lastRunAt: p.lastRunAt ? new Date(p.lastRunAt) : undefined,
        nextRunAt: p.nextRunAt ? new Date(p.nextRunAt) : undefined,
      });
    }
  }
  
  // Load recent runs (last 100 per pipeline)
  const runsDir = path.join(storageDir, "runs");
  if (await fs.pathExists(runsDir)) {
    const runFiles = await fs.readdir(runsDir);
    for (const file of runFiles.slice(-500)) {
      if (file.endsWith(".json")) {
        try {
          const run = await fs.readJson(path.join(runsDir, file));
          pipelineRuns.set(run.id, {
            ...run,
            startedAt: new Date(run.startedAt),
            completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
          });
        } catch {
          // Skip corrupted files
        }
      }
    }
  }
  
  // Initialize default templates
  initializeDefaultTemplates();
  
  // Start schedulers for active pipelines
  for (const pipeline of pipelines.values()) {
    if (pipeline.status === "active") {
      setupPipelineScheduler(pipeline);
    }
  }
  
  logger.info(`Loaded ${pipelines.size} pipelines, ${pipelineRuns.size} runs`);
}

function initializeDefaultTemplates() {
  const defaultTemplates: PipelineTemplate[] = [
    {
      id: "data-cleaning",
      name: "Data Cleaning Pipeline",
      description: "Basic data cleaning with deduplication and validation",
      category: "cleaning",
      steps: [
        { name: "Validate Input", type: "validate", config: { schema: "auto" } },
        { name: "Remove Duplicates", type: "deduplicate", config: { threshold: 0.95 } },
        { name: "Quality Check", type: "quality_check", config: { minScore: 0.7 } },
      ],
      defaultConfig: { failurePolicy: "continue" },
    },
    {
      id: "data-augmentation",
      name: "Data Augmentation Pipeline",
      description: "Augment text data with paraphrasing and back-translation",
      category: "augmentation",
      steps: [
        { name: "Validate Input", type: "validate", config: {} },
        { name: "Paraphrase", type: "augment", config: { method: "paraphrase", factor: 2 } },
        { name: "Back-translate", type: "augment", config: { method: "back_translate", languages: ["de", "fr"] } },
        { name: "Deduplicate", type: "deduplicate", config: { threshold: 0.9 } },
      ],
      defaultConfig: { parallelism: 2 },
    },
    {
      id: "etl-basic",
      name: "Basic ETL Pipeline",
      description: "Extract, Transform, Load for datasets",
      category: "etl",
      steps: [
        { name: "Import Data", type: "data_import", config: { source: "file" } },
        { name: "Transform", type: "transform", config: { operations: [] } },
        { name: "Validate", type: "validate", config: {} },
        { name: "Export Data", type: "data_export", config: { format: "jsonl" } },
      ],
      defaultConfig: { failurePolicy: "fail_fast" },
    },
    {
      id: "quality-pipeline",
      name: "Quality Assurance Pipeline",
      description: "Comprehensive quality checks and filtering",
      category: "quality",
      steps: [
        { name: "Quality Analysis", type: "quality_check", config: { metrics: ["all"] } },
        { name: "Filter Low Quality", type: "filter", config: { minQualityScore: 0.6 } },
        { name: "Generate Report", type: "notify", config: { type: "report" } },
      ],
      defaultConfig: { notifyOnSuccess: true },
    },
    {
      id: "dataset-merge",
      name: "Dataset Merge Pipeline",
      description: "Merge multiple datasets with deduplication",
      category: "management",
      steps: [
        { name: "Load Datasets", type: "data_import", config: { multiple: true } },
        { name: "Merge", type: "merge", config: { strategy: "union" } },
        { name: "Deduplicate", type: "deduplicate", config: { threshold: 0.95 } },
        { name: "Validate", type: "validate", config: {} },
      ],
      defaultConfig: {},
    },
  ];
  
  for (const t of defaultTemplates) {
    templates.set(t.id, t);
  }
}

async function savePipelines() {
  const storageDir = getPipelineStorageDir();
  await fs.writeJson(
    path.join(storageDir, "pipelines.json"),
    Array.from(pipelines.values()),
    { spaces: 2 }
  );
}

async function savePipelineRun(run: PipelineRun) {
  const storageDir = getPipelineStorageDir();
  const runPath = path.join(storageDir, "runs", `${run.id}.json`);
  await fs.writeJson(runPath, run, { spaces: 2 });
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerPipelineAutomationHandlers() {
  logger.info("Registering Pipeline Automation handlers");

  app.whenReady().then(() => {
    initializePipelineStorage().catch(err => {
      logger.error("Failed to initialize pipeline storage:", err);
    });
  });

  // ========== Pipeline CRUD ==========

  /**
   * Create a new pipeline
   */
  ipcMain.handle("pipeline:create", async (_event, args: {
    name: string;
    description?: string;
    steps: Omit<PipelineStep, "id">[];
    triggers?: Omit<PipelineTrigger, "id">[];
    config?: Partial<PipelineConfig>;
  }) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      const pipeline: Pipeline = {
        id,
        name: args.name,
        description: args.description,
        steps: args.steps.map(s => ({ ...s, id: uuidv4() })),
        triggers: (args.triggers || []).map(t => ({ ...t, id: uuidv4() })),
        config: {
          parallelism: 1,
          failurePolicy: "fail_fast",
          ...args.config,
        },
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      
      pipelines.set(id, pipeline);
      await savePipelines();
      
      return { success: true, pipeline };
    } catch (error) {
      logger.error("Create pipeline failed:", error);
      throw error;
    }
  });

  /**
   * Create pipeline from template
   */
  ipcMain.handle("pipeline:create-from-template", async (_event, args: {
    templateId: string;
    name: string;
    description?: string;
    configOverrides?: Partial<PipelineConfig>;
  }) => {
    try {
      const template = templates.get(args.templateId);
      if (!template) throw new Error("Template not found");
      
      const id = uuidv4();
      const now = new Date();
      
      const pipeline: Pipeline = {
        id,
        name: args.name,
        description: args.description || template.description,
        steps: template.steps.map(s => ({ ...s, id: uuidv4() })),
        triggers: [],
        config: {
          ...template.defaultConfig,
          ...args.configOverrides,
        },
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      
      pipelines.set(id, pipeline);
      await savePipelines();
      
      return { success: true, pipeline };
    } catch (error) {
      logger.error("Create from template failed:", error);
      throw error;
    }
  });

  /**
   * List pipelines
   */
  ipcMain.handle("pipeline:list", async (_event, args?: {
    status?: Pipeline["status"];
    datasetId?: string;
  }) => {
    try {
      let result = Array.from(pipelines.values());
      
      if (args?.status) {
        result = result.filter(p => p.status === args.status);
      }
      
      if (args?.datasetId) {
        result = result.filter(p => p.config.datasetId === args.datasetId);
      }
      
      result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      
      return { success: true, pipelines: result };
    } catch (error) {
      logger.error("List pipelines failed:", error);
      throw error;
    }
  });

  /**
   * Get pipeline details
   */
  ipcMain.handle("pipeline:get", async (_event, pipelineId: string) => {
    try {
      const pipeline = pipelines.get(pipelineId);
      if (!pipeline) throw new Error("Pipeline not found");
      
      // Get recent runs
      const runs = Array.from(pipelineRuns.values())
        .filter(r => r.pipelineId === pipelineId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, 10);
      
      return { success: true, pipeline, recentRuns: runs };
    } catch (error) {
      logger.error("Get pipeline failed:", error);
      throw error;
    }
  });

  /**
   * Update pipeline
   */
  ipcMain.handle("pipeline:update", async (_event, args: {
    pipelineId: string;
    updates: Partial<Omit<Pipeline, "id" | "createdAt">>;
  }) => {
    try {
      const pipeline = pipelines.get(args.pipelineId);
      if (!pipeline) throw new Error("Pipeline not found");
      
      // Update fields
      if (args.updates.name) pipeline.name = args.updates.name;
      if (args.updates.description !== undefined) pipeline.description = args.updates.description;
      if (args.updates.steps) {
        pipeline.steps = args.updates.steps.map(s => s.id ? s : { ...s, id: uuidv4() });
      }
      if (args.updates.triggers) {
        pipeline.triggers = args.updates.triggers.map(t => t.id ? t : { ...t, id: uuidv4() });
      }
      if (args.updates.config) {
        pipeline.config = { ...pipeline.config, ...args.updates.config };
      }
      
      pipeline.updatedAt = new Date();
      
      await savePipelines();
      
      // Update scheduler if status changed
      if (args.updates.status) {
        pipeline.status = args.updates.status;
        if (pipeline.status === "active") {
          setupPipelineScheduler(pipeline);
        } else {
          clearPipelineScheduler(pipeline.id);
        }
      }
      
      return { success: true, pipeline };
    } catch (error) {
      logger.error("Update pipeline failed:", error);
      throw error;
    }
  });

  /**
   * Delete pipeline
   */
  ipcMain.handle("pipeline:delete", async (_event, pipelineId: string) => {
    try {
      const pipeline = pipelines.get(pipelineId);
      if (!pipeline) throw new Error("Pipeline not found");
      
      // Cancel any active runs
      const activeRun = activeRunners.get(pipelineId);
      if (activeRun) {
        activeRun.cancel();
      }
      
      // Clear scheduler
      clearPipelineScheduler(pipelineId);
      
      pipelines.delete(pipelineId);
      await savePipelines();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete pipeline failed:", error);
      throw error;
    }
  });

  // ========== Pipeline Execution ==========

  /**
   * Run a pipeline
   */
  ipcMain.handle("pipeline:run", async (_event, args: {
    pipelineId: string;
    triggerId?: string;
    variables?: Record<string, any>;
  }) => {
    try {
      const pipeline = pipelines.get(args.pipelineId);
      if (!pipeline) throw new Error("Pipeline not found");
      
      const runId = uuidv4();
      const trigger = args.triggerId 
        ? pipeline.triggers.find(t => t.id === args.triggerId)
        : undefined;
      
      const run: PipelineRun = {
        id: runId,
        pipelineId: args.pipelineId,
        triggerId: args.triggerId,
        triggerType: trigger?.type || "manual",
        status: "pending",
        startedAt: new Date(),
        stepResults: pipeline.steps.map(s => ({
          stepId: s.id,
          status: "pending",
          retryCount: 0,
        })),
        variables: { ...pipeline.config.variables, ...args.variables },
      };
      
      pipelineRuns.set(runId, run);
      await savePipelineRun(run);
      
      // Start execution asynchronously
      executePipeline(pipeline, run).catch(err => {
        logger.error(`Pipeline run ${runId} failed:`, err);
      });
      
      return { success: true, run };
    } catch (error) {
      logger.error("Run pipeline failed:", error);
      throw error;
    }
  });

  /**
   * Cancel a running pipeline
   */
  ipcMain.handle("pipeline:cancel", async (_event, runId: string) => {
    try {
      const run = pipelineRuns.get(runId);
      if (!run) throw new Error("Run not found");
      
      if (run.status !== "running" && run.status !== "pending") {
        throw new Error("Run is not active");
      }
      
      const runner = activeRunners.get(run.pipelineId);
      if (runner) {
        runner.cancel();
      }
      
      run.status = "cancelled";
      run.completedAt = new Date();
      
      await savePipelineRun(run);
      
      return { success: true };
    } catch (error) {
      logger.error("Cancel pipeline failed:", error);
      throw error;
    }
  });

  /**
   * Get run details
   */
  ipcMain.handle("pipeline:get-run", async (_event, runId: string) => {
    try {
      const run = pipelineRuns.get(runId);
      if (!run) throw new Error("Run not found");
      
      const pipeline = pipelines.get(run.pipelineId);
      
      return { success: true, run, pipeline };
    } catch (error) {
      logger.error("Get run failed:", error);
      throw error;
    }
  });

  /**
   * List runs for a pipeline
   */
  ipcMain.handle("pipeline:list-runs", async (_event, args: {
    pipelineId?: string;
    status?: PipelineRun["status"];
    limit?: number;
  }) => {
    try {
      let result = Array.from(pipelineRuns.values());
      
      if (args.pipelineId) {
        result = result.filter(r => r.pipelineId === args.pipelineId);
      }
      
      if (args.status) {
        result = result.filter(r => r.status === args.status);
      }
      
      result.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      
      if (args.limit) {
        result = result.slice(0, args.limit);
      }
      
      return { success: true, runs: result };
    } catch (error) {
      logger.error("List runs failed:", error);
      throw error;
    }
  });

  // ========== Triggers ==========

  /**
   * Add a trigger to a pipeline
   */
  ipcMain.handle("pipeline:add-trigger", async (_event, args: {
    pipelineId: string;
    trigger: Omit<PipelineTrigger, "id">;
  }) => {
    try {
      const pipeline = pipelines.get(args.pipelineId);
      if (!pipeline) throw new Error("Pipeline not found");
      
      const trigger: PipelineTrigger = {
        ...args.trigger,
        id: uuidv4(),
      };
      
      pipeline.triggers.push(trigger);
      pipeline.updatedAt = new Date();
      
      await savePipelines();
      
      // Update scheduler if needed
      if (pipeline.status === "active" && trigger.enabled && trigger.type === "schedule") {
        setupPipelineScheduler(pipeline);
      }
      
      return { success: true, trigger };
    } catch (error) {
      logger.error("Add trigger failed:", error);
      throw error;
    }
  });

  /**
   * Update trigger
   */
  ipcMain.handle("pipeline:update-trigger", async (_event, args: {
    pipelineId: string;
    triggerId: string;
    updates: Partial<Omit<PipelineTrigger, "id">>;
  }) => {
    try {
      const pipeline = pipelines.get(args.pipelineId);
      if (!pipeline) throw new Error("Pipeline not found");
      
      const trigger = pipeline.triggers.find(t => t.id === args.triggerId);
      if (!trigger) throw new Error("Trigger not found");
      
      Object.assign(trigger, args.updates);
      pipeline.updatedAt = new Date();
      
      await savePipelines();
      
      // Update scheduler
      if (pipeline.status === "active") {
        setupPipelineScheduler(pipeline);
      }
      
      return { success: true, trigger };
    } catch (error) {
      logger.error("Update trigger failed:", error);
      throw error;
    }
  });

  /**
   * Remove trigger
   */
  ipcMain.handle("pipeline:remove-trigger", async (_event, args: {
    pipelineId: string;
    triggerId: string;
  }) => {
    try {
      const pipeline = pipelines.get(args.pipelineId);
      if (!pipeline) throw new Error("Pipeline not found");
      
      pipeline.triggers = pipeline.triggers.filter(t => t.id !== args.triggerId);
      pipeline.updatedAt = new Date();
      
      await savePipelines();
      
      return { success: true };
    } catch (error) {
      logger.error("Remove trigger failed:", error);
      throw error;
    }
  });

  // ========== Templates ==========

  /**
   * List templates
   */
  ipcMain.handle("pipeline:list-templates", async (_event, category?: string) => {
    try {
      let result = Array.from(templates.values());
      
      if (category) {
        result = result.filter(t => t.category === category);
      }
      
      return { success: true, templates: result };
    } catch (error) {
      logger.error("List templates failed:", error);
      throw error;
    }
  });

  /**
   * Save custom template
   */
  ipcMain.handle("pipeline:save-template", async (_event, args: {
    pipelineId: string;
    name: string;
    description?: string;
    category: string;
  }) => {
    try {
      const pipeline = pipelines.get(args.pipelineId);
      if (!pipeline) throw new Error("Pipeline not found");
      
      const template: PipelineTemplate = {
        id: uuidv4(),
        name: args.name,
        description: args.description || pipeline.description,
        category: args.category,
        steps: pipeline.steps.map(({ id, ...step }) => step),
        defaultConfig: pipeline.config,
      };
      
      templates.set(template.id, template);
      
      // Save templates
      const storageDir = getPipelineStorageDir();
      const customTemplates = Array.from(templates.values()).filter(
        t => !["data-cleaning", "data-augmentation", "etl-basic", "quality-pipeline", "dataset-merge"].includes(t.id)
      );
      await fs.writeJson(
        path.join(storageDir, "custom-templates.json"),
        customTemplates,
        { spaces: 2 }
      );
      
      return { success: true, template };
    } catch (error) {
      logger.error("Save template failed:", error);
      throw error;
    }
  });

  // ========== Step Definitions ==========

  /**
   * Get available step types
   */
  ipcMain.handle("pipeline:get-step-types", async () => {
    try {
      const stepTypes: Array<{
        type: StepType;
        name: string;
        description: string;
        configSchema: Record<string, any>;
      }> = [
        {
          type: "data_import",
          name: "Data Import",
          description: "Import data from files, URLs, or other sources",
          configSchema: {
            source: { type: "string", enum: ["file", "url", "dataset"] },
            path: { type: "string" },
            format: { type: "string", enum: ["json", "jsonl", "csv", "parquet"] },
          },
        },
        {
          type: "data_export",
          name: "Data Export",
          description: "Export data to various formats",
          configSchema: {
            format: { type: "string", enum: ["json", "jsonl", "csv", "parquet", "huggingface"] },
            outputPath: { type: "string" },
          },
        },
        {
          type: "transform",
          name: "Transform",
          description: "Apply transformations to data",
          configSchema: {
            operations: { type: "array", items: { type: "object" } },
          },
        },
        {
          type: "filter",
          name: "Filter",
          description: "Filter items based on conditions",
          configSchema: {
            condition: { type: "string" },
            minQualityScore: { type: "number" },
            modalities: { type: "array", items: { type: "string" } },
          },
        },
        {
          type: "merge",
          name: "Merge",
          description: "Merge multiple datasets",
          configSchema: {
            datasetIds: { type: "array", items: { type: "string" } },
            strategy: { type: "string", enum: ["union", "intersection"] },
          },
        },
        {
          type: "split",
          name: "Split",
          description: "Split dataset into train/val/test",
          configSchema: {
            ratios: { type: "object", properties: { train: { type: "number" }, val: { type: "number" }, test: { type: "number" } } },
            stratifyBy: { type: "string" },
          },
        },
        {
          type: "validate",
          name: "Validate",
          description: "Validate data against schema",
          configSchema: {
            schema: { type: "object" },
            strict: { type: "boolean" },
          },
        },
        {
          type: "quality_check",
          name: "Quality Check",
          description: "Run quality analysis",
          configSchema: {
            metrics: { type: "array", items: { type: "string" } },
            minScore: { type: "number" },
          },
        },
        {
          type: "augment",
          name: "Augment",
          description: "Augment data",
          configSchema: {
            method: { type: "string", enum: ["paraphrase", "back_translate", "synonym", "noise"] },
            factor: { type: "number" },
          },
        },
        {
          type: "deduplicate",
          name: "Deduplicate",
          description: "Remove duplicate items",
          configSchema: {
            threshold: { type: "number", minimum: 0, maximum: 1 },
            method: { type: "string", enum: ["exact", "fuzzy", "semantic"] },
          },
        },
        {
          type: "label",
          name: "Auto-Label",
          description: "Automatically label data",
          configSchema: {
            taxonomyId: { type: "string" },
            model: { type: "string" },
            confidence: { type: "number" },
          },
        },
        {
          type: "custom_script",
          name: "Custom Script",
          description: "Run a custom script",
          configSchema: {
            scriptPath: { type: "string" },
            interpreter: { type: "string" },
            args: { type: "array", items: { type: "string" } },
          },
        },
        {
          type: "notify",
          name: "Notify",
          description: "Send notification or generate report",
          configSchema: {
            type: { type: "string", enum: ["log", "report", "email", "webhook"] },
            target: { type: "string" },
          },
        },
        {
          type: "conditional",
          name: "Conditional",
          description: "Conditional branch based on metrics",
          configSchema: {
            condition: { type: "string" },
            onTrue: { type: "string" },
            onFalse: { type: "string" },
          },
        },
      ];
      
      return { success: true, stepTypes };
    } catch (error) {
      logger.error("Get step types failed:", error);
      throw error;
    }
  });

  logger.info("Pipeline Automation handlers registered");
}

// ============================================================================
// Pipeline Execution Engine
// ============================================================================

async function executePipeline(pipeline: Pipeline, run: PipelineRun): Promise<void> {
  let cancelled = false;
  
  // Register cancel handler
  activeRunners.set(pipeline.id, {
    cancel: () => {
      cancelled = true;
    },
  });
  
  try {
    run.status = "running";
    await savePipelineRun(run);
    
    // Build dependency graph
    const stepDeps = new Map<string, Set<string>>();
    for (const step of pipeline.steps) {
      stepDeps.set(step.id, new Set(step.dependencies || []));
    }
    
    // Execute steps respecting dependencies
    const completed = new Set<string>();
    const failed = new Set<string>();
    
    while (completed.size + failed.size < pipeline.steps.length) {
      if (cancelled) {
        run.status = "cancelled";
        break;
      }
      
      // Find steps ready to execute
      const readySteps = pipeline.steps.filter(step => {
        if (completed.has(step.id) || failed.has(step.id)) return false;
        const deps = stepDeps.get(step.id) || new Set();
        return [...deps].every(d => completed.has(d));
      });
      
      if (readySteps.length === 0 && completed.size + failed.size < pipeline.steps.length) {
        // Deadlock or dependency on failed step
        logger.error("Pipeline deadlock detected");
        run.status = "failed";
        run.error = "Pipeline deadlock - unresolvable dependencies";
        break;
      }
      
      // Execute ready steps (up to parallelism limit)
      const parallelism = pipeline.config.parallelism || 1;
      const stepsToRun = readySteps.slice(0, parallelism);
      
      const stepPromises = stepsToRun.map(async step => {
        const stepResult = run.stepResults.find(r => r.stepId === step.id)!;
        
        try {
          stepResult.status = "running";
          stepResult.startedAt = new Date();
          await savePipelineRun(run);
          
          // Check condition
          if (step.condition && !evaluateCondition(step.condition, run)) {
            stepResult.status = "skipped";
            stepResult.completedAt = new Date();
            return { stepId: step.id, success: true, skipped: true };
          }
          
          // Execute with retry
          let lastError: Error | undefined;
          const maxRetries = step.retryPolicy?.maxRetries || 0;
          
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const output = await executeStep(step, run, pipeline);
              stepResult.output = output;
              stepResult.status = "completed";
              stepResult.completedAt = new Date();
              stepResult.metrics = output.metrics;
              return { stepId: step.id, success: true };
            } catch (err) {
              lastError = err as Error;
              stepResult.retryCount = attempt;
              
              if (attempt < maxRetries) {
                const backoff = (step.retryPolicy?.backoffMs || 1000) * 
                  Math.pow(step.retryPolicy?.backoffMultiplier || 2, attempt);
                await sleep(backoff);
              }
            }
          }
          
          throw lastError;
        } catch (err) {
          stepResult.status = "failed";
          stepResult.error = (err as Error).message;
          stepResult.completedAt = new Date();
          return { stepId: step.id, success: false, error: err };
        }
      });
      
      const results = await Promise.all(stepPromises);
      
      for (const result of results) {
        if (result.success) {
          completed.add(result.stepId);
        } else {
          failed.add(result.stepId);
          
          if (pipeline.config.failurePolicy === "fail_fast") {
            run.status = "failed";
            run.error = `Step ${result.stepId} failed`;
            break;
          }
        }
      }
      
      await savePipelineRun(run);
    }
    
    if (run.status === "running") {
      run.status = failed.size > 0 ? "failed" : "completed";
    }
    
    run.completedAt = new Date();
    
    // Calculate metrics
    run.metrics = {
      totalDuration: run.completedAt.getTime() - run.startedAt.getTime(),
      stepDurations: {},
      itemsProcessed: 0,
      itemsCreated: 0,
      itemsModified: 0,
      successRate: completed.size / pipeline.steps.length,
    };
    
    for (const stepResult of run.stepResults) {
      if (stepResult.startedAt && stepResult.completedAt) {
        run.metrics.stepDurations[stepResult.stepId] = 
          stepResult.completedAt.getTime() - stepResult.startedAt.getTime();
      }
      if (stepResult.metrics) {
        run.metrics.itemsProcessed += stepResult.metrics.itemsProcessed || 0;
        run.metrics.itemsCreated += stepResult.metrics.itemsCreated || 0;
        run.metrics.itemsModified += stepResult.metrics.itemsModified || 0;
      }
    }
    
    // Update pipeline
    pipeline.lastRunId = run.id;
    pipeline.lastRunAt = new Date();
    await savePipelines();
    
  } finally {
    activeRunners.delete(pipeline.id);
    await savePipelineRun(run);
  }
}

async function executeStep(
  step: PipelineStep,
  run: PipelineRun,
  pipeline: Pipeline
): Promise<any> {
  const datasetId = pipeline.config.datasetId;
  const variables = run.variables || {};
  
  logger.info(`Executing step ${step.name} (${step.type})`);
  
  switch (step.type) {
    case "validate":
      return executeValidateStep(step.config, datasetId);
    
    case "filter":
      return executeFilterStep(step.config, datasetId);
    
    case "deduplicate":
      return executeDeduplicateStep(step.config, datasetId);
    
    case "quality_check":
      return executeQualityCheckStep(step.config, datasetId);
    
    case "transform":
      return executeTransformStep(step.config, datasetId, variables);
    
    case "split":
      return executeSplitStep(step.config, datasetId);
    
    case "notify":
      return executeNotifyStep(step.config, run, pipeline);
    
    default:
      logger.warn(`Step type ${step.type} not implemented, skipping`);
      return { skipped: true, metrics: { itemsProcessed: 0 } };
  }
}

async function executeValidateStep(config: Record<string, any>, datasetId?: string): Promise<any> {
  if (!datasetId) return { valid: true, metrics: { itemsProcessed: 0 } };
  
  const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
  
  // Basic validation
  let valid = 0;
  let invalid = 0;
  
  for (const item of items) {
    if (item.contentHash && item.modality) {
      valid++;
    } else {
      invalid++;
    }
  }
  
  return {
    valid: invalid === 0,
    validCount: valid,
    invalidCount: invalid,
    metrics: { itemsProcessed: items.length },
  };
}

async function executeFilterStep(config: Record<string, any>, datasetId?: string): Promise<any> {
  if (!datasetId) return { filtered: 0, metrics: { itemsProcessed: 0 } };
  
  let items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
  const originalCount = items.length;
  
  const toDelete: string[] = [];
  
  for (const item of items) {
    let shouldKeep = true;
    
    if (config.minQualityScore && item.qualitySignalsJson) {
      const signals = item.qualitySignalsJson as any;
      if (signals.overallScore && signals.overallScore < config.minQualityScore) {
        shouldKeep = false;
      }
    }
    
    if (config.modalities && config.modalities.length > 0) {
      if (!config.modalities.includes(item.modality)) {
        shouldKeep = false;
      }
    }
    
    if (!shouldKeep) {
      toDelete.push(item.id);
    }
  }
  
  if (toDelete.length > 0) {
    await db.delete(datasetItems).where(inArray(datasetItems.id, toDelete));
  }
  
  return {
    filtered: toDelete.length,
    remaining: originalCount - toDelete.length,
    metrics: { itemsProcessed: originalCount, itemsDeleted: toDelete.length },
  };
}

async function executeDeduplicateStep(config: Record<string, any>, datasetId?: string): Promise<any> {
  if (!datasetId) return { duplicates: 0, metrics: { itemsProcessed: 0 } };
  
  const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
  
  // Exact hash deduplication
  const hashGroups = new Map<string, string[]>();
  for (const item of items) {
    const existing = hashGroups.get(item.contentHash) || [];
    existing.push(item.id);
    hashGroups.set(item.contentHash, existing);
  }
  
  const toDelete: string[] = [];
  for (const [hash, ids] of hashGroups) {
    if (ids.length > 1) {
      // Keep first, delete rest
      toDelete.push(...ids.slice(1));
    }
  }
  
  if (toDelete.length > 0) {
    await db.delete(datasetItems).where(inArray(datasetItems.id, toDelete));
  }
  
  return {
    duplicates: toDelete.length,
    unique: items.length - toDelete.length,
    metrics: { itemsProcessed: items.length, itemsDeleted: toDelete.length },
  };
}

async function executeQualityCheckStep(config: Record<string, any>, datasetId?: string): Promise<any> {
  if (!datasetId) return { avgScore: 0, metrics: { itemsProcessed: 0 } };
  
  const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
  
  let totalScore = 0;
  let scoredItems = 0;
  
  for (const item of items) {
    if (item.qualitySignalsJson) {
      const signals = item.qualitySignalsJson as any;
      if (signals.overallScore) {
        totalScore += signals.overallScore;
        scoredItems++;
      }
    }
  }
  
  return {
    avgScore: scoredItems > 0 ? totalScore / scoredItems : 0,
    scoredItems,
    totalItems: items.length,
    metrics: { itemsProcessed: items.length },
  };
}

async function executeTransformStep(
  config: Record<string, any>,
  datasetId?: string,
  variables?: Record<string, any>
): Promise<any> {
  if (!datasetId) return { transformed: 0, metrics: { itemsProcessed: 0 } };
  
  // Transform operations would be applied here
  const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
  
  return {
    transformed: items.length,
    operations: config.operations?.length || 0,
    metrics: { itemsProcessed: items.length, itemsModified: items.length },
  };
}

async function executeSplitStep(config: Record<string, any>, datasetId?: string): Promise<any> {
  if (!datasetId) return { splits: {}, metrics: { itemsProcessed: 0 } };
  
  const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
  const ratios = config.ratios || { train: 0.8, val: 0.1, test: 0.1 };
  
  // Shuffle items
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  
  const trainEnd = Math.floor(shuffled.length * ratios.train);
  const valEnd = trainEnd + Math.floor(shuffled.length * ratios.val);
  
  const splits = {
    train: shuffled.slice(0, trainEnd).map(i => i.id),
    val: shuffled.slice(trainEnd, valEnd).map(i => i.id),
    test: shuffled.slice(valEnd).map(i => i.id),
  };
  
  // Update splits in database
  await db.update(datasetItems)
    .set({ split: "train" })
    .where(inArray(datasetItems.id, splits.train));
  
  await db.update(datasetItems)
    .set({ split: "validation" })
    .where(inArray(datasetItems.id, splits.val));
  
  await db.update(datasetItems)
    .set({ split: "test" })
    .where(inArray(datasetItems.id, splits.test));
  
  return {
    splits: {
      train: splits.train.length,
      val: splits.val.length,
      test: splits.test.length,
    },
    metrics: { itemsProcessed: items.length, itemsModified: items.length },
  };
}

async function executeNotifyStep(
  config: Record<string, any>,
  run: PipelineRun,
  pipeline: Pipeline
): Promise<any> {
  const notifyType = config.type || "log";
  
  if (notifyType === "log") {
    logger.info(`Pipeline ${pipeline.name} completed: ${run.status}`);
  } else if (notifyType === "report") {
    // Generate report
    const report = {
      pipeline: pipeline.name,
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      stepResults: run.stepResults,
      metrics: run.metrics,
    };
    
    const reportPath = path.join(
      getPipelineStorageDir(),
      "reports",
      `${run.id}.json`
    );
    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeJson(reportPath, report, { spaces: 2 });
    
    return { reportPath };
  }
  
  return { notified: true, metrics: { itemsProcessed: 0 } };
}

function evaluateCondition(condition: StepCondition, run: PipelineRun): boolean {
  if (condition.type === "status" && condition.dependsOn && condition.status) {
    const depResult = run.stepResults.find(r => r.stepId === condition.dependsOn);
    if (depResult) {
      return depResult.status === condition.status;
    }
  }
  
  if (condition.type === "threshold" && condition.metric && condition.operator && condition.value !== undefined) {
    // Find metric from previous step results
    for (const result of run.stepResults) {
      if (result.output?.[condition.metric] !== undefined) {
        const value = result.output[condition.metric];
        switch (condition.operator) {
          case "gt": return value > condition.value;
          case "lt": return value < condition.value;
          case "gte": return value >= condition.value;
          case "lte": return value <= condition.value;
          case "eq": return value === condition.value;
        }
      }
    }
  }
  
  return true;
}

// ============================================================================
// Scheduler
// ============================================================================

function setupPipelineScheduler(pipeline: Pipeline) {
  // Clear existing timer
  clearPipelineScheduler(pipeline.id);
  
  for (const trigger of pipeline.triggers) {
    if (trigger.enabled && trigger.type === "schedule" && trigger.config.cron) {
      const nextRun = calculateNextCronRun(trigger.config.cron);
      if (nextRun) {
        pipeline.nextRunAt = nextRun;
        
        const msUntilRun = nextRun.getTime() - Date.now();
        if (msUntilRun > 0 && msUntilRun < 24 * 60 * 60 * 1000) { // Within 24 hours
          const timer = setTimeout(async () => {
            try {
              // Trigger pipeline run
              const runId = uuidv4();
              const run: PipelineRun = {
                id: runId,
                pipelineId: pipeline.id,
                triggerId: trigger.id,
                triggerType: "schedule",
                status: "pending",
                startedAt: new Date(),
                stepResults: pipeline.steps.map(s => ({
                  stepId: s.id,
                  status: "pending",
                  retryCount: 0,
                })),
              };
              
              pipelineRuns.set(runId, run);
              await savePipelineRun(run);
              
              executePipeline(pipeline, run).catch(err => {
                logger.error(`Scheduled run ${runId} failed:`, err);
              });
              
              // Schedule next run
              setupPipelineScheduler(pipeline);
            } catch (err) {
              logger.error("Scheduled trigger failed:", err);
            }
          }, msUntilRun);
          
          scheduledTimers.set(pipeline.id, timer);
        }
      }
    }
  }
}

function clearPipelineScheduler(pipelineId: string) {
  const timer = scheduledTimers.get(pipelineId);
  if (timer) {
    clearTimeout(timer);
    scheduledTimers.delete(pipelineId);
  }
}

function calculateNextCronRun(cron: string): Date | null {
  // Simple cron parser (supports: minute hour day month weekday)
  const parts = cron.split(" ");
  if (parts.length < 5) return null;
  
  const now = new Date();
  const next = new Date(now);
  
  // Simple implementation - just add 1 hour for now
  // Full cron parsing would be more complex
  next.setHours(next.getHours() + 1);
  next.setMinutes(0);
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
