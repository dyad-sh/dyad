/**
 * Schema Validation Handlers
 * JSON Schema validation for datasets with custom validation rules
 * 
 * Features:
 * - Schema management (JSON Schema draft-07/draft-2020-12)
 * - Dataset validation against schemas
 * - Custom validation rules
 * - Schema inference from data
 * - Validation reports
 * - Schema versioning
 * - Schema templates
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, inArray, and } from "drizzle-orm";
import { datasetItems, studioDatasets } from "@/db/schema";

const logger = log.scope("schema_validation");

// ============================================================================
// Types
// ============================================================================

interface Schema {
  id: string;
  name: string;
  description?: string;
  version: string;
  schema: JSONSchemaDefinition;
  customRules?: ValidationRule[];
  datasetId?: string; // Optional link to a dataset
  createdAt: Date;
  updatedAt: Date;
}

interface JSONSchemaDefinition {
  $schema?: string;
  $id?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchemaDefinition>;
  required?: string[];
  items?: JSONSchemaDefinition | JSONSchemaDefinition[];
  additionalProperties?: boolean | JSONSchemaDefinition;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  enum?: any[];
  const?: any;
  format?: string;
  oneOf?: JSONSchemaDefinition[];
  anyOf?: JSONSchemaDefinition[];
  allOf?: JSONSchemaDefinition[];
  not?: JSONSchemaDefinition;
  if?: JSONSchemaDefinition;
  then?: JSONSchemaDefinition;
  else?: JSONSchemaDefinition;
  $ref?: string;
  definitions?: Record<string, JSONSchemaDefinition>;
  $defs?: Record<string, JSONSchemaDefinition>;
  title?: string;
  description?: string;
  default?: any;
  examples?: any[];
  [key: string]: any;
}

interface ValidationRule {
  id: string;
  name: string;
  description?: string;
  type: "required" | "type" | "pattern" | "range" | "custom" | "relationship" | "consistency";
  field?: string;
  config: Record<string, any>;
  severity: "error" | "warning" | "info";
  enabled: boolean;
}

interface ValidationResult {
  valid: boolean;
  itemId: string;
  errors: ValidationError[];
  warnings: ValidationError[];
  info: ValidationError[];
}

interface ValidationError {
  path: string;
  message: string;
  value?: any;
  rule?: string;
  severity: "error" | "warning" | "info";
}

interface ValidationReport {
  id: string;
  schemaId: string;
  datasetId: string;
  validatedAt: Date;
  totalItems: number;
  validItems: number;
  invalidItems: number;
  errorCount: number;
  warningCount: number;
  errorsByPath: Record<string, number>;
  errorsByRule: Record<string, number>;
  sampleErrors: ValidationError[];
  duration: number;
}

interface SchemaTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  schema: JSONSchemaDefinition;
  customRules?: Omit<ValidationRule, "id">[];
}

// ============================================================================
// Storage
// ============================================================================

const schemas: Map<string, Schema> = new Map();
const validationReports: Map<string, ValidationReport> = new Map();
const templates: Map<string, SchemaTemplate> = new Map();

function getSchemaStorageDir(): string {
  return path.join(app.getPath("userData"), "schemas");
}

async function initializeSchemaStorage() {
  const storageDir = getSchemaStorageDir();
  await fs.ensureDir(storageDir);
  await fs.ensureDir(path.join(storageDir, "reports"));
  
  // Load schemas
  const schemasPath = path.join(storageDir, "schemas.json");
  if (await fs.pathExists(schemasPath)) {
    const data = await fs.readJson(schemasPath);
    for (const s of data) {
      schemas.set(s.id, {
        ...s,
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
      });
    }
  }
  
  // Load reports
  const reportsPath = path.join(storageDir, "reports-index.json");
  if (await fs.pathExists(reportsPath)) {
    const data = await fs.readJson(reportsPath);
    for (const r of data) {
      validationReports.set(r.id, { ...r, validatedAt: new Date(r.validatedAt) });
    }
  }
  
  // Initialize default templates
  initializeDefaultTemplates();
  
  logger.info(`Loaded ${schemas.size} schemas, ${validationReports.size} reports`);
}

function initializeDefaultTemplates() {
  const defaultTemplates: SchemaTemplate[] = [
    {
      id: "text-classification",
      name: "Text Classification",
      description: "Schema for text classification datasets",
      category: "nlp",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          text: { type: "string", minLength: 1 },
          label: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["text", "label"],
      },
      customRules: [
        {
          name: "Non-empty text",
          type: "custom",
          field: "text",
          config: { minWords: 1 },
          severity: "error",
          enabled: true,
        },
      ],
    },
    {
      id: "instruction-tuning",
      name: "Instruction Tuning",
      description: "Schema for instruction-following datasets (Alpaca format)",
      category: "nlp",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          instruction: { type: "string", minLength: 1 },
          input: { type: "string" },
          output: { type: "string", minLength: 1 },
        },
        required: ["instruction", "output"],
      },
    },
    {
      id: "conversation",
      name: "Conversation",
      description: "Schema for multi-turn conversation datasets",
      category: "nlp",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["system", "user", "assistant"] },
                content: { type: "string", minLength: 1 },
              },
              required: ["role", "content"],
            },
            minItems: 1,
          },
        },
        required: ["messages"],
      },
    },
    {
      id: "qa",
      name: "Question Answering",
      description: "Schema for QA datasets",
      category: "nlp",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          context: { type: "string" },
          question: { type: "string", minLength: 1 },
          answer: { type: "string", minLength: 1 },
          answer_start: { type: "integer", minimum: 0 },
        },
        required: ["question", "answer"],
      },
    },
    {
      id: "image-classification",
      name: "Image Classification",
      description: "Schema for image classification datasets",
      category: "vision",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          image_path: { type: "string" },
          image_url: { type: "string", format: "uri" },
          label: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
        },
        anyOf: [
          { required: ["image_path", "label"] },
          { required: ["image_url", "label"] },
          { required: ["image_path", "labels"] },
          { required: ["image_url", "labels"] },
        ],
      },
    },
    {
      id: "object-detection",
      name: "Object Detection",
      description: "Schema for object detection datasets",
      category: "vision",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          image_path: { type: "string" },
          annotations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                bbox: {
                  type: "array",
                  items: { type: "number" },
                  minItems: 4,
                  maxItems: 4,
                },
              },
              required: ["label", "bbox"],
            },
          },
        },
        required: ["image_path", "annotations"],
      },
    },
    {
      id: "generic",
      name: "Generic Data",
      description: "Flexible schema for any structured data",
      category: "general",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        additionalProperties: true,
      },
    },
  ];
  
  for (const t of defaultTemplates) {
    templates.set(t.id, t);
  }
}

async function saveSchemas() {
  const storageDir = getSchemaStorageDir();
  await fs.writeJson(
    path.join(storageDir, "schemas.json"),
    Array.from(schemas.values()),
    { spaces: 2 }
  );
}

async function saveReportsIndex() {
  const storageDir = getSchemaStorageDir();
  await fs.writeJson(
    path.join(storageDir, "reports-index.json"),
    Array.from(validationReports.values()),
    { spaces: 2 }
  );
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerSchemaValidationHandlers() {
  logger.info("Registering Schema Validation handlers");

  app.whenReady().then(() => {
    initializeSchemaStorage().catch(err => {
      logger.error("Failed to initialize schema storage:", err);
    });
  });

  // ========== Schema CRUD ==========

  /**
   * Create a new schema
   */
  ipcMain.handle("schema:create", async (_event, args: {
    name: string;
    description?: string;
    schema: JSONSchemaDefinition;
    customRules?: Omit<ValidationRule, "id">[];
    datasetId?: string;
  }) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      const newSchema: Schema = {
        id,
        name: args.name,
        description: args.description,
        version: "1.0.0",
        schema: args.schema,
        customRules: args.customRules?.map(r => ({ ...r, id: uuidv4() })),
        datasetId: args.datasetId,
        createdAt: now,
        updatedAt: now,
      };
      
      schemas.set(id, newSchema);
      await saveSchemas();
      
      return { success: true, schema: newSchema };
    } catch (error) {
      logger.error("Create schema failed:", error);
      throw error;
    }
  });

  /**
   * Create schema from template
   */
  ipcMain.handle("schema:create-from-template", async (_event, args: {
    templateId: string;
    name: string;
    description?: string;
    datasetId?: string;
  }) => {
    try {
      const template = templates.get(args.templateId);
      if (!template) throw new Error("Template not found");
      
      const id = uuidv4();
      const now = new Date();
      
      const newSchema: Schema = {
        id,
        name: args.name,
        description: args.description || template.description,
        version: "1.0.0",
        schema: JSON.parse(JSON.stringify(template.schema)),
        customRules: template.customRules?.map(r => ({ ...r, id: uuidv4() })),
        datasetId: args.datasetId,
        createdAt: now,
        updatedAt: now,
      };
      
      schemas.set(id, newSchema);
      await saveSchemas();
      
      return { success: true, schema: newSchema };
    } catch (error) {
      logger.error("Create from template failed:", error);
      throw error;
    }
  });

  /**
   * List schemas
   */
  ipcMain.handle("schema:list", async (_event, args?: {
    datasetId?: string;
  }) => {
    try {
      let result = Array.from(schemas.values());
      
      if (args?.datasetId) {
        result = result.filter(s => s.datasetId === args.datasetId || !s.datasetId);
      }
      
      result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      
      return { success: true, schemas: result };
    } catch (error) {
      logger.error("List schemas failed:", error);
      throw error;
    }
  });

  /**
   * Get schema
   */
  ipcMain.handle("schema:get", async (_event, schemaId: string) => {
    try {
      const schema = schemas.get(schemaId);
      if (!schema) throw new Error("Schema not found");
      
      return { success: true, schema };
    } catch (error) {
      logger.error("Get schema failed:", error);
      throw error;
    }
  });

  /**
   * Update schema
   */
  ipcMain.handle("schema:update", async (_event, args: {
    schemaId: string;
    updates: Partial<Omit<Schema, "id" | "createdAt">>;
    bumpVersion?: boolean;
  }) => {
    try {
      const schema = schemas.get(args.schemaId);
      if (!schema) throw new Error("Schema not found");
      
      if (args.updates.name) schema.name = args.updates.name;
      if (args.updates.description !== undefined) schema.description = args.updates.description;
      if (args.updates.schema) schema.schema = args.updates.schema;
      if (args.updates.customRules) {
        schema.customRules = args.updates.customRules.map(r => 
          r.id ? r : { ...r, id: uuidv4() }
        );
      }
      
      if (args.bumpVersion) {
        const [major, minor, patch] = schema.version.split(".").map(Number);
        schema.version = `${major}.${minor}.${patch + 1}`;
      }
      
      schema.updatedAt = new Date();
      
      await saveSchemas();
      
      return { success: true, schema };
    } catch (error) {
      logger.error("Update schema failed:", error);
      throw error;
    }
  });

  /**
   * Delete schema
   */
  ipcMain.handle("schema:delete", async (_event, schemaId: string) => {
    try {
      if (!schemas.has(schemaId)) throw new Error("Schema not found");
      
      schemas.delete(schemaId);
      await saveSchemas();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete schema failed:", error);
      throw error;
    }
  });

  // ========== Validation ==========

  /**
   * Validate a single item
   */
  ipcMain.handle("schema:validate-item", async (_event, args: {
    schemaId: string;
    data: any;
  }) => {
    try {
      const schema = schemas.get(args.schemaId);
      if (!schema) throw new Error("Schema not found");
      
      const result = validateData(args.data, schema.schema, schema.customRules);
      
      return { success: true, result };
    } catch (error) {
      logger.error("Validate item failed:", error);
      throw error;
    }
  });

  /**
   * Validate entire dataset
   */
  ipcMain.handle("schema:validate-dataset", async (_event, args: {
    schemaId: string;
    datasetId: string;
    sampleSize?: number;
  }) => {
    try {
      const schema = schemas.get(args.schemaId);
      if (!schema) throw new Error("Schema not found");
      
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, args.datasetId));
      if (!dataset) throw new Error("Dataset not found");
      
      let items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, args.datasetId));
      
      // Apply sample size if specified
      if (args.sampleSize && args.sampleSize < items.length) {
        items = items.sort(() => Math.random() - 0.5).slice(0, args.sampleSize);
      }
      
      const startTime = Date.now();
      const results: ValidationResult[] = [];
      const errorsByPath: Record<string, number> = {};
      const errorsByRule: Record<string, number> = {};
      const sampleErrors: ValidationError[] = [];
      
      const contentStoreDir = path.join(app.getPath("userData"), "content-store");
      
      for (const item of items) {
        // Load content
        const prefix = item.contentHash.substring(0, 2);
        const contentPath = path.join(contentStoreDir, prefix, item.contentHash);
        
        let data: any;
        try {
          const content = await fs.readFile(contentPath, "utf-8");
          data = JSON.parse(content);
        } catch {
          // Not JSON or can't read
          results.push({
            valid: false,
            itemId: item.id,
            errors: [{ path: "$", message: "Could not parse content as JSON", severity: "error" }],
            warnings: [],
            info: [],
          });
          continue;
        }
        
        const result = validateData(data, schema.schema, schema.customRules, item.id);
        results.push(result);
        
        // Aggregate errors
        for (const error of result.errors) {
          errorsByPath[error.path] = (errorsByPath[error.path] || 0) + 1;
          if (error.rule) {
            errorsByRule[error.rule] = (errorsByRule[error.rule] || 0) + 1;
          }
          if (sampleErrors.length < 20) {
            sampleErrors.push(error);
          }
        }
      }
      
      const duration = Date.now() - startTime;
      
      const validItems = results.filter(r => r.valid).length;
      const errorCount = results.reduce((sum, r) => sum + r.errors.length, 0);
      const warningCount = results.reduce((sum, r) => sum + r.warnings.length, 0);
      
      // Create report
      const reportId = uuidv4();
      const report: ValidationReport = {
        id: reportId,
        schemaId: args.schemaId,
        datasetId: args.datasetId,
        validatedAt: new Date(),
        totalItems: items.length,
        validItems,
        invalidItems: items.length - validItems,
        errorCount,
        warningCount,
        errorsByPath,
        errorsByRule,
        sampleErrors,
        duration,
      };
      
      validationReports.set(reportId, report);
      await saveReportsIndex();
      
      // Save detailed results
      const reportPath = path.join(getSchemaStorageDir(), "reports", `${reportId}.json`);
      await fs.writeJson(reportPath, { report, results }, { spaces: 2 });
      
      return {
        success: true,
        report,
        summary: {
          validationRate: items.length > 0 ? validItems / items.length : 1,
          avgErrorsPerItem: items.length > 0 ? errorCount / items.length : 0,
          topErrors: Object.entries(errorsByPath)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([path, count]) => ({ path, count })),
        },
      };
    } catch (error) {
      logger.error("Validate dataset failed:", error);
      throw error;
    }
  });

  /**
   * Get validation report
   */
  ipcMain.handle("schema:get-report", async (_event, reportId: string) => {
    try {
      const report = validationReports.get(reportId);
      if (!report) throw new Error("Report not found");
      
      // Load detailed results
      const reportPath = path.join(getSchemaStorageDir(), "reports", `${reportId}.json`);
      let results: ValidationResult[] = [];
      
      if (await fs.pathExists(reportPath)) {
        const data = await fs.readJson(reportPath);
        results = data.results;
      }
      
      return { success: true, report, results };
    } catch (error) {
      logger.error("Get report failed:", error);
      throw error;
    }
  });

  /**
   * List validation reports
   */
  ipcMain.handle("schema:list-reports", async (_event, args?: {
    datasetId?: string;
    schemaId?: string;
    limit?: number;
  }) => {
    try {
      let result = Array.from(validationReports.values());
      
      if (args?.datasetId) {
        result = result.filter(r => r.datasetId === args.datasetId);
      }
      
      if (args?.schemaId) {
        result = result.filter(r => r.schemaId === args.schemaId);
      }
      
      result.sort((a, b) => b.validatedAt.getTime() - a.validatedAt.getTime());
      
      if (args?.limit) {
        result = result.slice(0, args.limit);
      }
      
      return { success: true, reports: result };
    } catch (error) {
      logger.error("List reports failed:", error);
      throw error;
    }
  });

  // ========== Schema Inference ==========

  /**
   * Infer schema from dataset
   */
  ipcMain.handle("schema:infer", async (_event, args: {
    datasetId: string;
    sampleSize?: number;
  }) => {
    try {
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, args.datasetId));
      if (!dataset) throw new Error("Dataset not found");
      
      let items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, args.datasetId));
      
      // Sample items
      const sampleSize = args.sampleSize || Math.min(100, items.length);
      items = items.sort(() => Math.random() - 0.5).slice(0, sampleSize);
      
      const contentStoreDir = path.join(app.getPath("userData"), "content-store");
      const samples: any[] = [];
      
      for (const item of items) {
        const prefix = item.contentHash.substring(0, 2);
        const contentPath = path.join(contentStoreDir, prefix, item.contentHash);
        
        try {
          const content = await fs.readFile(contentPath, "utf-8");
          const data = JSON.parse(content);
          samples.push(data);
        } catch {
          // Skip non-JSON items
        }
      }
      
      if (samples.length === 0) {
        throw new Error("No valid JSON samples found in dataset");
      }
      
      // Infer schema from samples
      const inferredSchema = inferSchemaFromSamples(samples);
      
      return { success: true, schema: inferredSchema, samplesAnalyzed: samples.length };
    } catch (error) {
      logger.error("Infer schema failed:", error);
      throw error;
    }
  });

  // ========== Templates ==========

  /**
   * List templates
   */
  ipcMain.handle("schema:list-templates", async (_event, category?: string) => {
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
   * Get template categories
   */
  ipcMain.handle("schema:get-categories", async () => {
    try {
      const categories = new Set(Array.from(templates.values()).map(t => t.category));
      return { success: true, categories: Array.from(categories) };
    } catch (error) {
      logger.error("Get categories failed:", error);
      throw error;
    }
  });

  // ========== Custom Rules ==========

  /**
   * Add custom rule to schema
   */
  ipcMain.handle("schema:add-rule", async (_event, args: {
    schemaId: string;
    rule: Omit<ValidationRule, "id">;
  }) => {
    try {
      const schema = schemas.get(args.schemaId);
      if (!schema) throw new Error("Schema not found");
      
      const rule: ValidationRule = {
        ...args.rule,
        id: uuidv4(),
      };
      
      if (!schema.customRules) {
        schema.customRules = [];
      }
      
      schema.customRules.push(rule);
      schema.updatedAt = new Date();
      
      await saveSchemas();
      
      return { success: true, rule };
    } catch (error) {
      logger.error("Add rule failed:", error);
      throw error;
    }
  });

  /**
   * Remove custom rule from schema
   */
  ipcMain.handle("schema:remove-rule", async (_event, args: {
    schemaId: string;
    ruleId: string;
  }) => {
    try {
      const schema = schemas.get(args.schemaId);
      if (!schema) throw new Error("Schema not found");
      
      if (schema.customRules) {
        schema.customRules = schema.customRules.filter(r => r.id !== args.ruleId);
        schema.updatedAt = new Date();
        await saveSchemas();
      }
      
      return { success: true };
    } catch (error) {
      logger.error("Remove rule failed:", error);
      throw error;
    }
  });

  /**
   * Export schema
   */
  ipcMain.handle("schema:export", async (_event, args: {
    schemaId: string;
    outputPath: string;
    format?: "json" | "yaml";
  }) => {
    try {
      const schema = schemas.get(args.schemaId);
      if (!schema) throw new Error("Schema not found");
      
      await fs.ensureDir(path.dirname(args.outputPath));
      
      if (args.format === "yaml") {
        // Simple YAML-like output
        const lines = [
          `# Schema: ${schema.name}`,
          `# Version: ${schema.version}`,
          "",
        ];
        lines.push(JSON.stringify(schema.schema, null, 2));
        await fs.writeFile(args.outputPath, lines.join("\n"));
      } else {
        await fs.writeJson(args.outputPath, {
          $schema: "http://json-schema.org/draft-07/schema#",
          title: schema.name,
          description: schema.description,
          ...schema.schema,
        }, { spaces: 2 });
      }
      
      return { success: true, outputPath: args.outputPath };
    } catch (error) {
      logger.error("Export schema failed:", error);
      throw error;
    }
  });

  /**
   * Import schema
   */
  ipcMain.handle("schema:import", async (_event, args: {
    filePath: string;
    name: string;
    datasetId?: string;
  }) => {
    try {
      const content = await fs.readFile(args.filePath, "utf-8");
      let schemaData: JSONSchemaDefinition;
      
      try {
        schemaData = JSON.parse(content);
      } catch {
        throw new Error("Invalid JSON schema file");
      }
      
      const id = uuidv4();
      const now = new Date();
      
      const newSchema: Schema = {
        id,
        name: args.name,
        description: schemaData.description,
        version: "1.0.0",
        schema: schemaData,
        datasetId: args.datasetId,
        createdAt: now,
        updatedAt: now,
      };
      
      schemas.set(id, newSchema);
      await saveSchemas();
      
      return { success: true, schema: newSchema };
    } catch (error) {
      logger.error("Import schema failed:", error);
      throw error;
    }
  });

  logger.info("Schema Validation handlers registered");
}

// ============================================================================
// Validation Engine
// ============================================================================

function validateData(
  data: any,
  schema: JSONSchemaDefinition,
  customRules?: ValidationRule[],
  itemId?: string
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const info: ValidationError[] = [];
  
  // JSON Schema validation
  validateJsonSchema(data, schema, "$", errors);
  
  // Custom rules validation
  if (customRules) {
    for (const rule of customRules) {
      if (!rule.enabled) continue;
      
      const ruleErrors = validateCustomRule(data, rule);
      
      for (const error of ruleErrors) {
        error.rule = rule.name;
        
        if (rule.severity === "error") {
          errors.push(error);
        } else if (rule.severity === "warning") {
          warnings.push(error);
        } else {
          info.push(error);
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    itemId: itemId || "",
    errors,
    warnings,
    info,
  };
}

function validateJsonSchema(
  data: any,
  schema: JSONSchemaDefinition,
  path: string,
  errors: ValidationError[]
): void {
  // Type validation
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = getJsonType(data);
    
    if (!types.includes(actualType) && !(types.includes("integer") && actualType === "number" && Number.isInteger(data))) {
      errors.push({
        path,
        message: `Expected type ${types.join(" | ")}, got ${actualType}`,
        value: data,
        severity: "error",
      });
      return; // Don't continue if type is wrong
    }
  }
  
  // Null check
  if (data === null || data === undefined) {
    if (schema.type && !Array.isArray(schema.type) && schema.type !== "null") {
      errors.push({
        path,
        message: "Value is null/undefined but not allowed",
        severity: "error",
      });
    }
    return;
  }
  
  // String validations
  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        path,
        message: `String length ${data.length} is less than minimum ${schema.minLength}`,
        value: data,
        severity: "error",
      });
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        path,
        message: `String length ${data.length} exceeds maximum ${schema.maxLength}`,
        value: data,
        severity: "error",
      });
    }
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(data)) {
        errors.push({
          path,
          message: `String does not match pattern ${schema.pattern}`,
          value: data,
          severity: "error",
        });
      }
    }
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push({
        path,
        message: `Value must be one of: ${schema.enum.join(", ")}`,
        value: data,
        severity: "error",
      });
    }
  }
  
  // Number validations
  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({
        path,
        message: `Value ${data} is less than minimum ${schema.minimum}`,
        value: data,
        severity: "error",
      });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({
        path,
        message: `Value ${data} exceeds maximum ${schema.maximum}`,
        value: data,
        severity: "error",
      });
    }
  }
  
  // Object validations
  if (typeof data === "object" && !Array.isArray(data)) {
    // Required properties
    if (schema.required) {
      for (const requiredProp of schema.required) {
        if (!(requiredProp in data)) {
          errors.push({
            path: `${path}.${requiredProp}`,
            message: `Missing required property: ${requiredProp}`,
            severity: "error",
          });
        }
      }
    }
    
    // Property validations
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in data) {
          validateJsonSchema(data[propName], propSchema, `${path}.${propName}`, errors);
        }
      }
    }
    
    // Additional properties
    if (schema.additionalProperties === false && schema.properties) {
      const allowedProps = new Set(Object.keys(schema.properties));
      for (const prop of Object.keys(data)) {
        if (!allowedProps.has(prop)) {
          errors.push({
            path: `${path}.${prop}`,
            message: `Additional property not allowed: ${prop}`,
            severity: "error",
          });
        }
      }
    }
  }
  
  // Array validations
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        path,
        message: `Array has ${data.length} items, minimum is ${schema.minItems}`,
        severity: "error",
      });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        path,
        message: `Array has ${data.length} items, maximum is ${schema.maxItems}`,
        severity: "error",
      });
    }
    
    // Items validation
    if (schema.items && !Array.isArray(schema.items)) {
      for (let i = 0; i < data.length; i++) {
        validateJsonSchema(data[i], schema.items, `${path}[${i}]`, errors);
      }
    }
  }
  
  // OneOf validation
  if (schema.oneOf) {
    const matchingSchemas = schema.oneOf.filter(subSchema => {
      const subErrors: ValidationError[] = [];
      validateJsonSchema(data, subSchema, path, subErrors);
      return subErrors.length === 0;
    });
    
    if (matchingSchemas.length !== 1) {
      errors.push({
        path,
        message: `Value must match exactly one schema in oneOf (matched ${matchingSchemas.length})`,
        severity: "error",
      });
    }
  }
  
  // AnyOf validation
  if (schema.anyOf) {
    const matchesAny = schema.anyOf.some(subSchema => {
      const subErrors: ValidationError[] = [];
      validateJsonSchema(data, subSchema, path, subErrors);
      return subErrors.length === 0;
    });
    
    if (!matchesAny) {
      errors.push({
        path,
        message: "Value must match at least one schema in anyOf",
        severity: "error",
      });
    }
  }
}

