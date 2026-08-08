import { z } from "zod";

import {
  createClient,
  createEventClient,
  defineContract,
  defineEvent,
} from "../contracts/core";

export const VectorServiceStateSchema = z.enum([
  "stopped",
  "starting",
  "ready",
  "indexing",
  "attention",
]);
export type VectorServiceState = z.infer<typeof VectorServiceStateSchema>;

export const VectorServiceStatusSchema = z.object({
  state: VectorServiceStateSchema,
  message: z.string(),
  localOnly: z.literal(true),
  error: z.string().nullish(),
});
export type VectorServiceStatus = z.infer<typeof VectorServiceStatusSchema>;

export const VectorCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  embeddingModel: z.string(),
  /** provider:model:dimensions — vectors are only comparable within one. */
  embeddingVersion: z.string().optional(),
  dimensions: z.number().int().positive(),
  documentCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
  health: z.enum(["ready", "indexing", "attention"]),
  createdAt: z.string(),
  lastIndexedAt: z.string().nullish(),
});
export type VectorCollection = z.infer<typeof VectorCollectionSchema>;

export const VectorSourceSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "folder"]),
  status: z.enum(["ready", "indexing", "attention"]),
  chunkCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  lastIndexedAt: z.string().nullish(),
  error: z.string().nullish(),
});
export type VectorSource = z.infer<typeof VectorSourceSchema>;

export const VectorSearchResultSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  collectionName: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  sourcePath: z.string(),
  content: z.string(),
  score: z.number(),
  lineStart: z.number().int().positive().nullish(),
  lineEnd: z.number().int().positive().nullish(),
  /** Page the passage came from, when the document had page markers. */
  page: z.number().int().positive().nullish(),
  language: z.string().nullish(),
  modifiedAt: z.string().nullish(),
});
export type VectorSearchResult = z.infer<typeof VectorSearchResultSchema>;

export const VectorActivitySchema = z.object({
  id: z.string(),
  message: z.string(),
  at: z.string(),
  tone: z.enum(["info", "success", "warning"]),
});
export type VectorActivity = z.infer<typeof VectorActivitySchema>;

/**
 * How text becomes vectors. Optional throughout so an existing settings file
 * keeps working: absent means "auto", which is what it effectively did before.
 */
export const EmbeddingSettingsSchema = z.object({
  provider: z
    .enum(["auto", "ollama", "openai-compatible", "lexical-fallback"])
    .optional(),
  model: z.string().optional(),
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  dimensions: z.number().int().positive().optional(),
  batchSize: z.number().int().min(1).max(256).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  enableFallback: z.boolean().optional(),
});

export type EmbeddingSettings = z.infer<typeof EmbeddingSettingsSchema>;

export const VectorSettingsSchema = z.object({
  allowCloudRag: z.boolean(),
  embedding: EmbeddingSettingsSchema.optional(),
  includeHiddenFiles: z.boolean(),
  defaultResultCount: z.number().int().min(1).max(30),
  minimumScore: z.number().min(0).max(1),
});
export type VectorSettings = z.infer<typeof VectorSettingsSchema>;

export const VectorOverviewSchema = z.object({
  status: VectorServiceStatusSchema,
  collectionCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
  embeddingModel: z.string(),
  lastBackupAt: z.string().nullish(),
  activity: z.array(VectorActivitySchema),
  settings: VectorSettingsSchema,
});
export type VectorOverview = z.infer<typeof VectorOverviewSchema>;

export const VectorRagResponseSchema = z.object({
  answer: z.string(),
  results: z.array(VectorSearchResultSchema),
  usedCloudModel: z.boolean(),
});
export type VectorRagResponse = z.infer<typeof VectorRagResponseSchema>;

/** One document in the vault's Documents folder, as indexed. */
export const KnowledgeBaseDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  extension: z.string(),
  sizeBytes: z.number().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  /** "missing" means it was indexed but has since left the folder. */
  status: z.enum(["ready", "indexing", "attention", "missing"]),
  lastIndexedAt: z.string().nullish(),
  error: z.string().nullish(),
});
export type KnowledgeBaseDocument = z.infer<typeof KnowledgeBaseDocumentSchema>;

export const KnowledgeBaseOverviewSchema = z.object({
  status: VectorServiceStatusSchema,
  /** Null until a local vault folder is chosen in Storage. */
  documentsFolder: z.string().nullable(),
  collectionId: z.string().nullable(),
  embeddingModel: z.string(),
  dimensions: z.number().int().positive(),
  storageBytes: z.number().nonnegative(),
  documentCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  /** Files in the folder that have not been indexed yet. */
  pendingCount: z.number().int().nonnegative(),
  lastIndexedAt: z.string().nullable(),
  documents: z.array(KnowledgeBaseDocumentSchema),
});
export type KnowledgeBaseOverview = z.infer<typeof KnowledgeBaseOverviewSchema>;

export const KnowledgeBaseImportProgressSchema = z.object({
  phase: z.enum(["uploading", "indexing"]),
  completedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  currentFile: z.string().nullish(),
  completedBytes: z.number().int().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
});
export type KnowledgeBaseImportProgress = z.infer<
  typeof KnowledgeBaseImportProgressSchema
>;

export const vectorEvents = {
  knowledgeBaseImportProgress: defineEvent({
    channel: "vector:knowledge-base:import-progress",
    payload: KnowledgeBaseImportProgressSchema,
  }),
} as const;

