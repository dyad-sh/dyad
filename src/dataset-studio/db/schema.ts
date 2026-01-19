/**
 * JOY Create Dataset Studio - Database Schema
 * 
 * SQLite schema using Drizzle ORM for offline-first dataset management.
 */

import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================================================
// DATASETS
// ============================================================================

export const datasets = sqliteTable('datasets', {
  id: text('id').primaryKey(),                          // UUID
  name: text('name').notNull(),
  description: text('description'),
  version: text('version').notNull().default('0.1.0'),
  previousVersionId: text('previous_version_id'),       // For version chain
  
  // Schema info
  schemaVersion: text('schema_version').notNull().default('1.0.0'),
  modalities: text('modalities', { mode: 'json' }).$type<string[]>().notNull().default([]),
  
  // Counts (denormalized for performance)
  itemCount: integer('item_count').notNull().default(0),
  totalBytes: integer('total_bytes').notNull().default(0),
  
  // Rights
  license: text('license').notNull().default('CC-BY-4.0'),
  licenseUrl: text('license_url'),
  citation: text('citation'),
  
  // Creator
  creatorId: text('creator_id').notNull(),
  creatorName: text('creator_name').notNull(),
  creatorPublicKey: text('creator_public_key').notNull(),
  
  // Timestamps
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  publishedAt: text('published_at'),
  
  // Integrity
  manifestHash: text('manifest_hash'),
  merkleRoot: text('merkle_root'),
  
  // Tags & discovery
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  categories: text('categories', { mode: 'json' }).$type<string[]>().default([]),
  language: text('language'),
  
  // Feature flags
  hasEmbeddings: integer('has_embeddings', { mode: 'boolean' }).default(false),
  hasAnnotations: integer('has_annotations', { mode: 'boolean' }).default(false),
  hasQualityScores: integer('has_quality_scores', { mode: 'boolean' }).default(false),
  isSynthetic: integer('is_synthetic', { mode: 'boolean' }).default(false),
  
  // Status
  status: text('status').$type<'draft' | 'ready' | 'published' | 'archived'>().notNull().default('draft'),
  
  // Access control
  visibility: text('visibility').$type<'private' | 'peer_share' | 'public'>().notNull().default('private'),
  encryptedKey: blob('encrypted_key'),                  // For encrypted sharing
}, (table) => ({
  nameIdx: index('datasets_name_idx').on(table.name),
  statusIdx: index('datasets_status_idx').on(table.status),
  creatorIdx: index('datasets_creator_idx').on(table.creatorId),
  createdAtIdx: index('datasets_created_at_idx').on(table.createdAt),
}));

// ============================================================================
// DATASET ITEMS (ASSETS)
// ============================================================================

export const datasetItems = sqliteTable('dataset_items', {
  id: text('id').primaryKey(),                          // UUID
  datasetId: text('dataset_id').notNull().references(() => datasets.id, { onDelete: 'cascade' }),
  
  // Content identification
  modality: text('modality').$type<'image' | 'video' | 'audio' | 'text' | 'context'>().notNull(),
  contentHash: text('content_hash').notNull(),          // SHA-256
  merkleRoot: text('merkle_root'),                      // For chunked assets
  byteSize: integer('byte_size').notNull(),
  mimeType: text('mime_type').notNull(),
  
  // Timestamps
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  capturedAt: text('captured_at'),
  
  // Source tracking
  sourceType: text('source_type').$type<'captured' | 'imported' | 'generated' | 'api'>().notNull(),
  sourcePath: text('source_path'),
  sourceUrl: text('source_url'),
  
  // Content-addressed pointer
  contentUri: text('content_uri').notNull(),            // sha256:... or CID
  
  // Embedding reference
  embeddingId: text('embedding_id'),
  
  // Split assignment
  split: text('split').$type<'train' | 'val' | 'test' | null>(),
  
  // Status
  status: text('status').$type<'pending' | 'processing' | 'ready' | 'failed' | 'quarantined'>().notNull().default('pending'),
}, (table) => ({
  datasetIdx: index('items_dataset_idx').on(table.datasetId),
  contentHashIdx: uniqueIndex('items_content_hash_idx').on(table.contentHash),
  modalityIdx: index('items_modality_idx').on(table.modality),
  splitIdx: index('items_split_idx').on(table.split),
  statusIdx: index('items_status_idx').on(table.status),
}));

// ============================================================================
// ITEM LINEAGE (GENERATION/TRANSFORMATION HISTORY)
// ============================================================================