function validateCustomRule(data: any, rule: ValidationRule): ValidationError[] {
  const errors: ValidationError[] = [];
  
  const value = rule.field ? getNestedValue(data, rule.field) : data;
  
  switch (rule.type) {
    case "required":
      if (value === undefined || value === null || value === "") {
        errors.push({
          path: rule.field || "$",
          message: rule.config.message || `${rule.field} is required`,
          severity: rule.severity,
        });
      }
      break;
    
    case "pattern":
      if (typeof value === "string" && rule.config.pattern) {
        const regex = new RegExp(rule.config.pattern);
        if (!regex.test(value)) {
          errors.push({
            path: rule.field || "$",
            message: rule.config.message || `Value does not match pattern`,
            value,
            severity: rule.severity,
          });
        }
      }
      break;
    
    case "range":
      if (typeof value === "number") {
        if (rule.config.min !== undefined && value < rule.config.min) {
          errors.push({
            path: rule.field || "$",
            message: `Value ${value} is below minimum ${rule.config.min}`,
            value,
            severity: rule.severity,
          });
        }
        if (rule.config.max !== undefined && value > rule.config.max) {
          errors.push({
            path: rule.field || "$",
            message: `Value ${value} exceeds maximum ${rule.config.max}`,
            value,
            severity: rule.severity,
          });
        }
      }
      break;
    
    case "custom":
      // Custom validation logic
      if (rule.config.minWords && typeof value === "string") {
        const wordCount = value.trim().split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount < rule.config.minWords) {
          errors.push({
            path: rule.field || "$",
            message: `Text has ${wordCount} words, minimum is ${rule.config.minWords}`,
            value,
            severity: rule.severity,
          });
        }
      }
      if (rule.config.maxWords && typeof value === "string") {
        const wordCount = value.trim().split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount > rule.config.maxWords) {
          errors.push({
            path: rule.field || "$",
            message: `Text has ${wordCount} words, maximum is ${rule.config.maxWords}`,
            value,
            severity: rule.severity,
          });
        }
      }
      break;
    
    case "consistency":
      // Check consistency between fields
      if (rule.config.fields && Array.isArray(rule.config.fields)) {
        const values = rule.config.fields.map((f: string) => getNestedValue(data, f));
        if (rule.config.allEqual && !values.every(v => v === values[0])) {
          errors.push({
            path: rule.config.fields.join(", "),
            message: `Fields must have equal values`,
            severity: rule.severity,
          });
        }
      }
      break;
  }
  
  return errors;
}