const CollectionIdInput = z.object({ collectionId: z.string().min(1) });

export const vectorContracts = {
  getOverview: defineContract({
    channel: "vector:get-overview",
    input: z.void(),
    output: VectorOverviewSchema,
  }),
  start: defineContract({
    channel: "vector:start",
    input: z.void(),
    output: VectorServiceStatusSchema,
  }),
  restart: defineContract({
    channel: "vector:restart",
    input: z.void(),
    output: VectorServiceStatusSchema,
  }),
  listCollections: defineContract({
    channel: "vector:list-collections",
    input: z.void(),
    output: z.array(VectorCollectionSchema),
  }),
  createCollection: defineContract({
    channel: "vector:create-collection",
    input: z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500).default(""),
    }),
    output: VectorCollectionSchema,
  }),
  updateCollection: defineContract({
    channel: "vector:update-collection",
    input: z.object({
      collectionId: z.string().min(1),
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500),
    }),
    output: VectorCollectionSchema,
  }),
  deleteCollection: defineContract({
    channel: "vector:delete-collection",
    input: CollectionIdInput,
    output: z.object({ deleted: z.boolean() }),
  }),
  chooseSources: defineContract({
    channel: "vector:choose-sources",
    input: CollectionIdInput,
    output: z.object({ paths: z.array(z.string()) }),
  }),
  indexPaths: defineContract({
    channel: "vector:index-paths",
    input: z.object({
      collectionId: z.string().min(1),
      paths: z.array(z.string()).min(1).max(100),
    }),
    output: z.array(VectorSourceSchema),
  }),
  /** Opens an indexed source file by the name the model cited. */
  openSourceByName: defineContract({
    channel: "vector:open-source-by-name",
    input: z.object({
      sourceName: z.string(),
      page: z.number().int().positive().optional(),
      lineStart: z.number().int().positive().optional(),
      lineEnd: z.number().int().positive().optional(),
    }),
    output: z.object({ opened: z.boolean(), path: z.string().nullable() }),
  }),
  /** Opens a retrieval source after validating it against the selected index. */
  openSourceLocation: defineContract({
    channel: "vector:open-source-location",
    input: z.object({
      collectionId: z.string().min(1),
      sourceId: z.string().min(1),
      page: z.number().int().positive().optional(),
      lineStart: z.number().int().positive().optional(),
      lineEnd: z.number().int().positive().optional(),
    }),
    output: z.object({ opened: z.boolean(), path: z.string().nullable() }),
  }),

  listSources: defineContract({
    channel: "vector:list-sources",
    input: CollectionIdInput,
    output: z.array(VectorSourceSchema),
  }),
  removeSource: defineContract({
    channel: "vector:remove-source",
    input: z.object({
      collectionId: z.string().min(1),
      sourceId: z.string().min(1),
    }),
    output: z.object({ deleted: z.boolean() }),
  }),
  search: defineContract({
    channel: "vector:search",
    input: z.object({
      query: z.string().trim().min(1).max(10_000),
      collectionIds: z.array(z.string()).min(1),
      limit: z.number().int().min(1).max(30).default(8),
      minimumScore: z.number().min(0).max(1).default(0.12),
    }),
    output: z.array(VectorSearchResultSchema),
  }),
  ragQuery: defineContract({
    channel: "vector:rag-query",
    input: z.object({
      query: z.string().trim().min(1).max(10_000),
      collectionIds: z.array(z.string()).min(1),
      limit: z.number().int().min(1).max(20).default(6),
      allowCloud: z.boolean().default(false),
    }),
    output: VectorRagResponseSchema,
  }),
  updateSettings: defineContract({
    channel: "vector:update-settings",
    input: VectorSettingsSchema,
    output: VectorSettingsSchema,
  }),
  createBackup: defineContract({
    channel: "vector:create-backup",
    input: z.void(),
    output: z.object({ path: z.string(), createdAt: z.string() }),
  }),

  // Knowledge Base: the vault Documents folder, indexed for retrieval.
  getKnowledgeBase: defineContract({
    channel: "vector:knowledge-base:get",
    input: z.void(),
    output: KnowledgeBaseOverviewSchema,
  }),
  indexKnowledgeBase: defineContract({
    channel: "vector:knowledge-base:index",
    input: z.void(),
    output: KnowledgeBaseOverviewSchema,
  }),
  addKnowledgeBaseDocuments: defineContract({
    channel: "vector:knowledge-base:add-documents",
    input: z.void(),
    output: KnowledgeBaseOverviewSchema,
  }),
  retryKnowledgeBaseDocument: defineContract({
    channel: "vector:knowledge-base:retry-document",
    input: z.object({ documentId: z.string().min(1) }),
    output: KnowledgeBaseOverviewSchema,
  }),
  removeKnowledgeBaseDocument: defineContract({
    channel: "vector:knowledge-base:remove-document",
    input: z.object({
      documentId: z.string().min(1),
      deleteFile: z.boolean().default(false),
    }),
    output: KnowledgeBaseOverviewSchema,
  }),
  openDocumentsFolder: defineContract({
    channel: "vector:knowledge-base:open-folder",
    input: z.void(),
    output: z.object({ opened: z.boolean() }),
  }),
} as const;

export const vectorClient = createClient(vectorContracts);
export const vectorEventClient = createEventClient(vectorEvents);