export const itemLineage = sqliteTable('item_lineage', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  // Generator info
  generator: text('generator').$type<'local_model' | 'provider_api' | 'human'>().notNull(),
  modelId: text('model_id'),
  modelVersion: text('model_version'),
  providerId: text('provider_id'),
  
  // Prompts
  prompt: text('prompt'),
  systemPrompt: text('system_prompt'),
  negativePrompt: text('negative_prompt'),
  
  // Parameters
  seed: integer('seed'),
  parameters: text('parameters', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
  
  // Parent items (for derivatives)
  parentIds: text('parent_ids', { mode: 'json' }).$type<string[]>().default([]),
  
  // Cost tracking
  costAmount: real('cost_amount'),
  costCurrency: text('cost_currency'),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  itemIdx: index('lineage_item_idx').on(table.itemId),
  modelIdx: index('lineage_model_idx').on(table.modelId),
}));

// ============================================================================
// ITEM LABELS (TAGS, CAPTIONS, ANNOTATIONS)
// ============================================================================

export const itemLabels = sqliteTable('item_labels', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  // Basic labels
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  categories: text('categories', { mode: 'json' }).$type<string[]>().default([]),
  caption: text('caption'),
  transcript: text('transcript'),
  
  // Structured annotations
  boundingBoxes: text('bounding_boxes', { mode: 'json' }).$type<Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    confidence?: number;
  }>>().default([]),
  
  segments: text('segments', { mode: 'json' }).$type<Array<{
    startMs: number;
    endMs: number;
    label: string;
    text?: string;
  }>>().default([]),
  
  // Custom fields
  custom: text('custom', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
  
  // Labeler info
  labeledBy: text('labeled_by').$type<'human' | 'model'>().notNull().default('human'),
  labelModelId: text('label_model_id'),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  itemIdx: uniqueIndex('labels_item_idx').on(table.itemId),
}));

// ============================================================================
// ITEM QUALITY SIGNALS
// ============================================================================

export const itemQualitySignals = sqliteTable('item_quality_signals', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  // Image quality
  blurScore: real('blur_score'),                        // 0-1, lower is sharper
  aestheticScore: real('aesthetic_score'),              // 0-1, higher is better
  nsfwScore: real('nsfw_score'),                        // 0-1, probability
  
  // OCR
  ocrConfidence: real('ocr_confidence'),
  
  // Audio quality
  audioSnrDb: real('audio_snr_db'),                     // Signal-to-noise ratio
  
  // Text quality
  textPerplexity: real('text_perplexity'),
  
  // Deduplication
  duplicateHash: text('duplicate_hash'),                // Perceptual hash
  isDuplicate: integer('is_duplicate', { mode: 'boolean' }).default(false),
  duplicateOfId: text('duplicate_of_id'),
  
  computedAt: text('computed_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  itemIdx: uniqueIndex('quality_item_idx').on(table.itemId),
  duplicateHashIdx: index('quality_duplicate_hash_idx').on(table.duplicateHash),
}));

// ============================================================================
// ITEM RIGHTS & LICENSING
// ============================================================================

export const itemRights = sqliteTable('item_rights', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  license: text('license').notNull().default('CC-BY-4.0'),
  licenseUrl: text('license_url'),
  copyrightHolder: text('copyright_holder'),
  
  consentObtained: integer('consent_obtained', { mode: 'boolean' }).default(false),
  consentType: text('consent_type').$type<'explicit' | 'implicit' | 'public_domain' | 'unknown'>(),
  
  restrictions: text('restrictions', { mode: 'json' }).$type<string[]>().default([]),
  attributionRequired: integer('attribution_required', { mode: 'boolean' }).default(false),
  commercialUseAllowed: integer('commercial_use_allowed', { mode: 'boolean' }).default(true),
  derivativeWorksAllowed: integer('derivative_works_allowed', { mode: 'boolean' }).default(true),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  itemIdx: uniqueIndex('rights_item_idx').on(table.itemId),
}));

// ============================================================================
// ITEM MEDIA INFO
// ============================================================================

export const itemMediaInfo = sqliteTable('item_media_info', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  // Dimensions
  width: integer('width'),
  height: integer('height'),
  
  // Duration (video/audio)
  durationMs: integer('duration_ms'),
  frameRate: real('frame_rate'),
  
  // Audio
  sampleRate: integer('sample_rate'),
  channels: integer('channels'),
  bitDepth: integer('bit_depth'),
  
  // Codec/format
  codec: text('codec'),
  colorSpace: text('color_space'),
  
  // Document
  pages: integer('pages'),
  wordCount: integer('word_count'),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  itemIdx: uniqueIndex('media_info_item_idx').on(table.itemId),
}));