// ============================================================================
// Schema Inference
// ============================================================================

function inferSchemaFromSamples(samples: any[]): JSONSchemaDefinition {
  if (samples.length === 0) {
    return { type: "object" };
  }
  
  const types = new Set<string>();
  const propertySchemas: Record<string, JSONSchemaDefinition[]> = {};
  const requiredCounts: Record<string, number> = {};
  
  for (const sample of samples) {
    const type = getJsonType(sample);
    types.add(type);
    
    if (type === "object" && sample !== null) {
      for (const [key, value] of Object.entries(sample)) {
        if (!propertySchemas[key]) {
          propertySchemas[key] = [];
        }
        propertySchemas[key].push(inferSchemaFromValue(value));
        requiredCounts[key] = (requiredCounts[key] || 0) + 1;
      }
    }
  }
  
  // Determine type
  const typeArray = Array.from(types);
  const schema: JSONSchemaDefinition = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: typeArray.length === 1 ? typeArray[0] : typeArray,
  };
  
  // For objects, merge property schemas
  if (types.has("object")) {
    schema.properties = {};
    schema.required = [];
    
    for (const [prop, propSchemas] of Object.entries(propertySchemas)) {
      schema.properties[prop] = mergeSchemas(propSchemas);
      
      // Property is required if present in all samples
      if (requiredCounts[prop] === samples.length) {
        schema.required.push(prop);
      }
    }
    
    if (schema.required.length === 0) {
      delete schema.required;
    }
  }
  
  return schema;
}

