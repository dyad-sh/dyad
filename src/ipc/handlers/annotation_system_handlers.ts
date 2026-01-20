/**
 * Annotation System Handlers
 * Comprehensive labeling and annotation tools for datasets
 * 
 * Features:
 * - Label taxonomy management
 * - Annotation queue and workflows
 * - Multi-annotator support with consensus
 * - Annotation templates and presets
 * - Quality control and review
 * - Import/export annotations
 * - Keyboard shortcuts configuration
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, inArray, and, sql, desc, asc } from "drizzle-orm";
import { datasetItems, studioDatasets } from "@/db/schema";

const logger = log.scope("annotation_system");

// ============================================================================
// Types
// ============================================================================

interface LabelTaxonomy {
  id: string;
  name: string;
  description?: string;
  type: "classification" | "detection" | "segmentation" | "ner" | "qa" | "custom";
  labels: LabelDefinition[];
  hierarchical?: boolean;
  multiLabel?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface LabelDefinition {
  id: string;
  name: string;
  color: string;
  shortcut?: string;
  description?: string;
  parentId?: string;
  metadata?: Record<string, any>;
}

interface AnnotationTask {
  id: string;
  datasetId: string;
  taxonomyId: string;
  name: string;
  description?: string;
  status: "draft" | "active" | "paused" | "completed" | "archived";
  assignees?: string[];
  itemFilter?: {
    splits?: string[];
    modalities?: string[];
    unlabeledOnly?: boolean;
    customFilter?: string;
  };
  settings: {
    requireReview?: boolean;
    minAnnotatorsPerItem?: number;
    consensusThreshold?: number;
    allowSkip?: boolean;
    randomOrder?: boolean;
    showPreviousAnnotations?: boolean;
  };
  progress: {
    totalItems: number;
    annotatedItems: number;
    reviewedItems: number;
    skippedItems: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface Annotation {
  id: string;
  itemId: string;
  taskId: string;
  annotatorId: string;
  labels: AnnotationLabel[];
  status: "pending" | "submitted" | "approved" | "rejected";
  timeSpentMs?: number;
  notes?: string;
  reviewedBy?: string;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AnnotationLabel {
  labelId: string;
  value?: any;
  confidence?: number;
  // For detection/segmentation
  boundingBox?: { x: number; y: number; width: number; height: number };
  polygon?: Array<{ x: number; y: number }>;
  // For NER
  startOffset?: number;
  endOffset?: number;
  text?: string;
  // For QA
  answer?: string;
  answerStart?: number;
}

interface AnnotationTemplate {
  id: string;
  name: string;
  description?: string;
  taskType: string;
  defaultLabels: Partial<AnnotationLabel>[];
  keyboardShortcuts: Record<string, string>;
  uiConfig?: Record<string, any>;
}

interface AnnotatorStats {
  annotatorId: string;
  totalAnnotations: number;
  approvedAnnotations: number;
  rejectedAnnotations: number;
  avgTimePerItem: number;
  agreementScore: number;
  lastActiveAt: Date;
}

// ============================================================================
// Storage
// ============================================================================

const taxonomies: Map<string, LabelTaxonomy> = new Map();
const tasks: Map<string, AnnotationTask> = new Map();
const annotations: Map<string, Annotation> = new Map();
const templates: Map<string, AnnotationTemplate> = new Map();

function getAnnotationStorageDir(): string {
  return path.join(app.getPath("userData"), "annotations");
}

async function initializeAnnotationStorage() {
  const storageDir = getAnnotationStorageDir();
  await fs.ensureDir(storageDir);
  
  // Load taxonomies
  const taxonomiesPath = path.join(storageDir, "taxonomies.json");
  if (await fs.pathExists(taxonomiesPath)) {
    const data = await fs.readJson(taxonomiesPath);
    for (const t of data) {
      taxonomies.set(t.id, { ...t, createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt) });
    }
  }
  
  // Load tasks
  const tasksPath = path.join(storageDir, "tasks.json");
  if (await fs.pathExists(tasksPath)) {
    const data = await fs.readJson(tasksPath);
    for (const t of data) {
      tasks.set(t.id, { ...t, createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt) });
    }
  }
  
  // Load annotations index
  const annotationsIndexPath = path.join(storageDir, "annotations-index.json");
  if (await fs.pathExists(annotationsIndexPath)) {
    const data = await fs.readJson(annotationsIndexPath);
    for (const a of data) {
      annotations.set(a.id, { ...a, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) });
    }
  }
  
  // Load templates
  const templatesPath = path.join(storageDir, "templates.json");
  if (await fs.pathExists(templatesPath)) {
    const data = await fs.readJson(templatesPath);
    for (const t of data) {
      templates.set(t.id, t);
    }
  }
  
  // Initialize default templates
  if (templates.size === 0) {
    initializeDefaultTemplates();
  }
  
  logger.info(`Loaded ${taxonomies.size} taxonomies, ${tasks.size} tasks, ${annotations.size} annotations`);
}

function initializeDefaultTemplates() {
  const defaultTemplates: AnnotationTemplate[] = [
    {
      id: "classification-binary",
      name: "Binary Classification",
      description: "Simple yes/no or positive/negative classification",
      taskType: "classification",
      defaultLabels: [],
      keyboardShortcuts: {
        "1": "positive",
        "2": "negative",
        "s": "skip",
        "Enter": "submit",
      },
    },
    {
      id: "classification-multi",
      name: "Multi-class Classification",
      description: "Classify items into one of multiple categories",
      taskType: "classification",
      defaultLabels: [],
      keyboardShortcuts: {
        "1-9": "select_label",
        "s": "skip",
        "Enter": "submit",
      },
    },
    {
      id: "ner-basic",
      name: "Named Entity Recognition",
      description: "Tag entities in text with categories",
      taskType: "ner",
      defaultLabels: [],
      keyboardShortcuts: {
        "p": "PERSON",
        "o": "ORGANIZATION",
        "l": "LOCATION",
        "d": "DATE",
        "Escape": "clear_selection",
        "Enter": "submit",
      },
    },
    {
      id: "qa-extractive",
      name: "Extractive QA",
      description: "Highlight answer spans in text",
      taskType: "qa",
      defaultLabels: [],
      keyboardShortcuts: {
        "a": "select_answer",
        "n": "no_answer",
        "Enter": "submit",
      },
    },
    {
      id: "bbox-detection",
      name: "Bounding Box Detection",
      description: "Draw bounding boxes around objects",
      taskType: "detection",
      defaultLabels: [],
      keyboardShortcuts: {
        "b": "draw_box",
        "Delete": "delete_selected",
        "1-9": "select_label",
        "Enter": "submit",
      },
    },
  ];
  
  for (const t of defaultTemplates) {
    templates.set(t.id, t);
  }
  
  saveTemplates().catch(() => {});
}

async function saveTaxonomies() {
  const storageDir = getAnnotationStorageDir();
  await fs.writeJson(
    path.join(storageDir, "taxonomies.json"),
    Array.from(taxonomies.values()),
    { spaces: 2 }
  );
}

async function saveTasks() {
  const storageDir = getAnnotationStorageDir();
  await fs.writeJson(
    path.join(storageDir, "tasks.json"),
    Array.from(tasks.values()),
    { spaces: 2 }
  );
}

async function saveAnnotationsIndex() {
  const storageDir = getAnnotationStorageDir();
  await fs.writeJson(
    path.join(storageDir, "annotations-index.json"),
    Array.from(annotations.values()),
    { spaces: 2 }
  );
}

async function saveTemplates() {
  const storageDir = getAnnotationStorageDir();
  await fs.writeJson(
    path.join(storageDir, "templates.json"),
    Array.from(templates.values()),
    { spaces: 2 }
  );
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerAnnotationSystemHandlers() {
  logger.info("Registering Annotation System handlers");

  app.whenReady().then(() => {
    initializeAnnotationStorage().catch(err => {
      logger.error("Failed to initialize annotation storage:", err);
    });
  });

  // ========== Taxonomy Management ==========

  /**
   * Create label taxonomy
   */
  ipcMain.handle("annotation:create-taxonomy", async (_event, args: {
    name: string;
    description?: string;
    type: LabelTaxonomy["type"];
    labels: Omit<LabelDefinition, "id">[];
    hierarchical?: boolean;
    multiLabel?: boolean;
  }) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      const taxonomy: LabelTaxonomy = {
        id,
        name: args.name,
        description: args.description,
        type: args.type,
        labels: args.labels.map(l => ({ ...l, id: uuidv4() })),
        hierarchical: args.hierarchical,
        multiLabel: args.multiLabel,
        createdAt: now,
        updatedAt: now,
      };
      
      taxonomies.set(id, taxonomy);
      await saveTaxonomies();
      
      return { success: true, taxonomy };
    } catch (error) {
      logger.error("Create taxonomy failed:", error);
      throw error;
    }
  });

  /**
   * List taxonomies
   */
  ipcMain.handle("annotation:list-taxonomies", async (_event, args?: {
    type?: string;
  }) => {
    try {
      let result = Array.from(taxonomies.values());
      
      if (args?.type) {
        result = result.filter(t => t.type === args.type);
      }
      
      return { success: true, taxonomies: result };
    } catch (error) {
      logger.error("List taxonomies failed:", error);
      throw error;
    }
  });

  /**
   * Get taxonomy by ID
   */
  ipcMain.handle("annotation:get-taxonomy", async (_event, taxonomyId: string) => {
    try {
      const taxonomy = taxonomies.get(taxonomyId);
      if (!taxonomy) throw new Error("Taxonomy not found");
      
      return { success: true, taxonomy };
    } catch (error) {
      logger.error("Get taxonomy failed:", error);
      throw error;
    }
  });

  /**
   * Update taxonomy
   */
  ipcMain.handle("annotation:update-taxonomy", async (_event, args: {
    taxonomyId: string;
    updates: Partial<Omit<LabelTaxonomy, "id" | "createdAt">>;
  }) => {
    try {
      const taxonomy = taxonomies.get(args.taxonomyId);
      if (!taxonomy) throw new Error("Taxonomy not found");
      
      const updated = {
        ...taxonomy,
        ...args.updates,
        updatedAt: new Date(),
      };
      
      taxonomies.set(args.taxonomyId, updated);
      await saveTaxonomies();
      
      return { success: true, taxonomy: updated };
    } catch (error) {
      logger.error("Update taxonomy failed:", error);
      throw error;
    }
  });

  /**
   * Add label to taxonomy
   */
  ipcMain.handle("annotation:add-label", async (_event, args: {
    taxonomyId: string;
    label: Omit<LabelDefinition, "id">;
  }) => {
    try {
      const taxonomy = taxonomies.get(args.taxonomyId);
      if (!taxonomy) throw new Error("Taxonomy not found");
      
      const newLabel: LabelDefinition = {
        ...args.label,
        id: uuidv4(),
      };
      
      taxonomy.labels.push(newLabel);
      taxonomy.updatedAt = new Date();
      
      await saveTaxonomies();
      
      return { success: true, label: newLabel };
    } catch (error) {
      logger.error("Add label failed:", error);
      throw error;
    }
  });

  /**
   * Delete taxonomy
   */
  ipcMain.handle("annotation:delete-taxonomy", async (_event, taxonomyId: string) => {
    try {
      // Check if used by any active tasks
      const usedByTasks = Array.from(tasks.values()).filter(
        t => t.taxonomyId === taxonomyId && t.status !== "archived"
      );
      
      if (usedByTasks.length > 0) {
        throw new Error(`Taxonomy is used by ${usedByTasks.length} active tasks`);
      }
      
      taxonomies.delete(taxonomyId);
      await saveTaxonomies();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete taxonomy failed:", error);
      throw error;
    }
  });

  // ========== Task Management ==========

  /**
   * Create annotation task
   */
  ipcMain.handle("annotation:create-task", async (_event, args: {
    datasetId: string;
    taxonomyId: string;
    name: string;
    description?: string;
    itemFilter?: AnnotationTask["itemFilter"];
    settings?: AnnotationTask["settings"];
  }) => {
    try {
      const { datasetId, taxonomyId, name, description, itemFilter, settings } = args;
      
      // Verify dataset exists
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error("Dataset not found");
      
      // Verify taxonomy exists
      const taxonomy = taxonomies.get(taxonomyId);
      if (!taxonomy) throw new Error("Taxonomy not found");
      
      // Count matching items
      const items = await db.select({ id: datasetItems.id })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      const id = uuidv4();
      const now = new Date();
      
      const task: AnnotationTask = {
        id,
        datasetId,
        taxonomyId,
        name,
        description,
        status: "draft",
        itemFilter: itemFilter || {},
        settings: settings || {
          allowSkip: true,
          randomOrder: true,
        },
        progress: {
          totalItems: items.length,
          annotatedItems: 0,
          reviewedItems: 0,
          skippedItems: 0,
        },
        createdAt: now,
        updatedAt: now,
      };
      
      tasks.set(id, task);
      await saveTasks();
      
      return { success: true, task };
    } catch (error) {
      logger.error("Create task failed:", error);
      throw error;
    }
  });

  /**
   * List annotation tasks
   */
  ipcMain.handle("annotation:list-tasks", async (_event, args?: {
    datasetId?: string;
    status?: string;
  }) => {
    try {
      let result = Array.from(tasks.values());
      
      if (args?.datasetId) {
        result = result.filter(t => t.datasetId === args.datasetId);
      }
      
      if (args?.status) {
        result = result.filter(t => t.status === args.status);
      }
      
      return { success: true, tasks: result };
    } catch (error) {
      logger.error("List tasks failed:", error);
      throw error;
    }
  });

  /**
   * Get task details
   */
  ipcMain.handle("annotation:get-task", async (_event, taskId: string) => {
    try {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      
      const taxonomy = taxonomies.get(task.taxonomyId);
      
      // Get annotation stats
      const taskAnnotations = Array.from(annotations.values()).filter(a => a.taskId === taskId);
      const byStatus = {
        pending: taskAnnotations.filter(a => a.status === "pending").length,
        submitted: taskAnnotations.filter(a => a.status === "submitted").length,
        approved: taskAnnotations.filter(a => a.status === "approved").length,
        rejected: taskAnnotations.filter(a => a.status === "rejected").length,
      };
      
      return {
        success: true,
        task,
        taxonomy,
        annotationStats: byStatus,
      };
    } catch (error) {
      logger.error("Get task failed:", error);
      throw error;
    }
  });

  /**
   * Update task status
   */
  ipcMain.handle("annotation:update-task-status", async (_event, args: {
    taskId: string;
    status: AnnotationTask["status"];
  }) => {
    try {
      const task = tasks.get(args.taskId);
      if (!task) throw new Error("Task not found");
      
      task.status = args.status;
      task.updatedAt = new Date();
      
      await saveTasks();
      
      return { success: true, task };
    } catch (error) {
      logger.error("Update task status failed:", error);
      throw error;
    }
  });

  /**
   * Get next item to annotate
   */
  ipcMain.handle("annotation:get-next-item", async (_event, args: {
    taskId: string;
    annotatorId: string;
  }) => {
    try {
      const task = tasks.get(args.taskId);
      if (!task) throw new Error("Task not found");
      if (task.status !== "active") throw new Error("Task is not active");
      
      // Get already annotated items by this annotator
      const annotatorAnnotations = Array.from(annotations.values()).filter(
        a => a.taskId === args.taskId && a.annotatorId === args.annotatorId
      );
      const annotatedItemIds = new Set(annotatorAnnotations.map(a => a.itemId));
      
      // Get items from dataset
      let itemsQuery = db.select().from(datasetItems).where(eq(datasetItems.datasetId, task.datasetId));
      const items = await itemsQuery;
      
      // Filter out already annotated items
      let availableItems = items.filter(item => !annotatedItemIds.has(item.id));
      
      // Apply item filters
      if (task.itemFilter?.splits && task.itemFilter.splits.length > 0) {
        availableItems = availableItems.filter(item => task.itemFilter!.splits!.includes(item.split));
      }
      
      if (task.itemFilter?.modalities && task.itemFilter.modalities.length > 0) {
        availableItems = availableItems.filter(item => task.itemFilter!.modalities!.includes(item.modality));
      }
      
      if (availableItems.length === 0) {
        return { success: true, item: null, message: "No more items to annotate" };
      }
      
      // Select item (random or sequential)
      let selectedItem;
      if (task.settings.randomOrder) {
        const randomIndex = Math.floor(Math.random() * availableItems.length);
        selectedItem = availableItems[randomIndex];
      } else {
        selectedItem = availableItems[0];
      }
      
      // Load content
      const storeDir = path.join(app.getPath("userData"), "content-store");
      const prefix = selectedItem.contentHash.substring(0, 2);
      const contentPath = path.join(storeDir, prefix, selectedItem.contentHash);
      
      let content: string | null = null;
      try {
        content = await fs.readFile(contentPath, "utf-8");
      } catch {
        // Binary content
      }
      
      // Get previous annotations if allowed
      let previousAnnotations: Annotation[] = [];
      if (task.settings.showPreviousAnnotations) {
        previousAnnotations = Array.from(annotations.values()).filter(
          a => a.itemId === selectedItem.id && a.taskId === args.taskId && a.annotatorId !== args.annotatorId
        );
      }
      
      return {
        success: true,
        item: selectedItem,
        content,
        previousAnnotations,
        remainingCount: availableItems.length - 1,
      };
    } catch (error) {
      logger.error("Get next item failed:", error);
      throw error;
    }
  });

  // ========== Annotation CRUD ==========

  /**
   * Submit annotation
   */
  ipcMain.handle("annotation:submit", async (_event, args: {
    taskId: string;
    itemId: string;
    annotatorId: string;
    labels: AnnotationLabel[];
    timeSpentMs?: number;
    notes?: string;
  }) => {
    try {
      const task = tasks.get(args.taskId);
      if (!task) throw new Error("Task not found");
      
      const id = uuidv4();
      const now = new Date();
      
      const annotation: Annotation = {
        id,
        itemId: args.itemId,
        taskId: args.taskId,
        annotatorId: args.annotatorId,
        labels: args.labels,
        status: task.settings.requireReview ? "submitted" : "approved",
        timeSpentMs: args.timeSpentMs,
        notes: args.notes,
        createdAt: now,
        updatedAt: now,
      };
      
      annotations.set(id, annotation);
      
      // Update task progress
      const taskAnnotations = Array.from(annotations.values()).filter(a => a.taskId === args.taskId);
      const uniqueAnnotatedItems = new Set(taskAnnotations.map(a => a.itemId));
      task.progress.annotatedItems = uniqueAnnotatedItems.size;
      task.updatedAt = now;
      
      await Promise.all([saveAnnotationsIndex(), saveTasks()]);
      
      // Update item labels in database
      await updateItemLabels(args.itemId, args.labels, task.taxonomyId);
      
      return { success: true, annotation };
    } catch (error) {
      logger.error("Submit annotation failed:", error);
      throw error;
    }
  });

  /**
   * Skip item
   */
  ipcMain.handle("annotation:skip-item", async (_event, args: {
    taskId: string;
    itemId: string;
    annotatorId: string;
    reason?: string;
  }) => {
    try {
      const task = tasks.get(args.taskId);
      if (!task) throw new Error("Task not found");
      if (!task.settings.allowSkip) throw new Error("Skipping is not allowed for this task");
      
      const id = uuidv4();
      const now = new Date();
      
      const annotation: Annotation = {
        id,
        itemId: args.itemId,
        taskId: args.taskId,
        annotatorId: args.annotatorId,
        labels: [],
        status: "pending",
        notes: args.reason ? `Skipped: ${args.reason}` : "Skipped",
        createdAt: now,
        updatedAt: now,
      };
      
      annotations.set(id, annotation);
      task.progress.skippedItems++;
      task.updatedAt = now;
      
      await Promise.all([saveAnnotationsIndex(), saveTasks()]);
      
      return { success: true };
    } catch (error) {
      logger.error("Skip item failed:", error);
      throw error;
    }
  });

  /**
   * Review annotation
   */
  ipcMain.handle("annotation:review", async (_event, args: {
    annotationId: string;
    reviewerId: string;
    approved: boolean;
    notes?: string;
  }) => {
    try {
      const annotation = annotations.get(args.annotationId);
      if (!annotation) throw new Error("Annotation not found");
      
      annotation.status = args.approved ? "approved" : "rejected";
      annotation.reviewedBy = args.reviewerId;
      annotation.reviewNotes = args.notes;
      annotation.updatedAt = new Date();
      
      // Update task progress
      const task = tasks.get(annotation.taskId);
      if (task) {
        const reviewedAnnotations = Array.from(annotations.values()).filter(
          a => a.taskId === annotation.taskId && (a.status === "approved" || a.status === "rejected")
        );
        task.progress.reviewedItems = reviewedAnnotations.length;
        task.updatedAt = new Date();
        await saveTasks();
      }
      
      await saveAnnotationsIndex();
      
      // Update item labels if approved
      if (args.approved && task) {
        await updateItemLabels(annotation.itemId, annotation.labels, task.taxonomyId);
      }
      
      return { success: true, annotation };
    } catch (error) {
      logger.error("Review annotation failed:", error);
      throw error;
    }
  });

  /**
   * Get annotations for item
   */
  ipcMain.handle("annotation:get-item-annotations", async (_event, args: {
    itemId: string;
    taskId?: string;
  }) => {
    try {
      let result = Array.from(annotations.values()).filter(a => a.itemId === args.itemId);
      
      if (args.taskId) {
        result = result.filter(a => a.taskId === args.taskId);
      }
      
      return { success: true, annotations: result };
    } catch (error) {
      logger.error("Get item annotations failed:", error);
      throw error;
    }
  });

  // ========== Templates ==========

  /**
   * List templates
   */
  ipcMain.handle("annotation:list-templates", async (_event, taskType?: string) => {
    try {
      let result = Array.from(templates.values());
      
      if (taskType) {
        result = result.filter(t => t.taskType === taskType);
      }
      
      return { success: true, templates: result };
    } catch (error) {
      logger.error("List templates failed:", error);
      throw error;
    }
  });

  /**
   * Create custom template
   */
  ipcMain.handle("annotation:create-template", async (_event, template: Omit<AnnotationTemplate, "id">) => {
    try {
      const id = uuidv4();
      const newTemplate: AnnotationTemplate = { ...template, id };
      
      templates.set(id, newTemplate);
      await saveTemplates();
      
      return { success: true, template: newTemplate };
    } catch (error) {
      logger.error("Create template failed:", error);
      throw error;
    }
  });

  // ========== Statistics ==========

  /**
   * Get annotator statistics
   */
  ipcMain.handle("annotation:get-annotator-stats", async (_event, args: {
    taskId?: string;
    annotatorId?: string;
  }) => {
    try {
      let relevantAnnotations = Array.from(annotations.values());
      
      if (args.taskId) {
        relevantAnnotations = relevantAnnotations.filter(a => a.taskId === args.taskId);
      }
      
      if (args.annotatorId) {
        relevantAnnotations = relevantAnnotations.filter(a => a.annotatorId === args.annotatorId);
      }
      
      // Group by annotator
      const byAnnotator: Map<string, Annotation[]> = new Map();
      for (const a of relevantAnnotations) {
        if (!byAnnotator.has(a.annotatorId)) {
          byAnnotator.set(a.annotatorId, []);
        }
        byAnnotator.get(a.annotatorId)!.push(a);
      }
      
      const stats: AnnotatorStats[] = [];
      
      for (const [annotatorId, annotatorAnnotations] of byAnnotator) {
        const approved = annotatorAnnotations.filter(a => a.status === "approved").length;
        const rejected = annotatorAnnotations.filter(a => a.status === "rejected").length;
        const totalTime = annotatorAnnotations.reduce((sum, a) => sum + (a.timeSpentMs || 0), 0);
        const avgTime = annotatorAnnotations.length > 0 ? totalTime / annotatorAnnotations.length : 0;
        const lastAnnotation = annotatorAnnotations.reduce(
          (latest, a) => a.updatedAt > latest ? a.updatedAt : latest,
          new Date(0)
        );
        
        stats.push({
          annotatorId,
          totalAnnotations: annotatorAnnotations.length,
          approvedAnnotations: approved,
          rejectedAnnotations: rejected,
          avgTimePerItem: avgTime,
          agreementScore: approved / (approved + rejected) || 0,
          lastActiveAt: lastAnnotation,
        });
      }
      
      return { success: true, stats };
    } catch (error) {
      logger.error("Get annotator stats failed:", error);
      throw error;
    }
  });

  /**
   * Calculate inter-annotator agreement
   */
  ipcMain.handle("annotation:calculate-agreement", async (_event, taskId: string) => {
    try {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      
      const taskAnnotations = Array.from(annotations.values()).filter(
        a => a.taskId === taskId && a.status === "approved"
      );
      
      // Group by item
      const byItem: Map<string, Annotation[]> = new Map();
      for (const a of taskAnnotations) {
        if (!byItem.has(a.itemId)) {
          byItem.set(a.itemId, []);
        }
        byItem.get(a.itemId)!.push(a);
      }
      
      // Calculate agreement for items with multiple annotations
      let totalAgreement = 0;
      let itemsWithMultiple = 0;
      
      for (const [itemId, itemAnnotations] of byItem) {
        if (itemAnnotations.length < 2) continue;
        
        itemsWithMultiple++;
        
        // Simple agreement: check if all annotators agree on labels
        const labelSets = itemAnnotations.map(a => 
          new Set(a.labels.map(l => l.labelId))
        );
        
        let agrees = 0;
        let total = 0;
        
        for (let i = 0; i < labelSets.length; i++) {
          for (let j = i + 1; j < labelSets.length; j++) {
            total++;
            const intersection = new Set([...labelSets[i]].filter(x => labelSets[j].has(x)));
            const union = new Set([...labelSets[i], ...labelSets[j]]);
            agrees += intersection.size / union.size; // Jaccard similarity
          }
        }
        
        totalAgreement += total > 0 ? agrees / total : 0;
      }
      
      const overallAgreement = itemsWithMultiple > 0 ? totalAgreement / itemsWithMultiple : 0;
      
      return {
        success: true,
        agreement: {
          overall: overallAgreement,
          itemsWithMultipleAnnotations: itemsWithMultiple,
          totalAnnotations: taskAnnotations.length,
        },
      };
    } catch (error) {
      logger.error("Calculate agreement failed:", error);
      throw error;
    }
  });

  // ========== Import/Export ==========

  /**
   * Export annotations
   */
  ipcMain.handle("annotation:export", async (_event, args: {
    taskId: string;
    format: "json" | "csv" | "coco" | "yolo";
    outputPath: string;
    includeMetadata?: boolean;
  }) => {
    try {
      const task = tasks.get(args.taskId);
      if (!task) throw new Error("Task not found");
      
      const taskAnnotations = Array.from(annotations.values()).filter(
        a => a.taskId === args.taskId && a.status === "approved"
      );
      
      const taxonomy = taxonomies.get(task.taxonomyId);
      
      await fs.ensureDir(path.dirname(args.outputPath));
      
      if (args.format === "json") {
        const exportData = {
          task: args.includeMetadata ? task : undefined,
          taxonomy: args.includeMetadata ? taxonomy : undefined,
          annotations: taskAnnotations.map(a => ({
            itemId: a.itemId,
            labels: a.labels,
            annotatorId: args.includeMetadata ? a.annotatorId : undefined,
            createdAt: a.createdAt,
          })),
        };
        
        await fs.writeJson(args.outputPath, exportData, { spaces: 2 });
      } else if (args.format === "csv") {
        const lines = ["item_id,label_id,label_name,value,confidence"];
        
        for (const a of taskAnnotations) {
          for (const l of a.labels) {
            const labelDef = taxonomy?.labels.find(ld => ld.id === l.labelId);
            lines.push(`${a.itemId},${l.labelId},${labelDef?.name || ""},${l.value || ""},${l.confidence || ""}`);
          }
        }
        
        await fs.writeFile(args.outputPath, lines.join("\n"));
      } else if (args.format === "coco") {
        // COCO format for object detection
        const cocoData = {
          info: { description: task.name, version: "1.0" },
          categories: taxonomy?.labels.map((l, idx) => ({ id: idx + 1, name: l.name })) || [],
          images: [] as any[],
          annotations: [] as any[],
        };
        
        const labelIdToCategory = new Map(taxonomy?.labels.map((l, idx) => [l.id, idx + 1]) || []);
        let annotationId = 1;
        
        for (const a of taskAnnotations) {
          const imageId = a.itemId;
          cocoData.images.push({ id: imageId, file_name: a.itemId });
          
          for (const l of a.labels) {
            if (l.boundingBox) {
              cocoData.annotations.push({
                id: annotationId++,
                image_id: imageId,
                category_id: labelIdToCategory.get(l.labelId) || 0,
                bbox: [l.boundingBox.x, l.boundingBox.y, l.boundingBox.width, l.boundingBox.height],
                area: l.boundingBox.width * l.boundingBox.height,
                iscrowd: 0,
              });
            }
          }
        }
        
        await fs.writeJson(args.outputPath, cocoData, { spaces: 2 });
      }
      
      return {
        success: true,
        exportedCount: taskAnnotations.length,
        outputPath: args.outputPath,
      };
    } catch (error) {
      logger.error("Export annotations failed:", error);
      throw error;
    }
  });

  /**
   * Import annotations
   */
  ipcMain.handle("annotation:import", async (_event, args: {
    taskId: string;
    filePath: string;
    format: "json" | "csv";
    annotatorId: string;
  }) => {
    try {
      const task = tasks.get(args.taskId);
      if (!task) throw new Error("Task not found");
      
      const fileContent = await fs.readFile(args.filePath, "utf-8");
      let imported = 0;
      
      if (args.format === "json") {
        const data = JSON.parse(fileContent);
        const annotationsData = data.annotations || data;
        
        for (const a of annotationsData) {
          const id = uuidv4();
          const now = new Date();
          
          annotations.set(id, {
            id,
            itemId: a.itemId || a.item_id,
            taskId: args.taskId,
            annotatorId: args.annotatorId,
            labels: a.labels || [],
            status: "approved",
            createdAt: now,
            updatedAt: now,
          });
          
          imported++;
        }
      } else if (args.format === "csv") {
        const lines = fileContent.split("\n").slice(1);
        const byItem: Map<string, AnnotationLabel[]> = new Map();
        
        for (const line of lines) {
          if (!line.trim()) continue;
          const [itemId, labelId, , value, confidence] = line.split(",");
          
          if (!byItem.has(itemId)) {
            byItem.set(itemId, []);
          }
          
          byItem.get(itemId)!.push({
            labelId,
            value: value || undefined,
            confidence: confidence ? parseFloat(confidence) : undefined,
          });
        }
        
        for (const [itemId, labels] of byItem) {
          const id = uuidv4();
          const now = new Date();
          
          annotations.set(id, {
            id,
            itemId,
            taskId: args.taskId,
            annotatorId: args.annotatorId,
            labels,
            status: "approved",
            createdAt: now,
            updatedAt: now,
          });
          
          imported++;
        }
      }
      
      // Update task progress
      const taskAnnotations = Array.from(annotations.values()).filter(a => a.taskId === args.taskId);
      const uniqueItems = new Set(taskAnnotations.map(a => a.itemId));
      task.progress.annotatedItems = uniqueItems.size;
      task.updatedAt = new Date();
      
      await Promise.all([saveAnnotationsIndex(), saveTasks()]);
      
      return { success: true, imported };
    } catch (error) {
      logger.error("Import annotations failed:", error);
      throw error;
    }
  });

  logger.info("Annotation System handlers registered");
}

