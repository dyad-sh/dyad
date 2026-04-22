/**
 * Data Studio Extended IPC Client
 * Client-side interface for all expanded Data Studio operations
 * 
 * Includes:
 * - Core data operations (import/export, backup, validation)
 * - Data vault (encryption, identity, secrets)
 * - Media pipeline (image, audio, video processing)
 * - Quality analysis (blur, text quality, duplicates)
 * - Policy engine (content policies, licenses, privacy)
 * - Full-text search (FTS5-powered search)
 */

// ============================================================================
// Types
// ============================================================================

// Core Data Types
export interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

export interface ExportResult {
  success: boolean;
  outputPath: string;
  itemsExported: number;
  format: string;
}

export interface ValidationResult {
  success: boolean;
  valid: boolean;
  totalItems: number;
  validItems: number;
  invalidItems: number;
  issues: Array<{
    itemId: string;
    type: string;
    message: string;
  }>;
}

export interface BackupInfo {
  id: string;
  path: string;
  createdAt: string;
  datasetId?: string;
  sizeBytes: number;
  itemCount: number;
}

export interface DuplicateGroup {
  hash: string;
  itemIds: string[];
  count: number;
}

export interface StatisticsResult {
  success: boolean;
  totalItems: number;
  totalBytes: number;
  byModality: Record<string, { count: number; bytes: number }>;
  bySplit: Record<string, number>;
  bySource: Record<string, number>;
  dateRange: { earliest: string; latest: string };
}

// Vault Types
export interface VaultIdentity {
  publicKey: string;
  created: string;
  algorithm: string;
}

export interface PeerInfo {
  peerId: string;
  name: string;
  publicKey: string;
  addedAt: string;
  lastSeen?: string;
  trusted: boolean;
}

// Media Types
export interface MediaInfo {
  type: "image" | "audio" | "video" | "unknown";
  mimeType: string;
  size: number;
  metadata: Record<string, any>;
}

export interface ProcessedMedia {
  success: boolean;
  outputPath: string;
  hash?: string;
}

// Quality Types
export interface ImageQualityResult {
  blurScore: number;
  brightnessScore: number;
  contrastScore: number;
  colorfulness: number;
  resolution: { width: number; height: number };
  aspectRatio: number;
}

export interface TextQualityResult {
  wordCount: number;
  sentenceCount: number;
  avgWordLength: number;
  avgSentenceLength: number;
  readabilityScore: number;
  languageCode?: string;
  lexicalDiversity: number;
  hasProfanity: boolean;
  hasUrls: boolean;
  hasEmails: boolean;
}

export interface QualityStatistics {
  total: number;
  analyzed: number;
  unanalyzed: number;
  byModality: Record<string, { total: number; analyzed: number }>;
  quality: {
    avgBlurScore: number;
    avgBrightness: number;
    avgReadability: number;
  };
}