// ============================================================================
// SIGNATURES
// ============================================================================

export const signatures = sqliteTable('signatures', {
  id: text('id').primaryKey(),
  
  // Can be attached to dataset or item
  datasetId: text('dataset_id').references(() => datasets.id, { onDelete: 'cascade' }),
  itemId: text('item_id').references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  signerId: text('signer_id').notNull(),
  publicKey: text('public_key').notNull(),              // Base64 Ed25519
  signature: text('signature').notNull(),               // Base64
  algorithm: text('algorithm').notNull().default('Ed25519'),
  
  signedAt: text('signed_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  datasetIdx: index('signatures_dataset_idx').on(table.datasetId),
  itemIdx: index('signatures_item_idx').on(table.itemId),
}));

// ============================================================================
// DATASET SPLITS
// ============================================================================

export const datasetSplits = sqliteTable('dataset_splits', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull().references(() => datasets.id, { onDelete: 'cascade' }),
  
  name: text('name').notNull(),                         // 'train', 'val', 'test'
  itemCount: integer('item_count').notNull().default(0),
  byteSize: integer('byte_size').notNull().default(0),
  seed: integer('seed'),
  ratio: real('ratio'),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  datasetIdx: index('splits_dataset_idx').on(table.datasetId),
  nameIdx: uniqueIndex('splits_name_idx').on(table.datasetId, table.name),
}));

// ============================================================================
// PROVENANCE EVENTS
// ============================================================================

export const provenanceEvents = sqliteTable('provenance_events', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  eventType: text('event_type').$type<'creation' | 'import' | 'transformation' | 'annotation' | 'verification'>().notNull(),
  eventData: text('event_data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  itemIdx: index('provenance_item_idx').on(table.itemId),
  typeIdx: index('provenance_type_idx').on(table.eventType),
}));

// ============================================================================
// CONTENT BLOBS (Content-Addressed Storage Metadata)
// ============================================================================

export const contentBlobs = sqliteTable('content_blobs', {
  hash: text('hash').primaryKey(),                      // SHA-256
  
  byteSize: integer('byte_size').notNull(),
  mimeType: text('mime_type').notNull(),
  
  // Local storage path
  localPath: text('local_path').notNull(),
  
  // Chunking info (for large files)
  isChunked: integer('is_chunked', { mode: 'boolean' }).default(false),
  chunkCount: integer('chunk_count'),
  chunkHashes: text('chunk_hashes', { mode: 'json' }).$type<string[]>(),
  
  // Pinning
  isPinned: integer('is_pinned', { mode: 'boolean' }).default(true),
  
  // Encryption
  isEncrypted: integer('is_encrypted', { mode: 'boolean' }).default(false),
  encryptedKeyId: text('encrypted_key_id'),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  lastAccessedAt: text('last_accessed_at'),
}, (table) => ({
  localPathIdx: index('blobs_local_path_idx').on(table.localPath),
}));

// ============================================================================
// POLICIES
// ============================================================================

export const policies = sqliteTable('policies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  
  policyType: text('policy_type').$type<'content' | 'privacy' | 'license' | 'quality'>().notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  severity: text('severity').$type<'error' | 'warning' | 'info'>().notNull().default('warning'),
  
  rules: text('rules', { mode: 'json' }).$type<Array<{
    field: string;
    operator: string;
    value: unknown;
    message: string;
  }>>().default([]),
  
  enforceOnImport: integer('enforce_on_import', { mode: 'boolean' }).default(true),
  enforceOnGenerate: integer('enforce_on_generate', { mode: 'boolean' }).default(true),
  enforceOnPublish: integer('enforce_on_publish', { mode: 'boolean' }).default(true),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================================
// POLICY VIOLATIONS
// ============================================================================

export const policyViolations = sqliteTable('policy_violations', {
  id: text('id').primaryKey(),
  
  policyId: text('policy_id').notNull().references(() => policies.id),
  datasetId: text('dataset_id').references(() => datasets.id, { onDelete: 'cascade' }),
  itemId: text('item_id').references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  severity: text('severity').$type<'error' | 'warning' | 'info'>().notNull(),
  message: text('message').notNull(),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
  
  resolved: integer('resolved', { mode: 'boolean' }).default(false),
  resolvedAt: text('resolved_at'),
  resolvedBy: text('resolved_by'),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  policyIdx: index('violations_policy_idx').on(table.policyId),
  datasetIdx: index('violations_dataset_idx').on(table.datasetId),
  itemIdx: index('violations_item_idx').on(table.itemId),
}));