// ============================================================================
// Helper Functions
// ============================================================================

async function updateItemLabels(itemId: string, labels: AnnotationLabel[], taxonomyId: string) {
  try {
    const taxonomy = taxonomies.get(taxonomyId);
    if (!taxonomy) return;
    
    // Convert annotation labels to ItemLabels format
    const tags: string[] = [];
    const categories: string[] = [];
    const boundingBoxes: any[] = [];
    
    for (const label of labels) {
      const labelDef = taxonomy.labels.find(l => l.id === label.labelId);
      if (!labelDef) continue;
      
      if (taxonomy.type === "classification") {
        if (taxonomy.hierarchical) {
          categories.push(labelDef.name);
        } else {
          tags.push(labelDef.name);
        }
      } else if (taxonomy.type === "detection" && label.boundingBox) {
        boundingBoxes.push({
          label: labelDef.name,
          ...label.boundingBox,
          confidence: label.confidence,
        });
      }
    }
    
    const labelsJson: any = {};
    if (tags.length > 0) labelsJson.tags = tags;
    if (categories.length > 0) labelsJson.categories = categories;
    if (boundingBoxes.length > 0) labelsJson.boundingBoxes = boundingBoxes;
    
    if (Object.keys(labelsJson).length > 0) {
      await db.update(datasetItems)
        .set({ 
          labelsJson,
          updatedAt: new Date(),
        })
        .where(eq(datasetItems.id, itemId));
    }
  } catch (error) {
    logger.error("Update item labels failed:", error);
  }
}