// Policy Types
export interface ContentPolicy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  rules: PolicyRule[];
  actions: PolicyAction[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyRule {
  id: string;
  type: "content" | "metadata" | "quality" | "size" | "age";
  field?: string;
  operator: string;
  value: any;
  caseSensitive?: boolean;
}

export interface PolicyAction {
  type: "flag" | "quarantine" | "delete" | "redact" | "notify" | "tag";
  parameters?: Record<string, any>;
}

export interface License {
  id: string;
  spdxId: string;
  name: string;
  url?: string;
  permissions: string[];
  conditions: string[];
  limitations: string[];
  commercial: boolean;
  attribution: boolean;
  shareAlike: boolean;
}

export interface PrivacyRule {
  id: string;
  name: string;
  type: "pii" | "regex" | "keyword" | "pattern";
  pattern?: string;
  replacement?: string;
  enabled: boolean;
  categories: string[];
}

export interface PolicyViolation {
  id: string;
  policyId: string;
  policyName: string;
  itemId: string;
  datasetId: string;
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  detectedAt: Date;
  resolved: boolean;
}

// Search Types
export interface SearchResult {
  itemId: string;
  datasetId: string;
  datasetName: string;
  snippet: string;
  rank: number;
  highlights: string[];
  metadata: Record<string, any>;
}

export interface SearchQuery {
  query: string;
  datasetIds?: string[];
  modalities?: string[];
  splits?: string[];
  limit?: number;
  offset?: number;
  sortBy?: "rank" | "date" | "size";
  sortOrder?: "asc" | "desc";
}

export interface SearchSuggestion {
  text: string;
  type: "term" | "phrase" | "recent" | "popular";
  score: number;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: SearchQuery;
  createdAt: Date;
  lastUsed?: Date;
  useCount: number;
}

// ============================================================================
// Client Class
// ============================================================================

class DataStudioExtendedClient {
  private ipcRenderer: Electron.IpcRenderer;

  constructor() {
    this.ipcRenderer = (window as any).electron?.ipcRenderer ?? {
      invoke: async (..._args: any[]) => null,
      on: () => {},
      removeListener: () => {},
    };
  }

  // ==========================================================================
  // Core Data Operations
  // ==========================================================================

  async batchImportDirectory(args: {
    datasetId: string;
    directoryPath: string;
    recursive?: boolean;
    filePatterns?: string[];
    excludePatterns?: string[];
    sourceType?: string;
    license?: string;
  }): Promise<ImportResult> {
    return this.ipcRenderer.invoke("data-studio:batch-import-directory", args);
  }

  async importJsonl(args: {
    datasetId: string;
    filePath: string;
    contentField?: string;
    metadataFields?: string[];
  }): Promise<ImportResult> {
    return this.ipcRenderer.invoke("data-studio:import-jsonl", args);
  }

  async importCsv(args: {
    datasetId: string;
    filePath: string;
    contentColumn: string;
    metadataColumns?: string[];
    delimiter?: string;
  }): Promise<ImportResult> {
    return this.ipcRenderer.invoke("data-studio:import-csv", args);
  }

  async exportToFormat(args: {
    datasetId: string;
    outputPath: string;
    format: "jsonl" | "csv" | "parquet" | "sqlite" | "huggingface";
    splits?: string[];
    includeContent?: boolean;
    contentFormat?: "inline" | "files" | "base64";
  }): Promise<ExportResult> {
    return this.ipcRenderer.invoke("data-studio:export-to-format", args);
  }

  async validateDataset(datasetId: string): Promise<ValidationResult> {
    return this.ipcRenderer.invoke("data-studio:validate-dataset", datasetId);
  }

  async findDuplicates(datasetId: string): Promise<{
    success: boolean;
    duplicateGroups: DuplicateGroup[];
    totalDuplicates: number;
  }> {
    return this.ipcRenderer.invoke("data-studio:find-duplicates", datasetId);
  }

  async removeDuplicates(args: {
    datasetId: string;
    keepStrategy?: "first" | "last" | "newest" | "oldest";
  }): Promise<{ success: boolean; removed: number }> {
    return this.ipcRenderer.invoke("data-studio:remove-duplicates", args);
  }

  async createBackup(args?: {
    datasetId?: string;
    includeContent?: boolean;
  }): Promise<{ success: boolean; backup: BackupInfo }> {
    return this.ipcRenderer.invoke("data-studio:create-backup", args);
  }

  async restoreBackup(backupPath: string): Promise<{
    success: boolean;
    restoredDatasets: number;
    restoredItems: number;
  }> {
    return this.ipcRenderer.invoke("data-studio:restore-backup", backupPath);
  }

  async listBackups(): Promise<{ success: boolean; backups: BackupInfo[] }> {
    return this.ipcRenderer.invoke("data-studio:list-backups");
  }

  async advancedSearch(args: {
    datasetId: string;
    filters: Array<{
      field: string;
      operator: string;
      value: any;
    }>;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }): Promise<{ success: boolean; items: any[]; total: number }> {
    return this.ipcRenderer.invoke("data-studio:advanced-search", args);
  }

  async getStatistics(datasetId: string): Promise<StatisticsResult> {
    return this.ipcRenderer.invoke("data-studio:get-statistics", datasetId);
  }

  // ==========================================================================
  // Data Vault Operations
  // ==========================================================================

  async vaultInitialize(passphrase: string): Promise<{ success: boolean; identity: VaultIdentity }> {
    return this.ipcRenderer.invoke("data-vault:initialize", passphrase);
  }

  async vaultUnlock(passphrase: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("data-vault:unlock", passphrase);
  }

  async vaultLock(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("data-vault:lock");
  }

  async vaultChangePassphrase(args: {
    currentPassphrase: string;
    newPassphrase: string;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("data-vault:change-passphrase", args);
  }

  async vaultGetIdentity(): Promise<{ success: boolean; identity: VaultIdentity }> {
    return this.ipcRenderer.invoke("data-vault:get-identity");
  }

  async vaultSign(data: string): Promise<{ success: boolean; signature: string }> {
    return this.ipcRenderer.invoke("data-vault:sign", data);
  }

  async vaultVerify(args: { data: string; signature: string; publicKey: string }): Promise<{
    success: boolean;
    valid: boolean;
  }> {
    return this.ipcRenderer.invoke("data-vault:verify", args);
  }

  async vaultStoreSecret(args: {
    key: string;
    value: string;
    category?: string;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("data-vault:store-secret", args);
  }

  async vaultGetSecret(key: string): Promise<{ success: boolean; value: string }> {
    return this.ipcRenderer.invoke("data-vault:get-secret", key);
  }

  async vaultAddPeer(args: {
    peerId: string;
    name: string;
    publicKey: string;
    trusted?: boolean;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("data-vault:add-peer", args);
  }

  async vaultListPeers(): Promise<{ success: boolean; peers: PeerInfo[] }> {
    return this.ipcRenderer.invoke("data-vault:list-peers");
  }

  async vaultEncryptForPeer(args: {
    peerId: string;
    data: string;
  }): Promise<{ success: boolean; encrypted: string }> {
    return this.ipcRenderer.invoke("data-vault:encrypt-for-peer", args);
  }

  async vaultDecryptFromPeer(args: {
    encrypted: string;
    senderPublicKey: string;
  }): Promise<{ success: boolean; decrypted: string }> {
    return this.ipcRenderer.invoke("data-vault:decrypt-from-peer", args);
  }

  // ==========================================================================
  // Media Pipeline Operations
  // ==========================================================================

  async mediaGetInfo(filePath: string): Promise<{ success: boolean; info: MediaInfo }> {
    return this.ipcRenderer.invoke("media-pipeline:get-info", filePath);
  }

  async mediaCheckTools(): Promise<{
    success: boolean;
    ffmpeg: boolean;
    ffprobe: boolean;
    paths: { ffmpeg?: string; ffprobe?: string };
  }> {
    return this.ipcRenderer.invoke("media-pipeline:check-tools");
  }

  async mediaProcessImage(args: {
    inputPath: string;
    outputPath: string;
    operations: Array<{
      type: "resize" | "crop" | "rotate" | "flip" | "grayscale" | "blur" | "sharpen" | "normalize";
      params?: Record<string, any>;
    }>;
  }): Promise<ProcessedMedia> {
    return this.ipcRenderer.invoke("media-pipeline:process-image", args);
  }

  async mediaGenerateThumbnail(args: {
    inputPath: string;
    outputPath: string;
    width?: number;
    height?: number;
    quality?: number;
  }): Promise<ProcessedMedia> {
    return this.ipcRenderer.invoke("media-pipeline:generate-thumbnail", args);
  }

  async mediaExtractImageMetadata(filePath: string): Promise<{
    success: boolean;
    metadata: Record<string, any>;
  }> {
    return this.ipcRenderer.invoke("media-pipeline:extract-image-metadata", filePath);
  }

  async mediaStripMetadata(args: {
    inputPath: string;
    outputPath: string;
  }): Promise<ProcessedMedia> {
    return this.ipcRenderer.invoke("media-pipeline:strip-metadata", args);
  }

  async mediaProcessAudio(args: {
    inputPath: string;
    outputPath: string;
    operations: Array<{
      type: "convert" | "normalize" | "trim" | "resample" | "mono" | "denoise";
      params?: Record<string, any>;
    }>;
  }): Promise<ProcessedMedia> {
    return this.ipcRenderer.invoke("media-pipeline:process-audio", args);
  }

  async mediaExtractWaveform(args: {
    inputPath: string;
    outputPath: string;
    width?: number;
    height?: number;
  }): Promise<ProcessedMedia> {
    return this.ipcRenderer.invoke("media-pipeline:extract-waveform", args);
  }

  async mediaProcessVideo(args: {
    inputPath: string;
    outputPath: string;
    operations: Array<{
      type: "resize" | "trim" | "fps" | "extract_audio" | "mute" | "compress";
      params?: Record<string, any>;
    }>;
  }): Promise<ProcessedMedia> {
    return this.ipcRenderer.invoke("media-pipeline:process-video", args);
  }

  async mediaExtractFrames(args: {
    inputPath: string;
    outputDir: string;
    fps?: number;
    startTime?: number;
    duration?: number;
  }): Promise<{ success: boolean; frames: string[]; count: number }> {
    return this.ipcRenderer.invoke("media-pipeline:extract-frames", args);
  }

  async mediaVideoThumbnail(args: {
    inputPath: string;
    outputPath: string;
    timestamp?: number;
    width?: number;
    height?: number;
  }): Promise<ProcessedMedia> {
    return this.ipcRenderer.invoke("media-pipeline:video-thumbnail", args);
  }

  // ==========================================================================
  // Quality Analysis Operations
  // ==========================================================================

  async qualityAnalyzeImage(args: {
    itemId?: string;
    filePath?: string;
    contentHash?: string;
  }): Promise<{ success: boolean; quality: ImageQualityResult }> {
    return this.ipcRenderer.invoke("quality:analyze-image", args);
  }

  async qualityComputePhash(args: {
    itemId?: string;
    filePath?: string;
    contentHash?: string;
  }): Promise<{ success: boolean; perceptualHash: string }> {
    return this.ipcRenderer.invoke("quality:compute-phash", args);
  }

  async qualityAnalyzeText(args: {
    itemId?: string;
    text?: string;
    contentHash?: string;
  }): Promise<{ success: boolean; quality: TextQualityResult }> {
    return this.ipcRenderer.invoke("quality:analyze-text", args);
  }

  async qualityFindExactDuplicates(datasetId: string): Promise<{
    success: boolean;
    totalItems: number;
    uniqueItems: number;
    duplicateGroups: number;
    duplicates: DuplicateGroup[];
  }> {
    return this.ipcRenderer.invoke("quality:find-exact-duplicates", datasetId);
  }

  async qualityFindSimilarImages(args: {
    datasetId: string;
    threshold?: number;
  }): Promise<{
    success: boolean;
    totalImages: number;
    similarGroups: number;
    groups: Array<{ items: string[]; similarity: number }>;
  }> {
    return this.ipcRenderer.invoke("quality:find-similar-images", args);
  }

  async qualityBatchAnalyze(args: {
    datasetId: string;
    types?: Array<"blur" | "text" | "phash" | "all">;
    onlyUnanalyzed?: boolean;
  }): Promise<{
    success: boolean;
    total: number;
    succeeded: number;
    failed: number;
  }> {
    return this.ipcRenderer.invoke("quality:batch-analyze", args);
  }

  async qualityGetStatistics(datasetId: string): Promise<{
    success: boolean;
    statistics: QualityStatistics;
  }> {
    return this.ipcRenderer.invoke("quality:get-statistics", datasetId);
  }

  async qualityFilterItems(args: {
    datasetId: string;
    thresholds: {
      maxBlurScore?: number;
      minBrightness?: number;
      maxBrightness?: number;
      minReadability?: number;
      minWordCount?: number;
      maxWordCount?: number;
    };
    action?: "list" | "tag" | "move_to_split";
    targetSplit?: string;
    tag?: string;
  }): Promise<{
    success: boolean;
    totalItems: number;
    matchingItems: number;
    itemIds: string[];
  }> {
    return this.ipcRenderer.invoke("quality:filter-items", args);
  }

  // ==========================================================================
  // Policy Engine Operations
  // ==========================================================================

  async policyCreate(policy: Omit<ContentPolicy, "id" | "createdAt" | "updatedAt">): Promise<{
    success: boolean;
    policy: ContentPolicy;
  }> {
    return this.ipcRenderer.invoke("policy:create", policy);
  }

  async policyList(): Promise<{ success: boolean; policies: ContentPolicy[] }> {
    return this.ipcRenderer.invoke("policy:list");
  }

  async policyGet(policyId: string): Promise<{ success: boolean; policy: ContentPolicy }> {
    return this.ipcRenderer.invoke("policy:get", policyId);
  }

  async policyUpdate(policyId: string, updates: Partial<ContentPolicy>): Promise<{
    success: boolean;
    policy: ContentPolicy;
  }> {
    return this.ipcRenderer.invoke("policy:update", policyId, updates);
  }

  async policyDelete(policyId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("policy:delete", policyId);
  }

  async policyScanDataset(datasetId: string): Promise<{
    success: boolean;
    totalItems: number;
    totalViolations: number;
    violations: PolicyViolation[];
  }> {
    return this.ipcRenderer.invoke("policy:scan-dataset", datasetId);
  }

  async policyListLicenses(): Promise<{ success: boolean; licenses: License[] }> {
    return this.ipcRenderer.invoke("policy:list-licenses");
  }

  async policyGetLicense(licenseId: string): Promise<{ success: boolean; license: License }> {
    return this.ipcRenderer.invoke("policy:get-license", licenseId);
  }

  async policyValidateLicenseCompatibility(args: {
    sourceLicenses: string[];
    targetLicense: string;
    useCase: "commercial" | "academic" | "personal";
  }): Promise<{
    success: boolean;
    compatible: boolean;
    issues: string[];
    warnings: string[];
  }> {
    return this.ipcRenderer.invoke("policy:validate-license-compatibility", args);
  }

  async policyListPrivacyRules(): Promise<{ success: boolean; rules: PrivacyRule[] }> {
    return this.ipcRenderer.invoke("policy:list-privacy-rules");
  }

  async policyScanPii(text: string): Promise<{
    success: boolean;
    hasPII: boolean;
    findings: Array<{
      ruleId: string;
      ruleName: string;
      match: string;
      startIndex: number;
      endIndex: number;
      categories: string[];
    }>;
  }> {
    return this.ipcRenderer.invoke("policy:scan-pii", text);
  }

  async policyRedactPii(text: string): Promise<{
    success: boolean;
    originalText: string;
    redactedText: string;
    redactionCount: number;
  }> {
    return this.ipcRenderer.invoke("policy:redact-pii", text);
  }

  async policyScanDatasetPii(datasetId: string): Promise<{
    success: boolean;
    totalItems: number;
    itemsWithPII: number;
    items: Array<{
      itemId: string;
      findingsCount: number;
      categories: string[];
    }>;
  }> {
    return this.ipcRenderer.invoke("policy:scan-dataset-pii", datasetId);
  }

  async policyListViolations(args?: {
    datasetId?: string;
    policyId?: string;
    resolved?: boolean;
  }): Promise<{ success: boolean; violations: PolicyViolation[] }> {
    return this.ipcRenderer.invoke("policy:list-violations", args);
  }

  async policyResolveViolation(violationId: string, resolution: string): Promise<{
    success: boolean;
    violation: PolicyViolation;
  }> {
    return this.ipcRenderer.invoke("policy:resolve-violation", violationId, resolution);
  }

  // ==========================================================================
  // Full-Text Search Operations
  // ==========================================================================

  async searchIndexItem(itemId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("search:index-item", itemId);
  }

  async searchIndexDataset(datasetId: string): Promise<{
    success: boolean;
    total: number;
    indexed: number;
    failed: number;
  }> {
    return this.ipcRenderer.invoke("search:index-dataset", datasetId);
  }

  async searchQuery(query: SearchQuery): Promise<{
    success: boolean;
    results: SearchResult[];
    total: number;
    executionTimeMs: number;
    queryId: string;
  }> {
    return this.ipcRenderer.invoke("search:query", query);
  }

  async searchSuggestions(prefix: string): Promise<{
    success: boolean;
    suggestions: SearchSuggestion[];
  }> {
    return this.ipcRenderer.invoke("search:suggestions", prefix);
  }

  async searchFuzzy(args: {
    query: string;
    maxDistance?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    results: Array<{
      itemId: string;
      datasetId: string;
      snippet: string;
      rank: number;
    }>;
    total: number;
    correctedTerms: string[];
  }> {
    return this.ipcRenderer.invoke("search:fuzzy", args);
  }

  async searchSave(args: { name: string; query: SearchQuery }): Promise<{
    success: boolean;
    search: SavedSearch;
  }> {
    return this.ipcRenderer.invoke("search:save", args);
  }

  async searchListSaved(): Promise<{ success: boolean; searches: SavedSearch[] }> {
    return this.ipcRenderer.invoke("search:list-saved");
  }

  async searchDeleteSaved(searchId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("search:delete-saved", searchId);
  }

  async searchGetFacets(query?: string): Promise<{
    success: boolean;
    facets: {
      modality: Array<{ value: string; count: number }>;
      split: Array<{ value: string; count: number }>;
      dataset: Array<{ value: string; count: number; name: string }>;
    };
  }> {
    return this.ipcRenderer.invoke("search:get-facets", query);
  }

  async searchGetIndexStats(): Promise<{
    success: boolean;
    stats: {
      totalItems: number;
      byDataset: Array<{ dataset_id: string; count: number }>;
      byModality: Array<{ modality: string; count: number }>;
      uniqueTerms: number;
    };
  }> {
    return this.ipcRenderer.invoke("search:get-index-stats");
  }

  async searchRebuildIndex(): Promise<{
    success: boolean;
    totalIndexed: number;
    totalFailed: number;
  }> {
    return this.ipcRenderer.invoke("search:rebuild-index");
  }

  async searchGetAnalytics(args?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<{
    success: boolean;
    analytics: {
      totalSearches: number;
      avgResultCount: number;
      avgExecutionTime: number;
      popularQueries: Array<{ query: string; count: number }>;
      zeroResultQueries: string[];
    };
  }> {
    return this.ipcRenderer.invoke("search:get-analytics", args);
  }

  async searchRecordClick(args: { queryId: string; itemId: string }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("search:record-click", args);
  }

  // ==========================================================================
  // Event Listeners
  // ==========================================================================

  onImportProgress(callback: (progress: {
    current: number;
    total: number;
    currentFile: string;
  }) => void): () => void {
    const handler = (_event: any, progress: any) => callback(progress);
    this.ipcRenderer.on("data-studio:import-progress", handler);
    return () => this.ipcRenderer.removeListener("data-studio:import-progress", handler);
  }

  onIndexProgress(callback: (progress: {
    current: number;
    total: number;
    indexed: number;
    failed: number;
  }) => void): () => void {
    const handler = (_event: any, progress: any) => callback(progress);
    this.ipcRenderer.on("search:index-progress", handler);
    return () => this.ipcRenderer.removeListener("search:index-progress", handler);
  }

  onQualityProgress(callback: (progress: {
    current: number;
    total: number;
    succeeded: number;
    failed: number;
  }) => void): () => void {
    const handler = (_event: any, progress: any) => callback(progress);
    this.ipcRenderer.on("quality:batch-progress", handler);
    return () => this.ipcRenderer.removeListener("quality:batch-progress", handler);
  }

  onPolicyScanProgress(callback: (progress: {
    current: number;
    total: number;
    violations: number;
  }) => void): () => void {
    const handler = (_event: any, progress: any) => callback(progress);
    this.ipcRenderer.on("policy:scan-progress", handler);
    return () => this.ipcRenderer.removeListener("policy:scan-progress", handler);
  }

  // ==========================================================================
  // Data Generation Operations
  // ==========================================================================

  async generationListTemplates(): Promise<{
    success: boolean;
    templates: Array<{
      id: string;
      name: string;
      description: string;
      type: string;
      isBuiltin: boolean;
    }>;
  }> {
    return this.ipcRenderer.invoke("generation:list-templates");
  }

  async generationGetTemplate(templateId: string): Promise<{
    success: boolean;
    template: any;
  }> {
    return this.ipcRenderer.invoke("generation:get-template", templateId);
  }

  async generationSaveTemplate(template: {
    name: string;
    description: string;
    type: string;
    systemPrompt: string;
    userPromptTemplate: string;
    outputSchema?: Record<string, any>;
    defaultParams?: Record<string, any>;
  }): Promise<{ success: boolean; templateId: string }> {
    return this.ipcRenderer.invoke("generation:save-template", template);
  }

  async generationDeleteTemplate(templateId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("generation:delete-template", templateId);
  }

  async generationGenerateSingle(args: {
    templateId: string;
    variables?: Record<string, any>;
    modelConfig?: {
      provider?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    };
  }): Promise<{ success: boolean; data: any; raw: string }> {
    return this.ipcRenderer.invoke("generation:generate-single", args);
  }

  async generationStartBatch(args: {
    datasetId: string;
    templateId: string;
    count: number;
    variableSets?: Array<Record<string, any>>;
    modelConfig?: {
      provider?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    };
    batchConfig?: {
      parallelism?: number;
      retryCount?: number;
      saveInterval?: number;
    };
  }): Promise<{ success: boolean; jobId: string }> {
    return this.ipcRenderer.invoke("generation:start-batch", args);
  }

  async generationGetJobStatus(jobId: string): Promise<{
    success: boolean;
    job: {
      id: string;
      status: string;
      progress: {
        total: number;
        completed: number;
        failed: number;
      };
      errors: any[];
    };
  }> {
    return this.ipcRenderer.invoke("generation:get-job-status", jobId);
  }

  async generationCancelJob(jobId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("generation:cancel-job", jobId);
  }

  async generationListJobs(args?: {
    status?: string;
    datasetId?: string;
  }): Promise<{ success: boolean; jobs: any[] }> {
    return this.ipcRenderer.invoke("generation:list-jobs", args);
  }

  async generationAugmentItem(args: {
    itemId: string;
    augmentationType: "paraphrase" | "expand" | "summarize" | "noise" | "backtranslate";
    config?: {
      preserveFormat?: boolean;
      targetLength?: number;
      noiseLevel?: number;
      targetLanguage?: string;
    };
    modelConfig?: {
      provider?: string;
      model?: string;
    };
  }): Promise<{ success: boolean; original: any; augmented: any }> {
    return this.ipcRenderer.invoke("generation:augment-item", args);
  }

  async generationAugmentDataset(args: {
    datasetId: string;
    augmentationType: "paraphrase" | "expand" | "summarize" | "noise" | "backtranslate";
    multiplier?: number;
    config?: Record<string, any>;
    modelConfig?: {
      provider?: string;
      model?: string;
    };
  }): Promise<{
    success: boolean;
    jobId: string;
  }> {
    return this.ipcRenderer.invoke("generation:augment-dataset", args);
  }

  async generationCreateHybrid(args: {
    name: string;
    description?: string;
    sources: Array<{
      datasetId: string;
      ratio: number;
      filters?: Record<string, any>;
    }>;
    shuffleSeed?: number;
    maxItems?: number;
  }): Promise<{
    success: boolean;
    datasetId: string;
    totalItems: number;
    sourceBreakdown: Record<string, number>;
  }> {
    return this.ipcRenderer.invoke("generation:create-hybrid", args);
  }

  async generationGenerateVariables(args: {
    schema: Array<{
      name: string;
      type: "string" | "number" | "boolean" | "enum";
      values?: any[];
      min?: number;
      max?: number;
      format?: string;
    }>;
    strategy: "cartesian" | "random" | "latin_hypercube";
    count?: number;
  }): Promise<{
    success: boolean;
    variableSets: Array<Record<string, any>>;
    count: number;
  }> {
    return this.ipcRenderer.invoke("generation:generate-variables", args);
  }

  // ==========================================================================
  // Data Scraping Operations
  // ==========================================================================

  async scrapingScrapeUrl(args: {
    url: string;
    config?: {
      selectors?: Record<string, string>;
      output?: {
        format?: "text" | "html" | "json" | "markdown";
        extractImages?: boolean;
        extractLinks?: boolean;
      };
    };
  }): Promise<{
    success: boolean;
    data: {
      url: string;
      content: string;
      title?: string;
      images?: string[];
      links?: string[];
      metadata?: Record<string, any>;
    };
  }> {
    return this.ipcRenderer.invoke("scraping:scrape-url", args);
  }

  async scrapingScrapeToDataset(args: {
    datasetId: string;
    url: string;
    config?: Record<string, any>;
  }): Promise<{ success: boolean; itemId: string; hash: string }> {
    return this.ipcRenderer.invoke("scraping:scrape-to-dataset", args);
  }

  async scrapingCreateJob(args: {
    name: string;
    datasetId: string;
    config: {
      type: "web" | "api" | "rss" | "sitemap" | "document";
      urls: string[];
      selectors?: Record<string, string>;
      crawl?: {
        enabled: boolean;
        maxDepth?: number;
        maxPages?: number;
      };
      rateLimit?: {
        requestsPerSecond?: number;
        delayBetweenRequests?: number;
      };
      output?: {
        format: string;
        includeMetadata?: boolean;
      };
    };
  }): Promise<{ success: boolean; jobId: string }> {
    return this.ipcRenderer.invoke("scraping:create-job", args);
  }

  async scrapingStartJob(jobId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("scraping:start-job", jobId);
  }

  async scrapingPauseJob(jobId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("scraping:pause-job", jobId);
  }

  async scrapingCancelJob(jobId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("scraping:cancel-job", jobId);
  }

  async scrapingGetJob(jobId: string): Promise<{
    success: boolean;
    job: {
      id: string;
      name: string;
      status: string;
      progress: {
        total: number;
        completed: number;
        failed: number;
      };
      errors: any[];
    };
  }> {
    return this.ipcRenderer.invoke("scraping:get-job", jobId);
  }

  async scrapingListJobs(args?: {
    datasetId?: string;
    status?: string;
  }): Promise<{ success: boolean; jobs: any[] }> {
    return this.ipcRenderer.invoke("scraping:list-jobs", args);
  }

  async scrapingParseSitemap(sitemapUrl: string): Promise<{
    success: boolean;
    urls: Array<{ loc: string; lastmod?: string }>;
    count: number;
  }> {
    return this.ipcRenderer.invoke("scraping:parse-sitemap", sitemapUrl);
  }

  async scrapingParseFeed(feedUrl: string): Promise<{
    success: boolean;
    items: Array<{
      title: string;
      link: string;
      description?: string;
      pubDate?: string;
    }>;
    count: number;
  }> {
    return this.ipcRenderer.invoke("scraping:parse-feed", feedUrl);
  }

  async scrapingScrapeFeedToDataset(args: {
    datasetId: string;
    feedUrl: string;
    scrapeFullContent?: boolean;
    config?: Record<string, any>;
  }): Promise<{ success: boolean; added: number; failed: number; total: number }> {
    return this.ipcRenderer.invoke("scraping:scrape-feed-to-dataset", args);
  }

  async scrapingScrapeApi(args: {
    datasetId: string;
    config: {
      type: "api";
      urls: string[];
      api: {
        method?: "GET" | "POST";
        headers?: Record<string, string>;
        pagination?: {
          type: "page" | "offset" | "cursor";
          param: string;
          startValue: number | string;
          maxPages?: number;
        };
        dataPath?: string;
      };
      rateLimit?: {
        delayBetweenRequests?: number;
      };
    };
  }): Promise<{
    success: boolean;
    totalItems: number;
    stored: number;
    pages: number;
  }> {
    return this.ipcRenderer.invoke("scraping:scrape-api", args);
  }

  async scrapingCheckRobots(url: string): Promise<{
    success: boolean;
    allowed: boolean;
    rules: Record<string, string[]>;
  }> {
    return this.ipcRenderer.invoke("scraping:check-robots", url);
  }

  async scrapingExtractUrls(args: {
    url: string;
    pattern?: string;
    maxUrls?: number;
  }): Promise<{ success: boolean; urls: string[]; total: number }> {
    return this.ipcRenderer.invoke("scraping:extract-urls", args);
  }

  // ==========================================================================
  // Data Transformation Operations
  // ==========================================================================

  async transformExportDataset(args: {
    datasetId: string;
    config: {
      format: "jsonl" | "json" | "csv" | "huggingface" | "alpaca" | "sharegpt" | "openai" | "llama" | "image-classification" | "text-plain" | "custom";
      outputDir: string;
      splitRatios?: { train: number; val: number; test: number };
      shuffleSeed?: number;
      template?: string;
      jsonlOptions?: {
        includeMetadata?: boolean;
        flattenFields?: boolean;
      };
      huggingfaceOptions?: {
        datasetName?: string;
        generateCard?: boolean;
      };
    };
  }): Promise<{
    success: boolean;
    result: {
      outputDir: string;
      files: Array<{
        path: string;
        format: string;
        itemCount: number;
        sizeBytes: number;
      }>;
      totalItems: number;
      splits?: { train: number; val: number; test: number };
    };
  }> {
    return this.ipcRenderer.invoke("transform:export-dataset", args);
  }

  async transformListTemplates(): Promise<{
    success: boolean;
    templates: Array<{
      id: string;
      name: string;
      description: string;
    }>;
  }> {
    return this.ipcRenderer.invoke("transform:list-templates");
  }

  async transformCreateStructure(args: {
    templateId: string;
    outputDir: string;
    datasetId?: string;
  }): Promise<{ success: boolean; outputDir: string; template: string }> {
    return this.ipcRenderer.invoke("transform:create-structure", args);
  }

  async transformConvertFormat(args: {
    inputPath: string;
    inputFormat: string;
    outputPath: string;
    outputFormat: string;
    options?: Record<string, any>;
  }): Promise<{ success: boolean; itemCount: number; outputPath: string }> {
    return this.ipcRenderer.invoke("transform:convert-format", args);
  }

  async transformTokenize(args: {
    text: string;
    method?: "whitespace" | "word" | "character";
    options?: {
      lowercase?: boolean;
      removePunctuation?: boolean;
    };
  }): Promise<{ success: boolean; tokens: string[]; count: number }> {
    return this.ipcRenderer.invoke("transform:tokenize", args);
  }

  async transformBuildVocab(args: {
    datasetId: string;
    field?: string;
    minFreq?: number;
    maxVocab?: number;
  }): Promise<{
    success: boolean;
    vocabSize: number;
    token2id: Record<string, number>;
    id2token: Record<number, string>;
    frequencies: Record<string, number>;
  }> {
    return this.ipcRenderer.invoke("transform:build-vocab", args);
  }

  async transformPrepareTraining(args: {
    datasetId: string;
    outputDir: string;
    framework: "huggingface" | "pytorch" | "tensorflow" | "llama" | "lora";
    options?: {
      maxSeqLength?: number;
      batchSize?: number;
      format?: string;
    };
  }): Promise<{
    success: boolean;
    outputDir: string;
    framework: string;
  }> {
    return this.ipcRenderer.invoke("transform:prepare-training", args);
  }

  async transformGetStats(datasetId: string): Promise<{
    success: boolean;
    stats: {
      itemCount: number;
      totalCharacters: number;
      totalTokens: number;
      avgTokensPerItem: number;
      medianTokens: number;
      minTokens: number;
      maxTokens: number;
      modalities: string[];
      splits: Record<string, number>;
    };
  }> {
    return this.ipcRenderer.invoke("transform:get-stats", datasetId);
  }

  // ==========================================================================
  // Event Listeners for Scraping/Generation
  // ==========================================================================

  onScrapingJobProgress(callback: (progress: {
    jobId: string;
    progress: { total: number; completed: number; failed: number };
    status: string;
  }) => void): () => void {
    const handler = (_event: any, progress: any) => callback(progress);
    this.ipcRenderer.on("scraping:job-progress", handler);
    return () => this.ipcRenderer.removeListener("scraping:job-progress", handler);
  }

  onScrapingJobCompleted(callback: (data: {
    jobId: string;
    progress: { total: number; completed: number; failed: number };
  }) => void): () => void {
    const handler = (_event: any, data: any) => callback(data);
    this.ipcRenderer.on("scraping:job-completed", handler);
    return () => this.ipcRenderer.removeListener("scraping:job-completed", handler);
  }

  onGenerationJobProgress(callback: (progress: {
    jobId: string;
    progress: { total: number; completed: number; failed: number };
  }) => void): () => void {
    const handler = (_event: any, progress: any) => callback(progress);
    this.ipcRenderer.on("generation:job-progress", handler);
    return () => this.ipcRenderer.removeListener("generation:job-progress", handler);
  }

  // ==========================================================================
  // Annotation System (Phase 3)
  // ==========================================================================

  async createTaxonomy(args: {
    name: string;
    description?: string;
    type: string;
    datasetId?: string;
    labels: Array<{
      name: string;
      description?: string;
      color?: string;
      shortcut?: string;
      parentId?: string;
      attributes?: Record<string, any>;
    }>;
  }): Promise<{ success: boolean; taxonomy: any }> {
    return this.ipcRenderer.invoke("annotation:create-taxonomy", args);
  }

  async getTaxonomy(taxonomyId: string): Promise<{ success: boolean; taxonomy: any }> {
    return this.ipcRenderer.invoke("annotation:get-taxonomy", taxonomyId);
  }

  async listTaxonomies(args?: { datasetId?: string; type?: string }): Promise<{ success: boolean; taxonomies: any[] }> {
    return this.ipcRenderer.invoke("annotation:list-taxonomies", args);
  }

  async createAnnotationTask(args: {
    name: string;
    datasetId: string;
    taxonomyIds: string[];
    type: string;
    itemIds?: string[];
    assignees?: string[];
    dueDate?: string;
    instructions?: string;
    qualityThreshold?: number;
    requireConsensus?: boolean;
    minAnnotatorsPerItem?: number;
  }): Promise<{ success: boolean; task: any }> {
    return this.ipcRenderer.invoke("annotation:create-task", args);
  }

  async getAnnotationTask(taskId: string): Promise<{ success: boolean; task: any }> {
    return this.ipcRenderer.invoke("annotation:get-task", taskId);
  }

  async submitAnnotation(args: {
    taskId: string;
    itemId: string;
    annotatorId: string;
    annotations: Array<{
      labelId: string;
      value?: any;
      bbox?: number[];
      polygon?: number[][];
      mask?: string;
      start?: number;
      end?: number;
      confidence?: number;
      metadata?: Record<string, any>;
    }>;
    timeSpent?: number;
    notes?: string;
  }): Promise<{ success: boolean; annotation: any }> {
    return this.ipcRenderer.invoke("annotation:submit", args);
  }

  async getItemAnnotations(args: {
    taskId: string;
    itemId: string;
  }): Promise<{ success: boolean; annotations: any[]; consensus?: any }> {
    return this.ipcRenderer.invoke("annotation:get-item-annotations", args);
  }

  async calculateTaskAgreement(taskId: string): Promise<{
    success: boolean;
    metrics: {
      cohensKappa: number;
      fleissKappa: number;
      percentAgreement: number;
    };
    byLabel: Record<string, number>;
  }> {
    return this.ipcRenderer.invoke("annotation:calculate-agreement", taskId);
  }

  async exportAnnotations(args: {
    taskId: string;
    format: string;
    outputPath: string;
    includeImages?: boolean;
  }): Promise<{ success: boolean; outputPath: string }> {
    return this.ipcRenderer.invoke("annotation:export", args);
  }

  async importAnnotations(args: {
    taskId: string;
    format: string;
    filePath: string;
    mappings?: Record<string, string>;
  }): Promise<{ success: boolean; imported: number; failed: number }> {
    return this.ipcRenderer.invoke("annotation:import", args);
  }

  // ==========================================================================
  // Version Control (Phase 3)
  // ==========================================================================

  async vcInitialize(datasetId: string): Promise<{ success: boolean; commitId: string }> {
    return this.ipcRenderer.invoke("version-control:initialize", datasetId);
  }

  async vcCommit(args: {
    datasetId: string;
    message: string;
    author?: string;
  }): Promise<{ success: boolean; commit: any }> {
    return this.ipcRenderer.invoke("version-control:commit", args);
  }

  async vcGetHistory(args: {
    datasetId: string;
    branch?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ success: boolean; commits: any[]; total: number }> {
    return this.ipcRenderer.invoke("version-control:get-history", args);
  }

  async vcCreateBranch(args: {
    datasetId: string;
    branchName: string;
    fromCommit?: string;
  }): Promise<{ success: boolean; branch: any }> {
    return this.ipcRenderer.invoke("version-control:create-branch", args);
  }

  async vcSwitchBranch(args: {
    datasetId: string;
    branchName: string;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("version-control:switch-branch", args);
  }

  async vcMerge(args: {
    datasetId: string;
    sourceBranch: string;
    targetBranch?: string;
    conflictStrategy?: string;
    message?: string;
  }): Promise<{ success: boolean; commit: any; conflicts?: any[] }> {
    return this.ipcRenderer.invoke("version-control:merge", args);
  }

  async vcGetDiff(args: {
    datasetId: string;
    fromCommit?: string;
    toCommit?: string;
  }): Promise<{ success: boolean; diff: any }> {
    return this.ipcRenderer.invoke("version-control:get-diff", args);
  }

  async vcRollback(args: {
    datasetId: string;
    targetCommit: string;
    createBranch?: boolean;
    branchName?: string;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("version-control:rollback", args);
  }

  async vcCreateTag(args: {
    datasetId: string;
    tagName: string;
    commitId?: string;
    message?: string;
  }): Promise<{ success: boolean; tag: any }> {
    return this.ipcRenderer.invoke("version-control:create-tag", args);
  }

  async vcGetTimeline(args: {
    datasetId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ success: boolean; timeline: any[] }> {
    return this.ipcRenderer.invoke("version-control:get-timeline", args);
  }

  // ==========================================================================
  // Data Lineage (Phase 3)
  // ==========================================================================

  async lineageAddNode(args: {
    id: string;
    type: string;
    name: string;
    datasetId?: string;
    itemId?: string;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; node: any }> {
    return this.ipcRenderer.invoke("lineage:add-node", args);
  }

  async lineageAddEdge(args: {
    sourceId: string;
    targetId: string;
    type: string;
    transformationType?: string;
    parameters?: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; edge: any }> {
    return this.ipcRenderer.invoke("lineage:add-edge", args);
  }

  async lineageRecordTransformation(args: {
    sourceIds: string[];
    targetIds: string[];
    transformationType: string;
    parameters?: Record<string, any>;
    description?: string;
  }): Promise<{ success: boolean; edges: any[] }> {
    return this.ipcRenderer.invoke("lineage:record-transformation", args);
  }

  async lineageGetUpstream(args: {
    nodeId: string;
    depth?: number;
  }): Promise<{ success: boolean; nodes: any[]; edges: any[] }> {
    return this.ipcRenderer.invoke("lineage:get-upstream", args);
  }

  async lineageGetDownstream(args: {
    nodeId: string;
    depth?: number;
  }): Promise<{ success: boolean; nodes: any[]; edges: any[] }> {
    return this.ipcRenderer.invoke("lineage:get-downstream", args);
  }

  async lineageAnalyzeImpact(nodeId: string): Promise<{
    success: boolean;
    directlyAffected: any[];
    transitivelyAffected: any[];
    totalAffected: number;
    byType: Record<string, number>;
  }> {
    return this.ipcRenderer.invoke("lineage:analyze-impact", nodeId);
  }

  async lineageGetAuditTrail(nodeId: string): Promise<{
    success: boolean;
    trail: Array<{
      timestamp: Date;
      action: string;
      actorId?: string;
      details: string;
      nodeId: string;
    }>;
  }> {
    return this.ipcRenderer.invoke("lineage:get-audit-trail", nodeId);
  }

  async lineageExport(args: {
    nodeIds?: string[];
    format?: string;
  }): Promise<{ success: boolean; data: string }> {
    return this.ipcRenderer.invoke("lineage:export", args);
  }

  // ==========================================================================
  // Pipeline Automation (Phase 4)
  // ==========================================================================

  async pipelineCreate(args: {
    name: string;
    description?: string;
    datasetId?: string;
    steps: Array<{
      name: string;
      type: string;
      config: Record<string, any>;
      dependsOn?: string[];
    }>;
    triggers?: Array<{
      type: string;
      config: Record<string, any>;
    }>;
    retryPolicy?: {
      maxAttempts: number;
      backoffMs: number;
      backoffMultiplier: number;
    };
    schedule?: string;
  }): Promise<{ success: boolean; pipeline: any }> {
    return this.ipcRenderer.invoke("pipeline:create", args);
  }

  async pipelineUpdate(args: {
    pipelineId: string;
    updates: Record<string, any>;
  }): Promise<{ success: boolean; pipeline: any }> {
    return this.ipcRenderer.invoke("pipeline:update", args);
  }

  async pipelineDelete(pipelineId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("pipeline:delete", pipelineId);
  }

  async pipelineList(args?: {
    datasetId?: string;
    status?: string;
  }): Promise<{ success: boolean; pipelines: any[] }> {
    return this.ipcRenderer.invoke("pipeline:list", args);
  }

  async pipelineRun(args: {
    pipelineId: string;
    params?: Record<string, any>;
    async?: boolean;
  }): Promise<{ success: boolean; runId: string; status: string }> {
    return this.ipcRenderer.invoke("pipeline:run", args);
  }

  async pipelineGetRunStatus(runId: string): Promise<{
    success: boolean;
    status: string;
    progress: { completed: number; total: number; failed: number };
    stepStatuses: Array<{ stepId: string; status: string; error?: string }>;
    startedAt?: Date;
    completedAt?: Date;
  }> {
    return this.ipcRenderer.invoke("pipeline:get-run-status", runId);
  }

  async pipelineCancelRun(runId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("pipeline:cancel-run", runId);
  }

  async pipelineGetRunHistory(args: {
    pipelineId: string;
    limit?: number;
    offset?: number;
  }): Promise<{ success: boolean; runs: any[]; total: number }> {
    return this.ipcRenderer.invoke("pipeline:get-run-history", args);
  }

  async pipelineListTemplates(): Promise<{ success: boolean; templates: any[] }> {
    return this.ipcRenderer.invoke("pipeline:list-templates");
  }

  async pipelineCreateFromTemplate(args: {
    templateId: string;
    name: string;
    datasetId?: string;
    customizations?: Record<string, any>;
  }): Promise<{ success: boolean; pipeline: any }> {
    return this.ipcRenderer.invoke("pipeline:create-from-template", args);
  }

  // ==========================================================================
  // Analytics & Reporting (Phase 4)
  // ==========================================================================

  async analyticsGetDatasetStats(args: {
    datasetId: string;
    categories?: string[];
  }): Promise<{ success: boolean; stats: any }> {
    return this.ipcRenderer.invoke("analytics:dataset-stats", args);
  }

  async analyticsGetGlobalStats(categories?: string[]): Promise<{ success: boolean; stats: any }> {
    return this.ipcRenderer.invoke("analytics:global-stats", categories);
  }

  async analyticsGetTimeSeries(args: {
    datasetId?: string;
    metric: string;
    startDate?: string;
    endDate?: string;
    interval?: string;
  }): Promise<{ success: boolean; data: Array<{ date: string; value: number }> }> {
    return this.ipcRenderer.invoke("analytics:time-series", args);
  }

  async analyticsCompareDatasets(args: {
    datasetIds: string[];
    metrics: string[];
  }): Promise<{ success: boolean; comparison: any }> {
    return this.ipcRenderer.invoke("analytics:compare-datasets", args);
  }

  async reportGenerate(args: {
    type: string;
    datasetId?: string;
    format?: string;
    options?: Record<string, any>;
  }): Promise<{ success: boolean; reportId: string; content?: string }> {
    return this.ipcRenderer.invoke("report:generate", args);
  }

  async reportExport(args: {
    reportId: string;
    outputPath: string;
    format?: string;
  }): Promise<{ success: boolean; outputPath: string }> {
    return this.ipcRenderer.invoke("report:export", args);
  }

  async reportGetHistory(args?: {
    datasetId?: string;
    type?: string;
    limit?: number;
  }): Promise<{ success: boolean; reports: any[] }> {
    return this.ipcRenderer.invoke("report:get-history", args);
  }

  async dashboardCreate(args: {
    name: string;
    description?: string;
    widgets: Array<{
      type: string;
      title: string;
      config: Record<string, any>;
      position: { x: number; y: number; w: number; h: number };
    }>;
    isDefault?: boolean;
  }): Promise<{ success: boolean; dashboard: any }> {
    return this.ipcRenderer.invoke("dashboard:create", args);
  }

  async dashboardUpdate(args: {
    dashboardId: string;
    updates: Record<string, any>;
  }): Promise<{ success: boolean; dashboard: any }> {
    return this.ipcRenderer.invoke("dashboard:update", args);
  }

  async dashboardList(): Promise<{ success: boolean; dashboards: any[] }> {
    return this.ipcRenderer.invoke("dashboard:list");
  }

  async dashboardGetData(dashboardId: string): Promise<{
    success: boolean;
    dashboard: any;
    widgetData: Record<string, any>;
  }> {
    return this.ipcRenderer.invoke("dashboard:get-data", dashboardId);
  }

  // ==========================================================================
  // Schema Validation (Phase 4)
  // ==========================================================================

  async schemaCreate(args: {
    name: string;
    description?: string;
    schema: Record<string, any>;
    customRules?: Array<{
      name: string;
      type: string;
      field?: string;
      config: Record<string, any>;
      severity: string;
      enabled: boolean;
    }>;
    datasetId?: string;
  }): Promise<{ success: boolean; schema: any }> {
    return this.ipcRenderer.invoke("schema:create", args);
  }

  async schemaCreateFromTemplate(args: {
    templateId: string;
    name: string;
    description?: string;
    datasetId?: string;
  }): Promise<{ success: boolean; schema: any }> {
    return this.ipcRenderer.invoke("schema:create-from-template", args);
  }

  async schemaList(args?: { datasetId?: string }): Promise<{ success: boolean; schemas: any[] }> {
    return this.ipcRenderer.invoke("schema:list", args);
  }

  async schemaGet(schemaId: string): Promise<{ success: boolean; schema: any }> {
    return this.ipcRenderer.invoke("schema:get", schemaId);
  }

  async schemaUpdate(args: {
    schemaId: string;
    updates: Record<string, any>;
    bumpVersion?: boolean;
  }): Promise<{ success: boolean; schema: any }> {
    return this.ipcRenderer.invoke("schema:update", args);
  }

  async schemaDelete(schemaId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("schema:delete", schemaId);
  }

  async schemaValidateItem(args: {
    schemaId: string;
    data: any;
  }): Promise<{ success: boolean; result: any }> {
    return this.ipcRenderer.invoke("schema:validate-item", args);
  }

  async schemaValidateDataset(args: {
    schemaId: string;
    datasetId: string;
    sampleSize?: number;
  }): Promise<{
    success: boolean;
    report: any;
    summary: {
      validationRate: number;
      avgErrorsPerItem: number;
      topErrors: Array<{ path: string; count: number }>;
    };
  }> {
    return this.ipcRenderer.invoke("schema:validate-dataset", args);
  }

  async schemaGetReport(reportId: string): Promise<{ success: boolean; report: any; results: any[] }> {
    return this.ipcRenderer.invoke("schema:get-report", reportId);
  }

  async schemaListReports(args?: {
    datasetId?: string;
    schemaId?: string;
    limit?: number;
  }): Promise<{ success: boolean; reports: any[] }> {
    return this.ipcRenderer.invoke("schema:list-reports", args);
  }

  async schemaInfer(args: {
    datasetId: string;
    sampleSize?: number;
  }): Promise<{ success: boolean; schema: any; samplesAnalyzed: number }> {
    return this.ipcRenderer.invoke("schema:infer", args);
  }

  async schemaListTemplates(category?: string): Promise<{ success: boolean; templates: any[] }> {
    return this.ipcRenderer.invoke("schema:list-templates", category);
  }

  async schemaGetCategories(): Promise<{ success: boolean; categories: string[] }> {
    return this.ipcRenderer.invoke("schema:get-categories");
  }

  async schemaAddRule(args: {
    schemaId: string;
    rule: {
      name: string;
      type: string;
      field?: string;
      config: Record<string, any>;
      severity: string;
      enabled: boolean;
    };
  }): Promise<{ success: boolean; rule: any }> {
    return this.ipcRenderer.invoke("schema:add-rule", args);
  }

  async schemaRemoveRule(args: {
    schemaId: string;
    ruleId: string;
  }): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("schema:remove-rule", args);
  }

  async schemaExport(args: {
    schemaId: string;
    outputPath: string;
    format?: string;
  }): Promise<{ success: boolean; outputPath: string }> {
    return this.ipcRenderer.invoke("schema:export", args);
  }

  async schemaImport(args: {
    filePath: string;
    name: string;
    datasetId?: string;
  }): Promise<{ success: boolean; schema: any }> {
    return this.ipcRenderer.invoke("schema:import", args);
  }

  // ==========================================================================
  // Event Listeners for Pipeline Runs
  // ==========================================================================

  onPipelineProgress(callback: (progress: {
    runId: string;
    stepId?: string;
    status: string;
    progress: { completed: number; total: number; failed: number };
  }) => void): () => void {
    const handler = (_event: any, progress: any) => callback(progress);
    this.ipcRenderer.on("pipeline:progress", handler);
    return () => this.ipcRenderer.removeListener("pipeline:progress", handler);
  }

  onPipelineCompleted(callback: (data: {
    runId: string;
    pipelineId: string;
    status: string;
    duration: number;
  }) => void): () => void {
    const handler = (_event: any, data: any) => callback(data);
    this.ipcRenderer.on("pipeline:completed", handler);
    return () => this.ipcRenderer.removeListener("pipeline:completed", handler);
  }
}

// Singleton instance
let instance: DataStudioExtendedClient | null = null;

export function getDataStudioExtendedClient(): DataStudioExtendedClient {
  if (!instance) {
    instance = new DataStudioExtendedClient();
  }
  return instance;
}

export const dataStudioExtendedClient = {
  getInstance: getDataStudioExtendedClient,
};