// ============================================================================
// CONTEXT PACKS
// ============================================================================

export const contextPacks = sqliteTable('context_packs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  
  // Prompts
  prompts: text('prompts', { mode: 'json' }).$type<Array<{
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
  }>>().default([]),
  
  // Settings
  settings: text('settings', { mode: 'json' }).$type<{
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    stopSequences?: string[];
    seed?: number;
  }>(),
  
  // Toolchain
  toolchain: text('toolchain', { mode: 'json' }).$type<{
    appVersion: string;
    modelId?: string;
    modelVersion?: string;
    pipelineVersion?: string;
  }>().notNull(),
  
  // Sources
  sources: text('sources', { mode: 'json' }).$type<Array<{
    type: 'file' | 'url' | 'content_hash' | 'dataset';
    reference: string;
    description?: string;
  }>>().default([]),
  
  // Notes
  notes: text('notes'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  categories: text('categories', { mode: 'json' }).$type<string[]>().default([]),
  
  // Consent
  dataCollectionConsent: integer('data_collection_consent', { mode: 'boolean' }).default(false),
  trainingConsent: integer('training_consent', { mode: 'boolean' }).default(false),
  commercialConsent: integer('commercial_consent', { mode: 'boolean' }).default(false),
  usageRestrictions: text('usage_restrictions', { mode: 'json' }).$type<string[]>().default([]),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================================
// EMBEDDINGS
// ============================================================================

export const embeddings = sqliteTable('embeddings', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => datasetItems.id, { onDelete: 'cascade' }),
  
  modelId: text('model_id').notNull(),
  modelVersion: text('model_version'),
  dimensions: integer('dimensions').notNull(),
  
  // Store as blob for efficiency
  vector: blob('vector').notNull(),                     // Float32Array as bytes
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  itemIdx: index('embeddings_item_idx').on(table.itemId),
  modelIdx: index('embeddings_model_idx').on(table.modelId),
}));

// ============================================================================
// LOCAL MODELS
// ============================================================================

export const localModels = sqliteTable('local_models', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  
  modality: text('modality').$type<'text' | 'image' | 'audio' | 'embedding' | 'multimodal'>().notNull(),
  capabilities: text('capabilities', { mode: 'json' }).$type<string[]>().default([]),
  
  quantization: text('quantization'),
  sizeBytes: integer('size_bytes').notNull(),
  memoryRequired: integer('memory_required').notNull(),
  
  isDownloaded: integer('is_downloaded', { mode: 'boolean' }).default(false),
  localPath: text('local_path'),
  downloadUrl: text('download_url'),
  
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================================
// PROVIDERS (API PROVIDERS)
// ============================================================================

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<'local' | 'openai' | 'anthropic' | 'google' | 'custom'>().notNull(),
  
  baseUrl: text('base_url'),
  apiKeyEncrypted: blob('api_key_encrypted'),
  
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  
  // Rate limiting
  rateLimit: integer('rate_limit'),                     // Requests per minute
  costPerToken: real('cost_per_token'),
  
  capabilities: text('capabilities', { mode: 'json' }).$type<string[]>().default([]),
  models: text('models', { mode: 'json' }).$type<string[]>().default([]),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================================
// JOB QUEUE
// ============================================================================

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  
  jobType: text('job_type').$type<'ingest' | 'generate' | 'transform' | 'label' | 'sync' | 'publish'>().notNull(),
  priority: integer('priority').notNull().default(50),
  status: text('status').$type<'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'>().notNull().default('pending'),
  
  progress: integer('progress').notNull().default(0),
  
  input: text('input', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  output: text('output', { mode: 'json' }).$type<Record<string, unknown>>(),
  
  // Checkpoints for resumability
  checkpoints: text('checkpoints', { mode: 'json' }).$type<Array<{
    phase: string;
    index: number;
    timestamp: string;
    data?: Record<string, unknown>;
  }>>().default([]),
  
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  
  error: text('error', { mode: 'json' }).$type<{
    code: string;
    message: string;
    stack?: string;
  }>(),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
}, (table) => ({
  statusIdx: index('jobs_status_idx').on(table.status),
  typeIdx: index('jobs_type_idx').on(table.jobType),
  priorityIdx: index('jobs_priority_idx').on(table.priority),
}));

// ============================================================================
// P2P PEERS
// ============================================================================

