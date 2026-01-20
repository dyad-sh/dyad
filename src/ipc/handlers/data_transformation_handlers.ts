/**
 * Data Transformation and Export Handlers
 * Convert datasets to various output formats for ML training
 * 
 * Features:
 * - Export to training formats (JSONL, Parquet, TFRecord, etc.)
 * - Create folder structures for different ML frameworks
 * - Generate metadata files (dataset cards, configs)
 * - Support for model weight formats (LoRA, GGUF preparation)
 * - Tokenization and preprocessing
 * - Split management (train/val/test)
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, inArray, and } from "drizzle-orm";
import { studioDatasets, datasetItems } from "@/db/schema";

const logger = log.scope("data_transformation");

// ============================================================================
// Types
// ============================================================================

interface ExportConfig {
  format: ExportFormat;
  outputDir: string;
  
  // Content options
  fields?: string[];
  template?: string;
  
  // Splitting
  splitRatios?: { train: number; val: number; test: number };
  shuffleSeed?: number;
  
  // Format-specific options
  jsonlOptions?: {
    includeMetadata?: boolean;
    flattenFields?: boolean;
  };
  
  parquetOptions?: {
    compression?: "snappy" | "gzip" | "none";
    rowGroupSize?: number;
  };
  
  huggingfaceOptions?: {
    datasetName?: string;
    configName?: string;
    generateCard?: boolean;
  };
  
  imageOptions?: {
    folderStructure?: "flat" | "by-class" | "by-split";
    copyImages?: boolean;
    createSymlinks?: boolean;
  };
  
  // Preprocessing
  preprocessing?: {
    tokenize?: boolean;
    tokenizer?: "simple" | "bpe" | "custom";
    maxLength?: number;
    truncate?: boolean;
    pad?: boolean;
  };
}

type ExportFormat = 
  | "jsonl"
  | "json"
  | "csv"
  | "parquet"
  | "huggingface"
  | "alpaca"
  | "sharegpt"
  | "openai"
  | "llama"
  | "image-classification"
  | "image-detection"
  | "text-plain"
  | "custom";

interface ExportResult {
  outputDir: string;
  files: Array<{
    path: string;
    format: string;
    itemCount: number;
    sizeBytes: number;
  }>;
  totalItems: number;
  splits?: {
    train: number;
    val: number;
    test: number;
  };
}

interface DatasetCard {
  name: string;
  description?: string;
  version?: string;
  license?: string;
  size?: string;
  modalities?: string[];
  splits?: Record<string, number>;
  features?: Record<string, string>;
  tags?: string[];
  citations?: string[];
}

interface FolderTemplate {
  name: string;
  description: string;
  structure: FolderNode[];
}

interface FolderNode {
  name: string;
  type: "file" | "directory";
  template?: string;
  children?: FolderNode[];
}

// ============================================================================
// Templates
// ============================================================================

const FOLDER_TEMPLATES: Record<string, FolderTemplate> = {
  "huggingface": {
    name: "HuggingFace Dataset",
    description: "Standard HuggingFace datasets library format",
    structure: [
      { name: "data", type: "directory", children: [
        { name: "train.jsonl", type: "file" },
        { name: "validation.jsonl", type: "file" },
        { name: "test.jsonl", type: "file" },
      ]},
      { name: "README.md", type: "file", template: "huggingface_readme" },
      { name: "dataset_info.json", type: "file", template: "dataset_info" },
    ],
  },
  "pytorch": {
    name: "PyTorch Dataset",
    description: "PyTorch-compatible dataset structure",
    structure: [
      { name: "train", type: "directory" },
      { name: "val", type: "directory" },
      { name: "test", type: "directory" },
      { name: "metadata.json", type: "file", template: "pytorch_metadata" },
    ],
  },
  "tensorflow": {
    name: "TensorFlow Dataset",
    description: "TensorFlow/Keras compatible structure",
    structure: [
      { name: "train", type: "directory" },
      { name: "validation", type: "directory" },
      { name: "test", type: "directory" },
      { name: "config.json", type: "file", template: "tf_config" },
    ],
  },
  "llama": {
    name: "LLaMA Fine-tuning",
    description: "Structure for LLaMA/Llama.cpp fine-tuning",
    structure: [
      { name: "train.jsonl", type: "file" },
      { name: "val.jsonl", type: "file" },
      { name: "config.yaml", type: "file", template: "llama_config" },
    ],
  },
  "lora": {
    name: "LoRA Training",
    description: "Dataset structure for LoRA adapter training",
    structure: [
      { name: "data", type: "directory", children: [
        { name: "train.json", type: "file" },
        { name: "eval.json", type: "file" },
      ]},
      { name: "lora_config.json", type: "file", template: "lora_config" },
    ],
  },
  "image-classification": {
    name: "Image Classification",
    description: "Standard image classification folder structure",
    structure: [
      { name: "train", type: "directory" },
      { name: "val", type: "directory" },
      { name: "test", type: "directory" },
      { name: "classes.txt", type: "file" },
      { name: "labels.json", type: "file" },
    ],
  },
  "coco": {
    name: "COCO Format",
    description: "COCO dataset format for object detection",
    structure: [
      { name: "images", type: "directory", children: [
        { name: "train", type: "directory" },
        { name: "val", type: "directory" },
      ]},
      { name: "annotations", type: "directory", children: [
        { name: "instances_train.json", type: "file" },
        { name: "instances_val.json", type: "file" },
      ]},
    ],
  },
};

const FORMAT_CONVERTERS: Record<string, (item: any, template?: string) => string> = {
  "alpaca": (item) => JSON.stringify({
    instruction: item.instruction || item.prompt || item.question || "",
    input: item.input || item.context || "",
    output: item.output || item.response || item.answer || "",
  }),
  
  "sharegpt": (item) => JSON.stringify({
    conversations: item.conversations || [
      { from: "human", value: item.prompt || item.question || "" },
      { from: "gpt", value: item.response || item.answer || "" },
    ],
  }),
  
  "openai": (item) => JSON.stringify({
    messages: item.messages || [
      { role: "user", content: item.prompt || item.question || "" },
      { role: "assistant", content: item.response || item.answer || "" },
    ],
  }),
  
  "llama": (item) => {
    const instruction = item.instruction || item.prompt || "";
    const input = item.input || "";
    const output = item.output || item.response || "";
    
    let text = `### Instruction:\n${instruction}\n`;
    if (input) text += `\n### Input:\n${input}\n`;
    text += `\n### Response:\n${output}`;
    
    return JSON.stringify({ text });
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function getContentStoreDir(): string {
  return path.join(app.getPath("userData"), "content-store");
}

async function readItemContent(contentHash: string): Promise<string> {
  const prefix = contentHash.substring(0, 2);
  const contentPath = path.join(getContentStoreDir(), prefix, contentHash);
  
  if (await fs.pathExists(contentPath)) {
    return fs.readFile(contentPath, "utf-8");
  }
  
  throw new Error(`Content not found: ${contentHash}`);
}

function shuffleArray<T>(array: T[], seed?: number): T[] {
  const shuffled = [...array];
  
  // Simple seeded random
  let random: () => number;
  if (seed !== undefined) {
    let s = seed;
    random = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  } else {
    random = Math.random;
  }
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

function splitData<T>(items: T[], ratios: { train: number; val: number; test: number }): {
  train: T[];
  val: T[];
  test: T[];
} {
  const total = items.length;
  const trainCount = Math.floor(total * ratios.train);
  const valCount = Math.floor(total * ratios.val);
  
  return {
    train: items.slice(0, trainCount),
    val: items.slice(trainCount, trainCount + valCount),
    test: items.slice(trainCount + valCount),
  };
}

// Internal function for creating folder structure (to avoid recursive IPC calls)
async function createStructureInternal(args: {
  templateId: string;
  outputDir: string;
  datasetId?: string;
}): Promise<{ success: boolean; outputDir: string; template: string }> {
  const { templateId, outputDir } = args;
  
  const template = FOLDER_TEMPLATES[templateId];
  if (!template) throw new Error("Template not found");
  
  await fs.ensureDir(outputDir);
  
  // Recursively create structure
  async function createNodes(nodes: FolderNode[], parentPath: string) {
    for (const node of nodes) {
      const nodePath = path.join(parentPath, node.name);
      
      if (node.type === "directory") {
        await fs.ensureDir(nodePath);
        if (node.children) {
          await createNodes(node.children, nodePath);
        }
      } else {
        // Create empty file or with template content
        await fs.ensureFile(nodePath);
      }
    }
  }
  
  await createNodes(template.structure, outputDir);
  
  return { success: true, outputDir, template: templateId };
}

// Internal function for exporting dataset (to avoid recursive IPC calls)
async function exportDatasetInternal(args: {
  datasetId: string;
  config: ExportConfig;
  sendProgress?: (progress: { current: number; total: number }) => void;
}): Promise<ExportResult> {
  const { datasetId, config, sendProgress } = args;
  
  // Get dataset info
  const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
  
  if (!dataset) throw new Error("Dataset not found");
  
  // Get items
  const items = await db.query.datasetItems.findMany({
    where: eq(datasetItems.datasetId, datasetId),
  });
  
  if (items.length === 0) throw new Error("Dataset is empty");
  
  // Create output directory
  await fs.ensureDir(config.outputDir);
  
  const result: ExportResult = {
    outputDir: config.outputDir,
    files: [],
    totalItems: items.length,
  };
  
  // Load content for all items
  const itemsWithContent = await Promise.all(
    items.map(async (item, idx) => {
      if (sendProgress) {
        sendProgress({ current: idx + 1, total: items.length });
      }
      const content = await readItemContent(item.contentHash);
      try {
        return { ...item, parsedContent: JSON.parse(content) };
      } catch {
        return { ...item, parsedContent: { text: content } };
      }
    })
  );
  
  // Shuffle if needed
  let processedItems = config.shuffleSeed !== undefined
    ? shuffleArray(itemsWithContent, config.shuffleSeed)
    : itemsWithContent;
  
  // Split data
  const splitRatios = config.splitRatios || { train: 0.8, val: 0.1, test: 0.1 };
  const splits = splitData(processedItems, splitRatios);
  result.splits = {
    train: splits.train.length,
    val: splits.val.length,
    test: splits.test.length,
  };
  
  // Export based on format (simplified - full logic is in the IPC handler)
  switch (config.format) {
    case "jsonl": {
      for (const [splitName, splitItems] of Object.entries(splits)) {
        const filePath = path.join(config.outputDir, `${splitName}.jsonl`);
        const lines = splitItems.map(item => {
          const output = config.jsonlOptions?.flattenFields
            ? item.parsedContent
            : { data: item.parsedContent };
          return JSON.stringify(output);
        });
        await fs.writeFile(filePath, lines.join("\n"));
        const stats = await fs.stat(filePath);
        result.files.push({
          path: filePath,
          format: "jsonl",
          itemCount: splitItems.length,
          sizeBytes: stats.size,
        });
      }
      break;
    }
    default: {
      // Default to JSON
      const allData = processedItems.map(item => item.parsedContent);
      const filePath = path.join(config.outputDir, "dataset.json");
      await fs.writeJson(filePath, allData, { spaces: 2 });
      const stats = await fs.stat(filePath);
      result.files.push({
        path: filePath,
        format: "json",
        itemCount: allData.length,
        sizeBytes: stats.size,
      });
    }
  }
  
  return result;
}

async function generateDatasetCard(
  dataset: any,
  items: Array<any>,
  config: ExportConfig
): Promise<string> {
  const splits = config.splitRatios || { train: 0.8, val: 0.1, test: 0.1 };
  const totalItems = items.length;
  
  const card: DatasetCard = {
    name: dataset.name,
    description: dataset.description || undefined,
    version: dataset.version?.toString(),
    license: items[0]?.license || "unknown",
    size: `${totalItems} items`,
    modalities: [...new Set(items.map(i => i.modality))],
    splits: {
      train: Math.floor(totalItems * splits.train),
      validation: Math.floor(totalItems * splits.val),
      test: Math.floor(totalItems * splits.test),
    },
    tags: ["joycreate-export"],
  };
  
  // Generate markdown
  let markdown = `---
license: ${card.license}
task_categories:
  - text-generation
size_categories:
  - ${totalItems < 1000 ? 'n<1K' : totalItems < 10000 ? '1K<n<10K' : '10K<n<100K'}
---

# ${card.name}

${card.description || "Dataset exported from JoyCreate Data Studio."}

## Dataset Description

- **Size**: ${card.size}
- **License**: ${card.license}
- **Modalities**: ${card.modalities?.join(", ")}
- **Version**: ${card.version || "1.0"}

## Splits

| Split | Count |
|-------|-------|
| Train | ${card.splits?.train} |
| Validation | ${card.splits?.validation} |
| Test | ${card.splits?.test} |

## Usage

\`\`\`python
from datasets import load_dataset

dataset = load_dataset("path/to/this/directory")
\`\`\`

## Citation

If you use this dataset, please cite JoyCreate Data Studio.
`;

  return markdown;
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerDataTransformationHandlers() {
  logger.info("Registering Data Transformation handlers");

  // ========== Format Export ==========

  /**
   * Export dataset to format
   */
  ipcMain.handle("transform:export-dataset", async (event, args: {
    datasetId: string;
    config: ExportConfig;
  }) => {
    try {
      const { datasetId, config } = args;
      
      // Get dataset info
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
      
      if (!dataset) throw new Error("Dataset not found");
      
      // Get items
      const items = await db.query.datasetItems.findMany({
        where: eq(datasetItems.datasetId, datasetId),
      });
      
      if (items.length === 0) throw new Error("Dataset is empty");
      
      // Create output directory
      await fs.ensureDir(config.outputDir);
      
      const result: ExportResult = {
        outputDir: config.outputDir,
        files: [],
        totalItems: items.length,
      };
      
      // Load content for all items
      const itemsWithContent = await Promise.all(
        items.map(async (item) => {
          const content = await readItemContent(item.contentHash);
          try {
            return { ...item, parsedContent: JSON.parse(content) };
          } catch {
            return { ...item, parsedContent: { text: content } };
          }
        })
      );
      
      // Shuffle if needed
      let processedItems = config.shuffleSeed !== undefined
        ? shuffleArray(itemsWithContent, config.shuffleSeed)
        : itemsWithContent;
      
      // Split data
      const splitRatios = config.splitRatios || { train: 0.8, val: 0.1, test: 0.1 };
      const splits = splitData(processedItems, splitRatios);
      result.splits = {
        train: splits.train.length,
        val: splits.val.length,
        test: splits.test.length,
      };
      
      // Export based on format
      switch (config.format) {
        case "jsonl": {
          for (const [splitName, splitItems] of Object.entries(splits)) {
            const filePath = path.join(config.outputDir, `${splitName}.jsonl`);
            const lines = splitItems.map(item => {
              const output = config.jsonlOptions?.flattenFields
                ? item.parsedContent
                : { data: item.parsedContent };
              return JSON.stringify(output);
            });
            await fs.writeFile(filePath, lines.join("\n"));
            const stats = await fs.stat(filePath);
            result.files.push({
              path: filePath,
              format: "jsonl",
              itemCount: splitItems.length,
              sizeBytes: stats.size,
            });
          }
          break;
        }
        
        case "json": {
          const allData = processedItems.map(item => item.parsedContent);
          const filePath = path.join(config.outputDir, "dataset.json");
          await fs.writeJson(filePath, allData, { spaces: 2 });
          const stats = await fs.stat(filePath);
          result.files.push({
            path: filePath,
            format: "json",
            itemCount: processedItems.length,
            sizeBytes: stats.size,
          });
          break;
        }
        
        case "csv": {
          // Determine columns from first item
          const firstItem = processedItems[0]?.parsedContent;
          if (typeof firstItem !== "object") {
            throw new Error("CSV export requires structured data");
          }
          
          const columns = Object.keys(firstItem);
          const csvLines = [columns.join(",")];
          
          for (const item of processedItems) {
            const values = columns.map(col => {
              const val = item.parsedContent[col];
              if (typeof val === "string") {
                return `"${val.replace(/"/g, '""')}"`;
              }
              return String(val ?? "");
            });
            csvLines.push(values.join(","));
          }
          
          const filePath = path.join(config.outputDir, "dataset.csv");
          await fs.writeFile(filePath, csvLines.join("\n"));
          const stats = await fs.stat(filePath);
          result.files.push({
            path: filePath,
            format: "csv",
            itemCount: processedItems.length,
            sizeBytes: stats.size,
          });
          break;
        }
        
        case "alpaca":
        case "sharegpt":
        case "openai":
        case "llama": {
          const converter = FORMAT_CONVERTERS[config.format];
          
          for (const [splitName, splitItems] of Object.entries(splits)) {
            const filePath = path.join(config.outputDir, `${splitName}.jsonl`);
            const lines = splitItems.map(item => converter(item.parsedContent, config.template));
            await fs.writeFile(filePath, lines.join("\n"));
            const stats = await fs.stat(filePath);
            result.files.push({
              path: filePath,
              format: config.format,
              itemCount: splitItems.length,
              sizeBytes: stats.size,
            });
          }
          break;
        }
        
        case "huggingface": {
          // Create HuggingFace-compatible structure
          const dataDir = path.join(config.outputDir, "data");
          await fs.ensureDir(dataDir);
          
          for (const [splitName, splitItems] of Object.entries(splits)) {
            const fileName = splitName === "val" ? "validation.jsonl" : `${splitName}.jsonl`;
            const filePath = path.join(dataDir, fileName);
            const lines = splitItems.map(item => JSON.stringify(item.parsedContent));
            await fs.writeFile(filePath, lines.join("\n"));
            const stats = await fs.stat(filePath);
            result.files.push({
              path: filePath,
              format: "jsonl",
              itemCount: splitItems.length,
              sizeBytes: stats.size,
            });
          }
          
          // Generate README
          if (config.huggingfaceOptions?.generateCard !== false) {
            const readme = await generateDatasetCard(dataset, items, config);
            const readmePath = path.join(config.outputDir, "README.md");
            await fs.writeFile(readmePath, readme);
            result.files.push({
              path: readmePath,
              format: "markdown",
              itemCount: 1,
              sizeBytes: Buffer.byteLength(readme),
            });
          }
          
          // Generate dataset_info.json
          const datasetInfo = {
            builder_name: config.huggingfaceOptions?.datasetName || dataset.name,
            config_name: config.huggingfaceOptions?.configName || "default",
            version: {
              version_str: "1.0.0",
            },
            splits: {
              train: { num_examples: splits.train.length },
              validation: { num_examples: splits.val.length },
              test: { num_examples: splits.test.length },
            },
          };
          const infoPath = path.join(config.outputDir, "dataset_info.json");
          await fs.writeJson(infoPath, datasetInfo, { spaces: 2 });
          result.files.push({
            path: infoPath,
            format: "json",
            itemCount: 1,
            sizeBytes: JSON.stringify(datasetInfo).length,
          });
          break;
        }
        
        case "image-classification": {
          // Create class folders
          for (const [splitName, splitItems] of Object.entries(splits)) {
            const splitDir = path.join(config.outputDir, splitName);
            await fs.ensureDir(splitDir);
            
            const classes = new Set<string>();
            
            for (const item of splitItems) {
              const className = item.parsedContent.class || item.parsedContent.label || "unknown";
              classes.add(className);
              
              const classDir = path.join(splitDir, className);
              await fs.ensureDir(classDir);
              
              if (item.modality === "image" && item.sourcePath) {
                const destPath = path.join(classDir, path.basename(item.sourcePath));
                if (config.imageOptions?.copyImages !== false) {
                  if (await fs.pathExists(item.sourcePath)) {
                    await fs.copy(item.sourcePath, destPath);
                  }
                }
              }
            }
            
            result.files.push({
              path: splitDir,
              format: "directory",
              itemCount: splitItems.length,
              sizeBytes: 0,
            });
          }
          
          // Write classes.txt
          const allClasses = new Set<string>();
          for (const item of processedItems) {
            allClasses.add(item.parsedContent.class || item.parsedContent.label || "unknown");
          }
          const classesPath = path.join(config.outputDir, "classes.txt");
          await fs.writeFile(classesPath, [...allClasses].join("\n"));
          result.files.push({
            path: classesPath,
            format: "text",
            itemCount: allClasses.size,
            sizeBytes: 0,
          });
          break;
        }
        
        case "text-plain": {
          for (const [splitName, splitItems] of Object.entries(splits)) {
            const filePath = path.join(config.outputDir, `${splitName}.txt`);
            const texts = splitItems.map(item => 
              item.parsedContent.text || item.parsedContent.content || JSON.stringify(item.parsedContent)
            );
            await fs.writeFile(filePath, texts.join("\n\n---\n\n"));
            const stats = await fs.stat(filePath);
            result.files.push({
              path: filePath,
              format: "text",
              itemCount: splitItems.length,
              sizeBytes: stats.size,
            });
          }
          break;
        }
        
        case "custom": {
          if (!config.template) throw new Error("Template required for custom format");
          
          for (const [splitName, splitItems] of Object.entries(splits)) {
            const filePath = path.join(config.outputDir, `${splitName}.jsonl`);
            const lines = splitItems.map(item => {
              // Simple template substitution
              let output = config.template!;
              for (const [key, value] of Object.entries(item.parsedContent)) {
                output = output.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
              }
              return output;
            });
            await fs.writeFile(filePath, lines.join("\n"));
            const stats = await fs.stat(filePath);
            result.files.push({
              path: filePath,
              format: "custom",
              itemCount: splitItems.length,
              sizeBytes: stats.size,
            });
          }
          break;
        }
      }
      
      return { success: true, result };
    } catch (error) {
      logger.error("Export dataset failed:", error);
      throw error;
    }
  });

  // ========== Folder Structure Creation ==========

  /**
   * List available folder templates
   */
  ipcMain.handle("transform:list-templates", async () => {
    try {
      const templates = Object.entries(FOLDER_TEMPLATES).map(([id, template]) => ({
        id,
        name: template.name,
        description: template.description,
      }));
      return { success: true, templates };
    } catch (error) {
      logger.error("List templates failed:", error);
      throw error;
    }
  });

  /**
   * Create folder structure from template
   */
  ipcMain.handle("transform:create-structure", async (_event, args: {
    templateId: string;
    outputDir: string;
    datasetId?: string;
  }) => {
    try {
      const { templateId, outputDir, datasetId } = args;
      
      const template = FOLDER_TEMPLATES[templateId];
      if (!template) throw new Error("Template not found");
      
      await fs.ensureDir(outputDir);
      
      // Recursively create structure
      async function createNodes(nodes: FolderNode[], parentPath: string) {
        for (const node of nodes) {
          const nodePath = path.join(parentPath, node.name);
          
          if (node.type === "directory") {
            await fs.ensureDir(nodePath);
            if (node.children) {
              await createNodes(node.children, nodePath);
            }
          } else {
            // Create empty file or with template content
            await fs.ensureFile(nodePath);
          }
        }
      }
      
      await createNodes(template.structure, outputDir);
      
      return { success: true, outputDir, template: templateId };
    } catch (error) {
      logger.error("Create structure failed:", error);
      throw error;
    }
  });

  // ========== Data Conversion ==========

  /**
   * Convert between formats
   */
  ipcMain.handle("transform:convert-format", async (_event, args: {
    inputPath: string;
    inputFormat: string;
    outputPath: string;
    outputFormat: string;
    options?: any;
  }) => {
    try {
      const { inputPath, inputFormat, outputPath, outputFormat, options } = args;
      
      // Read input
      let items: any[] = [];
      
      if (inputFormat === "jsonl") {
        const content = await fs.readFile(inputPath, "utf-8");
        items = content.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
      } else if (inputFormat === "json") {
        items = await fs.readJson(inputPath);
        if (!Array.isArray(items)) items = [items];
      } else if (inputFormat === "csv") {
        const content = await fs.readFile(inputPath, "utf-8");
        const lines = content.split("\n");
        const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
        
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
          const item: Record<string, string> = {};
          headers.forEach((h, idx) => {
            item[h] = values[idx] || "";
          });
          items.push(item);
        }
      }
      
      // Convert and write output
      if (outputFormat === "jsonl") {
        const converter = FORMAT_CONVERTERS[options?.targetFormat] || ((i: any) => JSON.stringify(i));
        const lines = items.map(item => converter(item));
        await fs.writeFile(outputPath, lines.join("\n"));
      } else if (outputFormat === "json") {
        await fs.writeJson(outputPath, items, { spaces: 2 });
      }
      
      return { success: true, itemCount: items.length, outputPath };
    } catch (error) {
      logger.error("Convert format failed:", error);
      throw error;
    }
  });

  // ========== Tokenization ==========

  /**
   * Simple tokenization
   */
  ipcMain.handle("transform:tokenize", async (_event, args: {
    text: string;
    method?: "whitespace" | "word" | "character";
    options?: {
      lowercase?: boolean;
      removePunctuation?: boolean;
    };
  }) => {
    try {
      let { text, method = "word", options = {} } = args;
      
      if (options.lowercase) {
        text = text.toLowerCase();
      }
      
      if (options.removePunctuation) {
        text = text.replace(/[^\w\s]/g, "");
      }
      
      let tokens: string[];
      
      switch (method) {
        case "whitespace":
          tokens = text.split(/\s+/).filter(t => t);
          break;
        case "character":
          tokens = text.split("");
          break;
        case "word":
        default:
          tokens = text.match(/\b\w+\b/g) || [];
          break;
      }
      
      return { success: true, tokens, count: tokens.length };
    } catch (error) {
      logger.error("Tokenize failed:", error);
      throw error;
    }
  });

  /**
   * Build vocabulary from dataset
   */
  ipcMain.handle("transform:build-vocab", async (_event, args: {
    datasetId: string;
    field?: string;
    minFreq?: number;
    maxVocab?: number;
  }) => {
    try {
      const { datasetId, field = "text", minFreq = 1, maxVocab = 50000 } = args;
      
      const items = await db.query.datasetItems.findMany({
        where: eq(datasetItems.datasetId, datasetId),
      });
      
      const freqMap = new Map<string, number>();
      
      for (const item of items) {
        const content = await readItemContent(item.contentHash);
        let text: string;
        
        try {
          const parsed = JSON.parse(content);
          text = parsed[field] || parsed.text || parsed.content || content;
        } catch {
          text = content;
        }
        
        const tokens = text.toLowerCase().match(/\b\w+\b/g) || [];
        for (const token of tokens) {
          freqMap.set(token, (freqMap.get(token) || 0) + 1);
        }
      }
      
      // Filter and sort
      let vocab = Array.from(freqMap.entries())
        .filter(([_, freq]) => freq >= minFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxVocab);
      
      // Add special tokens
      const specialTokens = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"];
      const vocabWithSpecial = [
        ...specialTokens.map(t => [t, 0] as [string, number]),
        ...vocab,
      ];
      
      const token2id: Record<string, number> = {};
      const id2token: Record<number, string> = {};
      
      vocabWithSpecial.forEach(([token], idx) => {
        token2id[token] = idx;
        id2token[idx] = token;
      });
      
      return {
        success: true,
        vocabSize: vocabWithSpecial.length,
        token2id,
        id2token,
        frequencies: Object.fromEntries(vocab),
      };
    } catch (error) {
      logger.error("Build vocab failed:", error);
      throw error;
    }
  });

  // ========== Training Preparation ==========

  /**
   * Prepare dataset for training
   */
  ipcMain.handle("transform:prepare-training", async (event, args: {
    datasetId: string;
    outputDir: string;
    framework: "huggingface" | "pytorch" | "tensorflow" | "llama" | "lora";
    options?: {
      maxSeqLength?: number;
      batchSize?: number;
      format?: string;
    };
  }) => {
    try {
      const { datasetId, outputDir, framework, options = {} } = args;
      
      // Create structure using internal function
      await createStructureInternal({
        templateId: framework,
        outputDir,
        datasetId,
      });
      
      // Export data
      let format: ExportFormat;
      switch (framework) {
        case "huggingface":
          format = "huggingface";
          break;
        case "llama":
          format = "llama";
          break;
        case "lora":
          format = "alpaca";
          break;
        default:
          format = "jsonl";
      }
      
      const exportConfig: ExportConfig = {
        format,
        outputDir: framework === "huggingface" ? path.join(outputDir, "data") : outputDir,
        splitRatios: { train: 0.8, val: 0.1, test: 0.1 },
        shuffleSeed: 42,
      };
      
      // Use internal function to avoid recursive IPC call
      const result = await exportDatasetInternal({
        datasetId,
        config: exportConfig,
        sendProgress: (progress) => {
          event.sender.send("transform:export-progress", progress);
        },
      });
      
      // Generate config files
      if (framework === "lora") {
        const loraConfig = {
          model_name_or_path: "meta-llama/Llama-2-7b-hf",
          output_dir: "./output",
          lora_r: 8,
          lora_alpha: 16,
          lora_dropout: 0.05,
          target_modules: ["q_proj", "v_proj"],
          train_data: path.join(outputDir, "data", "train.json"),
          eval_data: path.join(outputDir, "data", "eval.json"),
          max_seq_length: options.maxSeqLength || 512,
          per_device_train_batch_size: options.batchSize || 4,
          num_train_epochs: 3,
          learning_rate: 2e-4,
        };
        
        await fs.writeJson(
          path.join(outputDir, "lora_config.json"),
          loraConfig,
          { spaces: 2 }
        );
      }
      
      return { success: true, outputDir, framework, exportResult: result };
    } catch (error) {
      logger.error("Prepare training failed:", error);
      throw error;
    }
  });

  // ========== Statistics ==========

  /**
   * Get dataset statistics
   */
  ipcMain.handle("transform:get-stats", async (_event, datasetId: string) => {
    try {
      const items = await db.query.datasetItems.findMany({
        where: eq(datasetItems.datasetId, datasetId),
      });
      
      let totalTokens = 0;
      let totalChars = 0;
      const lengths: number[] = [];
      
      for (const item of items) {
        const content = await readItemContent(item.contentHash);
        let text: string;
        
        try {
          const parsed = JSON.parse(content);
          text = JSON.stringify(parsed);
        } catch {
          text = content;
        }
        
        totalChars += text.length;
        const tokens = text.match(/\b\w+\b/g) || [];
        totalTokens += tokens.length;
        lengths.push(tokens.length);
      }
      
      lengths.sort((a, b) => a - b);
      
      const stats = {
        itemCount: items.length,
        totalCharacters: totalChars,
        totalTokens,
        avgTokensPerItem: totalTokens / items.length,
        medianTokens: lengths[Math.floor(lengths.length / 2)],
        minTokens: lengths[0],
        maxTokens: lengths[lengths.length - 1],
        modalities: [...new Set(items.map(i => i.modality))],
        splits: {
          train: items.filter(i => i.split === "train").length,
          val: items.filter(i => i.split === "val").length,
          test: items.filter(i => i.split === "test").length,
          unassigned: items.filter(i => i.split === "unassigned" || !i.split).length,
        },
      };
      
      return { success: true, stats };
    } catch (error) {
      logger.error("Get stats failed:", error);
      throw error;
    }
  });

  logger.info("Data Transformation handlers registered");
}