function inferSchemaFromValue(value: any): JSONSchemaDefinition {
  const type = getJsonType(value);
  
  const schema: JSONSchemaDefinition = { type };
  
  if (type === "object" && value !== null) {
    schema.properties = {};
    for (const [key, val] of Object.entries(value)) {
      schema.properties[key] = inferSchemaFromValue(val);
    }
  } else if (type === "array" && Array.isArray(value) && value.length > 0) {
    const itemSchemas = value.map(inferSchemaFromValue);
    schema.items = mergeSchemas(itemSchemas);
  } else if (type === "string" && typeof value === "string") {
    // Detect common formats
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      schema.format = "date-time";
    } else if (/^https?:\/\//.test(value)) {
      schema.format = "uri";
    } else if (/^[^@]+@[^@]+\.[^@]+$/.test(value)) {
      schema.format = "email";
    }
  }
  
  return schema;
}

function mergeSchemas(schemas: JSONSchemaDefinition[]): JSONSchemaDefinition {
  if (schemas.length === 0) return {};
  if (schemas.length === 1) return schemas[0];
  
  const types = new Set<string>();
  const mergedProperties: Record<string, JSONSchemaDefinition[]> = {};
  
  for (const schema of schemas) {
    if (schema.type) {
      if (Array.isArray(schema.type)) {
        schema.type.forEach(t => types.add(t));
      } else {
        types.add(schema.type);
      }
    }
    
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (!mergedProperties[prop]) {
          mergedProperties[prop] = [];
        }
        mergedProperties[prop].push(propSchema);
      }
    }
  }
  
  const merged: JSONSchemaDefinition = {};
  
  const typeArray = Array.from(types);
  if (typeArray.length === 1) {
    merged.type = typeArray[0];
  } else if (typeArray.length > 1) {
    merged.type = typeArray;
  }
  
  if (Object.keys(mergedProperties).length > 0) {
    merged.properties = {};
    for (const [prop, propSchemas] of Object.entries(mergedProperties)) {
      merged.properties[prop] = mergeSchemas(propSchemas);
    }
  }
  
  return merged;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getJsonType(value: any): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "boolean") return "boolean";
  return "null";
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    
    // Handle array index
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]];
      if (Array.isArray(current)) {
        current = current[parseInt(arrayMatch[2])];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }
  
  return current;
}