export const peers = sqliteTable('peers', {
  id: text('id').primaryKey(),                          // libp2p peer ID
  
  name: text('name'),
  publicKey: blob('public_key').notNull(),
  
  addresses: text('addresses', { mode: 'json' }).$type<string[]>().default([]),
  
  isTrusted: integer('is_trusted', { mode: 'boolean' }).default(false),
  trustLevel: text('trust_level').$type<'untrusted' | 'known' | 'trusted' | 'verified'>().default('untrusted'),
  
  lastSeen: text('last_seen'),
  lastConnected: text('last_connected'),
  
  // Stats
  datasetsShared: integer('datasets_shared').default(0),
  bytesTransferred: integer('bytes_transferred').default(0),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  trustedIdx: index('peers_trusted_idx').on(table.isTrusted),
}));

// ============================================================================
// PEER GROUPS
// ============================================================================

export const peerGroups = sqliteTable('peer_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  
  members: text('members', { mode: 'json' }).$type<string[]>().default([]),
  sharedKeyEncrypted: blob('shared_key_encrypted'),
  
  canRead: integer('can_read', { mode: 'boolean' }).default(true),
  canWrite: integer('can_write', { mode: 'boolean' }).default(false),
  canInvite: integer('can_invite', { mode: 'boolean' }).default(false),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================================
// SYNC SESSIONS
// ============================================================================

export const syncSessions = sqliteTable('sync_sessions', {
  id: text('id').primaryKey(),
  
  peerId: text('peer_id').notNull().references(() => peers.id),
  datasetId: text('dataset_id').notNull().references(() => datasets.id),
  
  direction: text('direction').$type<'push' | 'pull' | 'bidirectional'>().notNull(),
  status: text('status').$type<'connecting' | 'syncing' | 'verifying' | 'complete' | 'failed'>().notNull(),
  
  // Progress
  manifestSynced: integer('manifest_synced', { mode: 'boolean' }).default(false),
  totalBlobs: integer('total_blobs').default(0),
  syncedBlobs: integer('synced_blobs').default(0),
  bytesTransferred: integer('bytes_transferred').default(0),
  
  // Conflicts
  conflicts: text('conflicts', { mode: 'json' }).$type<Array<{
    itemId: string;
    localVersion: string;
    remoteVersion: string;
    resolution: 'pending' | 'local_wins' | 'remote_wins' | 'merged';
  }>>().default([]),
  
  error: text('error'),
  
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
}, (table) => ({
  peerIdx: index('sync_peer_idx').on(table.peerId),
  datasetIdx: index('sync_dataset_idx').on(table.datasetId),
  statusIdx: index('sync_status_idx').on(table.status),
}));

// ============================================================================
// FEDERATION QUEUE (Offline Operations)
// ============================================================================

export const federationQueue = sqliteTable('federation_queue', {
  id: text('id').primaryKey(),
  
  operationType: text('operation_type').$type<'publish' | 'update' | 'unpublish' | 'upload_blob'>().notNull(),
  operationData: text('operation_data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  
  status: text('status').$type<'pending' | 'processing' | 'completed' | 'failed'>().notNull().default('pending'),
  retryCount: integer('retry_count').default(0),
  maxRetries: integer('max_retries').default(5),
  
  error: text('error'),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  processedAt: text('processed_at'),
}, (table) => ({
  statusIdx: index('federation_queue_status_idx').on(table.status),
}));

// ============================================================================
// IDENTITIES
// ============================================================================

export const identities = sqliteTable('identities', {
  id: text('id').primaryKey(),                          // Derived from public key
  name: text('name').notNull(),
  
  publicKey: blob('public_key').notNull(),              // Ed25519
  privateKeyEncrypted: blob('private_key_encrypted').notNull(),
  
  isPrimary: integer('is_primary', { mode: 'boolean' }).default(false),
  
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  primaryIdx: index('identities_primary_idx').on(table.isPrimary),
}));

// ============================================================================
// SECRETS (Encrypted key-value store)
// ============================================================================

export const secrets = sqliteTable('secrets', {
  key: text('key').primaryKey(),
  valueEncrypted: blob('value_encrypted').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ============================================================================
// FULL-TEXT SEARCH VIRTUAL TABLE
// ============================================================================

// Note: FTS5 virtual table must be created manually in migrations
// CREATE VIRTUAL TABLE items_fts USING fts5(
//   id,
//   dataset_id,
//   caption,
//   transcript,
//   tags,
//   categories,
//   content='dataset_items',
//   content_rowid='rowid'
// );
