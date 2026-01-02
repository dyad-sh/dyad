/**
 * Asset Studio IPC Handlers
 * Unified asset creation, management, and marketplace publishing
 */

import { ipcMain, app, shell } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import AdmZip from "adm-zip";
import type {
  Asset,
  AssetType,
  DatasetAsset,
  ModelAsset,
  AlgorithmAsset,
  SchemaAsset,
  AgentAsset,
  UIComponentAsset,
  TemplateAsset,
  WorkflowAsset,
  PromptAsset,
  APIAsset,
  PluginAsset,
  TrainingDataAsset,
  EmbeddingAsset,
  AssetListing,
  AssetBundle,
} from "@/types/asset_types";

const logger = log.scope("asset_handlers");

/**
 * Get the assets directory
 */
function getAssetsDir(): string {
  return path.join(app.getPath("userData"), "assets");
}

/**
 * Get directory for specific asset type
 */
function getAssetTypeDir(assetType: AssetType): string {
  return path.join(getAssetsDir(), assetType);
}

/**
 * Initialize asset directories
 */
async function initAssetDirs() {
  const baseDir = getAssetsDir();
  await fs.ensureDir(baseDir);
  
  const assetTypes: AssetType[] = [
    "dataset", "model", "algorithm", "schema", "agent",
    "ui-component", "template", "workflow", "prompt",
    "api", "plugin", "training-data", "embedding"
  ];
  
  for (const type of assetTypes) {
    await fs.ensureDir(path.join(baseDir, type));
  }
  
  // Also create exports dir
  await fs.ensureDir(path.join(baseDir, "exports"));
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Save asset to disk
 */
async function saveAsset(asset: Asset): Promise<void> {
  const assetDir = getAssetTypeDir(asset.type);
  const metaPath = path.join(assetDir, `${asset.id}.meta.json`);
  await fs.writeJson(metaPath, asset, { spaces: 2 });
}

/**
 * Load asset from disk
 */
async function loadAsset(assetType: AssetType, assetId: string): Promise<Asset | null> {
  const metaPath = path.join(getAssetTypeDir(assetType), `${assetId}.meta.json`);
  if (await fs.pathExists(metaPath)) {
    return fs.readJson(metaPath);
  }
  return null;
}

/**
 * List all assets of a type
 */
async function listAssets(assetType: AssetType): Promise<Asset[]> {
  const assetDir = getAssetTypeDir(assetType);
  await fs.ensureDir(assetDir);
  
  const files = await fs.readdir(assetDir);
  const assets: Asset[] = [];
  
  for (const file of files) {
    if (file.endsWith(".meta.json")) {
      try {
        const asset = await fs.readJson(path.join(assetDir, file));
        assets.push(asset);
      } catch (error) {
        logger.warn(`Failed to load asset ${file}:`, error);
      }
    }
  }
  
  return assets.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Delete asset
 */
async function deleteAsset(assetType: AssetType, assetId: string): Promise<void> {
  const assetDir = getAssetTypeDir(assetType);
  const metaPath = path.join(assetDir, `${assetId}.meta.json`);
  const dataPath = path.join(assetDir, assetId);
  
  if (await fs.pathExists(metaPath)) await fs.remove(metaPath);
  if (await fs.pathExists(dataPath)) await fs.remove(dataPath);
}

/**
 * Export asset to ZIP for marketplace
 */
async function exportAssetToZip(asset: Asset): Promise<string> {
  const zip = new AdmZip();
  const assetDir = getAssetTypeDir(asset.type);
  const exportDir = path.join(getAssetsDir(), "exports");
  await fs.ensureDir(exportDir);
  
  // Add metadata
  zip.addFile("asset.json", Buffer.from(JSON.stringify(asset, null, 2)));
  
  // Add asset files based on type
  if ("filePath" in asset && asset.filePath) {
    if (await fs.pathExists(asset.filePath)) {
      const fileName = path.basename(asset.filePath);
      const content = await fs.readFile(asset.filePath);
      zip.addFile(`data/${fileName}`, content);
    }
  }
  
  // Add readme if exists
  if (asset.readme) {
    zip.addFile("README.md", Buffer.from(asset.readme));
  }
  
  // Add config path if exists
  if ("configPath" in asset && asset.configPath) {
    if (await fs.pathExists(asset.configPath)) {
      const content = await fs.readFile(asset.configPath);
      zip.addFile("config.json", content);
    }
  }
  
  // Save ZIP
  const zipName = `${asset.name.replace(/[^a-zA-Z0-9]/g, "-")}-v${asset.version}.zip`;
  const zipPath = path.join(exportDir, zipName);
  zip.writeZip(zipPath);
  
  return zipPath;
}

/**
 * Import asset from ZIP
 */
async function importAssetFromZip(zipPath: string): Promise<Asset> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  
  // Find and parse asset.json
  const metaEntry = entries.find(e => e.entryName === "asset.json");
  if (!metaEntry) {
    throw new Error("Invalid asset package: missing asset.json");
  }
  
  const asset: Asset = JSON.parse(metaEntry.getData().toString("utf8"));
  
  // Generate new ID for imported asset
  asset.id = generateId();
  asset.createdAt = new Date().toISOString();
  asset.updatedAt = new Date().toISOString();
  delete asset.marketplaceId;
  delete asset.publishedAt;
  
  const assetDir = getAssetTypeDir(asset.type);
  const assetDataDir = path.join(assetDir, asset.id);
  await fs.ensureDir(assetDataDir);
  
  // Extract data files
  for (const entry of entries) {
    if (entry.entryName.startsWith("data/") && !entry.isDirectory) {
      const fileName = path.basename(entry.entryName);
      const filePath = path.join(assetDataDir, fileName);
      await fs.writeFile(filePath, entry.getData());
      
      // Update file path in asset
      if ("filePath" in asset) {
        (asset as any).filePath = filePath;
      }
    }
  }
  
  // Save asset metadata
  await saveAsset(asset);
  
  return asset;
}

/**
 * Create algorithm asset
 */
async function createAlgorithm(params: {
  name: string;
  description?: string;
  language: AlgorithmAsset["language"];
  algorithmType: AlgorithmAsset["algorithmType"];
  code: string;
  inputs: AlgorithmAsset["inputs"];
  outputs: AlgorithmAsset["outputs"];
  dependencies?: string[];
}): Promise<AlgorithmAsset> {
  const id = generateId();
  const assetDir = path.join(getAssetTypeDir("algorithm"), id);
  await fs.ensureDir(assetDir);
  
  // Determine file extension
  const ext = {
    python: "py",
    javascript: "js",
    typescript: "ts",
    rust: "rs",
    go: "go",
  }[params.language];
  
  const filePath = path.join(assetDir, `main.${ext}`);
  await fs.writeFile(filePath, params.code, "utf-8");
  
  const asset: AlgorithmAsset = {
    id,
    type: "algorithm",
    name: params.name,
    description: params.description,
    version: "1.0.0",
    author: "local",
    license: "free",
    tags: [],
    category: params.algorithmType,
    language: params.language,
    algorithmType: params.algorithmType,
    entryPoint: `main.${ext}`,
    inputs: params.inputs,
    outputs: params.outputs,
    dependencies: params.dependencies || [],
    filePath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await saveAsset(asset);
  return asset;
}

/**
 * Create schema asset
 */
async function createSchema(params: {
  name: string;
  description?: string;
  schemaType: SchemaAsset["schemaType"];
  content: string;
}): Promise<SchemaAsset> {
  const id = generateId();
  const assetDir = path.join(getAssetTypeDir("schema"), id);
  await fs.ensureDir(assetDir);
  
  // Determine file extension and format
  const extMap: Record<string, { ext: string; format: SchemaAsset["format"] }> = {
    "json-schema": { ext: "json", format: "json" },
    "openapi": { ext: "yaml", format: "yaml" },
    "graphql": { ext: "graphql", format: "graphql" },
    "protobuf": { ext: "proto", format: "proto" },
    "avro": { ext: "avsc", format: "json" },
    "sql": { ext: "sql", format: "sql" },
    "drizzle": { ext: "ts", format: "json" },
    "prisma": { ext: "prisma", format: "json" },
  };
  
  const { ext, format } = extMap[params.schemaType] || { ext: "json", format: "json" };
  const filePath = path.join(assetDir, `schema.${ext}`);
  await fs.writeFile(filePath, params.content, "utf-8");
  
  const asset: SchemaAsset = {
    id,
    type: "schema",
    name: params.name,
    description: params.description,
    version: "1.0.0",
    author: "local",
    license: "free",
    tags: [],
    category: params.schemaType,
    schemaType: params.schemaType,
    format,
    content: params.content,
    filePath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await saveAsset(asset);
  return asset;
}

/**
 * Create prompt asset
 */
async function createPrompt(params: {
  name: string;
  description?: string;
  promptType: PromptAsset["promptType"];
  content: string;
  variables: PromptAsset["variables"];
  targetModel?: string;
  examples?: PromptAsset["examples"];
}): Promise<PromptAsset> {
  const id = generateId();
  const assetDir = path.join(getAssetTypeDir("prompt"), id);
  await fs.ensureDir(assetDir);
  
  const filePath = path.join(assetDir, "prompt.md");
  await fs.writeFile(filePath, params.content, "utf-8");
  
  const asset: PromptAsset = {
    id,
    type: "prompt",
    name: params.name,
    description: params.description,
    version: "1.0.0",
    author: "local",
    license: "free",
    tags: [],
    category: params.promptType,
    promptType: params.promptType,
    content: params.content,
    variables: params.variables,
    targetModel: params.targetModel,
    examples: params.examples,
    filePath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await saveAsset(asset);
  return asset;
}

/**
 * Create UI component asset
 */
async function createUIComponent(params: {
  name: string;
  description?: string;
  componentType: UIComponentAsset["componentType"];
  framework: UIComponentAsset["framework"];
  styling: UIComponentAsset["styling"];
  code: string;
  props: UIComponentAsset["props"];
  responsive?: boolean;
  darkMode?: boolean;
  dependencies?: string[];
}): Promise<UIComponentAsset> {
  const id = generateId();
  const assetDir = path.join(getAssetTypeDir("ui-component"), id);
  await fs.ensureDir(assetDir);
  
  const ext = params.framework === "react" ? "tsx" : 
              params.framework === "vue" ? "vue" :
              params.framework === "svelte" ? "svelte" : "html";
  
  const filePath = path.join(assetDir, `component.${ext}`);
  await fs.writeFile(filePath, params.code, "utf-8");
  
  const asset: UIComponentAsset = {
    id,
    type: "ui-component",
    name: params.name,
    description: params.description,
    version: "1.0.0",
    author: "local",
    license: "free",
    tags: [],
    category: params.componentType,
    componentType: params.componentType,
    framework: params.framework,
    styling: params.styling,
    responsive: params.responsive ?? true,
    darkMode: params.darkMode ?? true,
    props: params.props,
    filePath,
    dependencies: params.dependencies || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await saveAsset(asset);
  return asset;
}

/**
 * Create API asset
 */
async function createAPI(params: {
  name: string;
  description?: string;
  apiType: APIAsset["apiType"];
  baseUrl?: string;
  authentication: APIAsset["authentication"];
  endpoints: APIAsset["endpoints"];
  spec?: string;
}): Promise<APIAsset> {
  const id = generateId();
  const assetDir = path.join(getAssetTypeDir("api"), id);
  await fs.ensureDir(assetDir);
  
  const filePath = path.join(assetDir, "api.json");
  const apiSpec = params.spec || JSON.stringify({
    openapi: "3.0.0",
    info: { title: params.name, version: "1.0.0" },
    servers: params.baseUrl ? [{ url: params.baseUrl }] : [],
    paths: {},
  }, null, 2);
  await fs.writeFile(filePath, apiSpec, "utf-8");
  
  const asset: APIAsset = {
    id,
    type: "api",
    name: params.name,
    description: params.description,
    version: "1.0.0",
    author: "local",
    license: "free",
    tags: [],
    category: params.apiType,
    apiType: params.apiType,
    baseUrl: params.baseUrl,
    authentication: params.authentication,
    endpoints: params.endpoints,
    filePath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await saveAsset(asset);
  return asset;
}

/**
 * Create training data asset
 */
async function createTrainingData(params: {
  name: string;
  description?: string;
  dataType: TrainingDataAsset["dataType"];
  format: TrainingDataAsset["format"];
  data: any[];
  quality?: TrainingDataAsset["quality"];
  splitRatio?: TrainingDataAsset["splitRatio"];
}): Promise<TrainingDataAsset> {
  const id = generateId();
  const assetDir = path.join(getAssetTypeDir("training-data"), id);
  await fs.ensureDir(assetDir);
  
  const filePath = path.join(assetDir, `data.${params.format === "jsonl" ? "jsonl" : "json"}`);
  
  if (params.format === "jsonl") {
    const content = params.data.map(item => JSON.stringify(item)).join("\n");
    await fs.writeFile(filePath, content, "utf-8");
  } else {
    await fs.writeJson(filePath, params.data, { spaces: 2 });
  }
  
  const stats = await fs.stat(filePath);
  
  const asset: TrainingDataAsset = {
    id,
    type: "training-data",
    name: params.name,
    description: params.description,
    version: "1.0.0",
    author: "local",
    license: "free",
    tags: [],
    category: params.dataType,
    dataType: params.dataType,
    format: params.format,
    samples: params.data.length,
    quality: params.quality || "raw",
    splitRatio: params.splitRatio,
    filePath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await saveAsset(asset);
  return asset;
}

/**
 * Get asset statistics
 */
async function getAssetStats(): Promise<{
  total: number;
  byType: Record<AssetType, number>;
  published: number;
  totalSize: number;
}> {
  const assetTypes: AssetType[] = [
    "dataset", "model", "algorithm", "schema", "agent",
    "ui-component", "template", "workflow", "prompt",
    "api", "plugin", "training-data", "embedding"
  ];
  
  const byType: Record<string, number> = {};
  let total = 0;
  let published = 0;
  
  for (const type of assetTypes) {
    const assets = await listAssets(type);
    byType[type] = assets.length;
    total += assets.length;
    published += assets.filter(a => a.publishedAt).length;
  }
  
  // Calculate total size
  const baseDir = getAssetsDir();
  let totalSize = 0;
  
  const calculateSize = async (dir: string): Promise<number> => {
    let size = 0;
    if (await fs.pathExists(dir)) {
      const items = await fs.readdir(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stat = await fs.stat(itemPath);
        if (stat.isDirectory()) {
          size += await calculateSize(itemPath);
        } else {
          size += stat.size;
        }
      }
    }
    return size;
  };
  
  totalSize = await calculateSize(baseDir);
  
  return {
    total,
    byType: byType as Record<AssetType, number>,
    published,
    totalSize,
  };
}

/**
 * Register all asset studio handlers
 */
export function registerAssetStudioHandlers() {
  // Initialize directories
  initAssetDirs();

  // Get asset stats
  ipcMain.handle("assets:stats", async () => {
    return getAssetStats();
  });

  // List assets by type
  ipcMain.handle("assets:list", async (_, assetType: AssetType) => {
    return listAssets(assetType);
  });

  // List all assets
  ipcMain.handle("assets:list-all", async () => {
    const assetTypes: AssetType[] = [
      "dataset", "model", "algorithm", "schema", "agent",
      "ui-component", "template", "workflow", "prompt",
      "api", "plugin", "training-data", "embedding"
    ];
    
    const allAssets: Asset[] = [];
    for (const type of assetTypes) {
      const assets = await listAssets(type);
      allAssets.push(...assets);
    }
    
    return allAssets.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });

  // Get single asset
  ipcMain.handle("assets:get", async (_, assetType: AssetType, assetId: string) => {
    return loadAsset(assetType, assetId);
  });

  // Delete asset
  ipcMain.handle("assets:delete", async (_, assetType: AssetType, assetId: string) => {
    await deleteAsset(assetType, assetId);
  });

  // Update asset
  ipcMain.handle("assets:update", async (_, asset: Asset) => {
    asset.updatedAt = new Date().toISOString();
    await saveAsset(asset);
    return asset;
  });

  // Export asset to ZIP
  ipcMain.handle("assets:export", async (_, assetType: AssetType, assetId: string) => {
    const asset = await loadAsset(assetType, assetId);
    if (!asset) throw new Error("Asset not found");
    return exportAssetToZip(asset);
  });

  // Import asset from ZIP
  ipcMain.handle("assets:import", async (_, zipPath: string) => {
    return importAssetFromZip(zipPath);
  });

  // Open asset in file explorer
  ipcMain.handle("assets:open-folder", async (_, assetType: AssetType, assetId: string) => {
    const assetDir = path.join(getAssetTypeDir(assetType), assetId);
    if (await fs.pathExists(assetDir)) {
      shell.openPath(assetDir);
    } else {
      shell.openPath(getAssetTypeDir(assetType));
    }
  });

  // Read asset file content
  ipcMain.handle("assets:read-file", async (_, assetType: AssetType, assetId: string) => {
    const asset = await loadAsset(assetType, assetId);
    if (!asset) throw new Error("Asset not found");
    
    if ("filePath" in asset && asset.filePath && await fs.pathExists(asset.filePath)) {
      return fs.readFile(asset.filePath, "utf-8");
    }
    if ("content" in asset) {
      return asset.content;
    }
    throw new Error("No readable content");
  });

  // === Asset Creation Handlers ===

  // Create algorithm
  ipcMain.handle("assets:create:algorithm", async (_, params) => {
    return createAlgorithm(params);
  });

  // Create schema
  ipcMain.handle("assets:create:schema", async (_, params) => {
    return createSchema(params);
  });

  // Create prompt
  ipcMain.handle("assets:create:prompt", async (_, params) => {
    return createPrompt(params);
  });

  // Create UI component
  ipcMain.handle("assets:create:ui-component", async (_, params) => {
    return createUIComponent(params);
  });

  // Create API
  ipcMain.handle("assets:create:api", async (_, params) => {
    return createAPI(params);
  });

  // Create training data
  ipcMain.handle("assets:create:training-data", async (_, params) => {
    return createTrainingData(params);
  });

  // Get assets directory
  ipcMain.handle("assets:get-directory", async () => {
    return getAssetsDir();
  });

  logger.info("Asset Studio IPC handlers registered");
}
