// =============================================================================
// Local-First Data Vault Types
// The unified type system for JoyCreate's sovereign data refinery
// =============================================================================

// ---- Vault Core ----

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  totalAssets: number;
  totalBytes: number;
  connectorCount: number;
  lastSyncAt: string | null;
  storageHealth: "healthy" | "degraded" | "error";
  encryptionEnabled: boolean;
}

export interface VaultConfig {
  autoLockMinutes: number;
  encryptAtRest: boolean;
  defaultLicense: string;
  autoDeduplication: boolean;
  piiRedactionEnabled: boolean;
  maxStorageBytes: number;
  localPinning: boolean;
  lanDiscovery: boolean;
}

// ---- Connectors ----

export type ConnectorType =
  | "file_import"
  | "folder_watch"
  | "google_takeout"
  | "apple_export"
  | "slack_export"
  | "discord_export"
  | "browser_extension"
  | "bookmarks_import"
  | "history_import"
  | "manual_capture"
  | "clipboard"
  | "api_endpoint";

export type ConnectorStatus =
  | "disabled"
  | "enabled"
  | "syncing"
  | "paused"
  | "error";

export interface ConnectorConfig {
  id: string;
  type: ConnectorType;
  name: string;
  description: string;
  status: ConnectorStatus;
  // Source configuration
  sourcePath?: string;
  sourceUrl?: string;
  watchPattern?: string;
  // Permissions
  autoImport: boolean;
  requirePreview: boolean;
  // Filters
  allowedMimeTypes?: string[];
  maxFileSize?: number;
  excludePatterns?: string[];
  // Schedule
  syncIntervalMinutes?: number;
  lastSyncAt?: string;
  nextSyncAt?: string;
  // Stats
  totalImported: number;
  totalBytes: number;
  errorCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorImportPreview {
  connectorId: string;
  items: ConnectorPreviewItem[];
  totalCount: number;
  totalBytes: number;
  duplicateCount: number;
}

export interface ConnectorPreviewItem {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  isDuplicate: boolean;
  existingAssetId?: string;
  previewUrl?: string;
}

// ---- Vault Assets ----

export type AssetModality = "text" | "image" | "audio" | "video" | "document" | "structured" | "binary";

export type AssetStatus = "ingested" | "processing" | "ready" | "packaged" | "published" | "archived" | "error";

export interface VaultAsset {
  id: string;
  name: string;
  description?: string;
  modality: AssetModality;
  mimeType: string;
  status: AssetStatus;
  // Content addressing
  contentHash: string;
  byteSize: number;
  storagePath: string;
  // Encryption
  encrypted: boolean;
  encryptionKeyId?: string;
  // Source tracking
  connectorId?: string;
  connectorType?: ConnectorType;
  sourcePath?: string;
  sourceUrl?: string;
  // Organization
  tags: string[];
  collections: string[];
  // Quality & metadata
  qualityScore?: number;
  metadataJson?: Record<string, unknown>;
  // PII detection results
  piiDetected: boolean;
  piiRedacted: boolean;
  piiFieldsJson?: PiiField[];
  // Timestamps
  importedAt: string;
  processedAt?: string;
  publishedAt?: string;
  updatedAt: string;
}

export interface PiiField {
  type: "email" | "phone" | "address" | "ssn" | "credit_card" | "name" | "ip_address" | "api_key" | "password" | "custom";
  location: string; // field path or character range
  confidence: number;
  redacted: boolean;
  redactionMethod?: "mask" | "remove" | "hash" | "generalize";
}

// ---- Transform Pipeline ----

export type TransformStage =
  | "extract"
  | "normalize"
  | "deduplicate"
  | "redact"
  | "label"
  | "package";

export type TransformStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TransformJob {
  id: string;
  name: string;
  // What to transform
  inputAssetIds: string[];
  inputDatasetId?: string;
  // Pipeline config
  stages: TransformStageConfig[];
  currentStage?: TransformStage;
  // Progress
  status: TransformStatus;
  progress: number; // 0-100
  itemsProcessed: number;
  itemsTotal: number;
  // Output
  outputAssetIds: string[];
  outputDatasetId?: string;
  // Errors
  errorMessage?: string;
  errorCount: number;
  // Audit
  auditLogJson: TransformAuditEntry[];
  // Timestamps
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TransformStageConfig {
  stage: TransformStage;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface TransformAuditEntry {
  stage: TransformStage;
  action: string;
  inputCount: number;
  outputCount: number;
  droppedCount: number;
  duration_ms: number;
  timestamp: string;
  details?: string;
}

// Extract stage config
export interface ExtractConfig {
  parsePdf: boolean;
  parseHtml: boolean;
  parseMarkdown: boolean;
  extractMetadata: boolean;
  extractImages: boolean;
  ocrEnabled: boolean;
}

// Normalize stage config
export interface NormalizeConfig {
  encodingTarget: "utf-8";
  trimWhitespace: boolean;
  normalizeNewlines: boolean;
  lowercaseText: boolean;
  removeHtmlTags: boolean;
  schemaMapping?: Record<string, string>;
}

// Deduplicate stage config
export interface DeduplicateConfig {
  method: "exact_hash" | "fuzzy" | "semantic";
  fuzzyThreshold: number; // 0-1
  keepStrategy: "first" | "latest" | "highest_quality";
}

// Redact stage config
export interface RedactConfig {
  detectEmails: boolean;
  detectPhones: boolean;
  detectAddresses: boolean;
  detectSsn: boolean;
  detectCreditCards: boolean;
  detectApiKeys: boolean;
  detectPasswords: boolean;
  customPatterns: RedactPattern[];
  redactionMethod: "mask" | "remove" | "hash" | "generalize";
  requireUserApproval: boolean;
}

export interface RedactPattern {
  name: string;
  pattern: string; // regex
  replacement: string;
}

// Label stage config
export interface LabelConfig {
  autoTag: boolean;
  autoCategory: boolean;
  sentimentAnalysis: boolean;
  languageDetection: boolean;
  domainClassification: boolean;
  useLocalAi: boolean;
  modelId?: string;
  customLabels?: string[];
}

// ---- Packaging ----

export interface PackageManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  // CIDs
  manifestCid: string;
  rootCid: string;
  metadataCid?: string;
  previewCid?: string;
  policyCid?: string;
  // Content
  datasetId: string;
  chunkCount: number;
  totalBytes: number;
  chunkCids: string[];
  // Integrity
  merkleRoot: string;
  integrityHashes: Record<string, string>;
  // Provenance
  provenanceSummary: ProvenanceSummary;
  // Publisher
  publisherWallet: string;
  publisherSignature: string;
  signedAt: string;
  // Encryption
  encrypted: boolean;
  encryptionAlgorithm?: string;
  // Timestamps
  createdAt: string;
}

export interface ProvenanceSummary {
  connectorSources: string[];
  transformStages: string[];
  totalInputItems: number;
  totalOutputItems: number;
  redactedFieldCount: number;
  privacyStatement: string;
}

// ---- Policy ----

export type LicenseTier = "personal" | "commercial" | "enterprise" | "open";

export type PricingModel =
  | "free"
  | "one_time"
  | "subscription"
  | "per_use"
  | "per_token"
  | "pay_what_you_want";

export interface PolicyDocument {
  id: string;
  manifestId: string;
  policyCid: string;
  // License tiers
  licenseTiers: LicenseTierConfig[];
  // Allowed uses
  allowedUses: string[];
  restrictions: string[];
  // Pricing
  pricingModel: PricingModel;
  priceAmount?: number;
  priceCurrency?: string;
  // Sovereign exit
  btcTaprootAddress?: string;
  sovereignExitEnabled: boolean;
  // Privacy
  privacyStatement: string;
  rawDataShared: false; // always false — encrypted payload only
  // Publisher
  publisherWallet: string;
  publisherSignature: string;
  signedAt: string;
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface LicenseTierConfig {
  tier: LicenseTier;
  enabled: boolean;
  price?: number;
  currency?: string;
  maxAccesses?: number;
  expirationDays?: number;
  description: string;
}

// ---- Publish Bundle ----

export interface PublishBundle {
  manifestCid: string;
  policyCid: string;
  previewCid?: string;
  // Suggested marketplace listing fields
  listing: {
    name: string;
    description: string;
    category: string;
    tags: string[];
    previewImageUrl?: string;
    license: string;
    pricingModel: PricingModel;
    price?: number;
    currency?: string;
  };
  // Signatures
  publisherWallet: string;
  publisherSignature: string;
  // Thirdweb references (optional)
  thirdwebListingId?: string;
  polygonContractAddress?: string;
  // Timestamps
  createdAt: string;
}

// ---- Audit Log ----

export type AuditAction =
  | "asset_imported"
  | "asset_transformed"
  | "asset_redacted"
  | "asset_packaged"
  | "asset_published"
  | "asset_deleted"
  | "connector_added"
  | "connector_synced"
  | "connector_removed"
  | "transform_started"
  | "transform_completed"
  | "transform_failed"
  | "package_created"
  | "policy_created"
  | "bundle_published"
  | "vault_unlocked"
  | "vault_locked"
  | "key_rotated"
  | "pii_detected"
  | "pii_redacted"
  | "access_granted"
  | "access_revoked";

export interface VaultAuditEntry {
  id: string;
  action: AuditAction;
  targetId?: string;
  targetType?: string;
  details?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// ---- Browser Extension Bridge ----

export interface BrowserExtensionMessage {
  type: "save_page" | "import_bookmarks" | "import_history";
  payload: SavePagePayload | BookmarksPayload | HistoryPayload;
}

export interface SavePagePayload {
  url: string;
  title: string;
  content: string; // HTML or cleaned text
  mimeType: string;
  timestamp: string;
}

export interface BookmarksPayload {
  bookmarks: Array<{
    url: string;
    title: string;
    folder?: string;
    addedAt?: string;
  }>;
}

export interface HistoryPayload {
  entries: Array<{
    url: string;
    title: string;
    visitCount: number;
    lastVisitAt: string;
  }>;
  timeRange: {
    from: string;
    to: string;
  };
}
