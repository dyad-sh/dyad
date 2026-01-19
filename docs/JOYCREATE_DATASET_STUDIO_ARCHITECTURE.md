# JOY Create - Dataset Creation Studio Architecture

**Version:** 1.0.0  
**Date:** January 19, 2026  
**Status:** Implementation Ready

---

## Overview

> **Integration Note:** This document describes enhancements to the existing JoyCreate application, not a separate system. All features integrate with the current Electron + React architecture, existing database schema (`src/db/schema.ts`), IPC handlers (`src/ipc/handlers/`), and established patterns.

### Existing System Integration Points

| Existing Component | Dataset Studio Enhancement |
|-------------------|---------------------------|
| `src/db/schema.ts` | Add dataset_items, dataset_manifests, provenance tables |
| `src/ipc/handlers/asset_studio_handlers.ts` | Extend with dataset-specific operations |
| `src/pages/datasets.tsx` | Enhance with full Dataset Studio UI |
| `src/routes/datasets.ts` | Already exists - extend with sub-routes |
| `src/types/asset_types.ts` | Already has DatasetAsset - extend with provenance |
| `src/ipc/handlers/sovereign_data_handlers.ts` | Integrate P2P sync capabilities |
| `src/ipc/handlers/federation_handlers.ts` | Integrate marketplace publishing |
| `src/ipc/handlers/local_model_handlers.ts` | Use for local AI generation |

JOY Create's Dataset Studio is an offline-first, local AI-powered enhancement that enables creators to:

1. **Collect/Generate** multimodal data (text, image, audio, video, context packs)
2. **Clean/Label/Annotate** using local AI assistance
3. **Package** datasets with schema, licensing, provenance, and cryptographic proofs
4. **Sync** via P2P (local mesh/LAN/WAN) and federated protocols
5. **Publish** to JoyMarketplace.io when connectivity exists

### Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Offline-first** | All core creation and dataset assembly works with zero internet |
| **Local AI-first** | On-device models preferred; graceful degradation to API when permitted |
| **P2P-by-default** | Peers share datasets/metadata without central servers |
| **Federated sync** | Push validated artifacts to JoyMarketplace.io when online |
| **Provenance & integrity** | Everything hashed, signed, versioned, reproducible |
| **Privacy & safety** | Data minimization, local encryption, opt-in sharing |

---

## Architecture

### High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              JOY Create Desktop                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Electron + React UI                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │ Ingestion│ │  Studio  │ │ Dataset  │ │   Sync   │ │ Publish  │  │    │
│  │  │   View   │ │   View   │ │ Explorer │ │  Status  │ │  View    │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                     │                                        │
│                              IPC Bridge (Secure)                             │
│                                     │                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                              Core Services Layer                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │ Orchestrator│ │  AI Runtime │ │   Media     │ │   Dataset Engine    │   │
│  │  (Job Queue)│ │   Manager   │ │  Pipeline   │ │ (Schema/Manifest)   │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │    Vault    │ │    Index    │ │  Provenance │ │   Policy Engine     │   │
│  │ (Encrypted) │ │  (SQLite)   │ │   Tracker   │ │   (Safety/Rights)   │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│                              Storage Layer                                   │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │    Content-Addressed Store   │  │         Metadata Store (SQLite)     │  │
│  │  (Blobs by SHA-256 hash)    │  │   (FTS, indexes, relationships)     │  │
│  └─────────────────────────────┘  └─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────┤
│                              Network Layer                                   │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │         P2P Transport        │  │      Federation Connector           │  │
│  │  (libp2p / Hypercore-style) │  │    (JoyMarketplace.io Client)       │  │
│  │  - LAN Discovery (mDNS)     │  │    - Offline Queue                  │  │
│  │  - WAN Relay (optional)     │  │    - Upload/Download Manager        │  │
│  │  - Content Exchange         │  │    - Validation & Signing           │  │
│  └─────────────────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Boundaries & Responsibilities

#### 1. Desktop UI (Electron + React)

```typescript
// src/dataset-studio/ui/types.ts
interface UIModule {
  name: string;
  routes: Route[];
  components: ComponentRegistry;
  hooks: HookRegistry;
}

// Modules
const UI_MODULES = [
  'ingestion',      // Import/capture flows
  'studio',         // Label/annotate workspace
  'dataset',        // Dataset builder/explorer
  'sync',           // P2P and federation status
  'publish',        // Publishing workflow
  'settings',       // Preferences, keys, policies
] as const;
```

#### 2. Orchestrator (Job Queue)

```typescript
// src/dataset-studio/core/orchestrator/types.ts
interface Job {
  id: string;                    // UUID
  type: JobType;                 // 'ingest' | 'generate' | 'transform' | 'sync' | 'publish'
  priority: number;              // 0-100, higher = more urgent
  status: JobStatus;             // 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  progress: number;              // 0-100
  input: JobInput;               // Type-specific input
  output?: JobOutput;            // Type-specific output
  checkpoints: Checkpoint[];     // For resumability
  createdAt: string;             // ISO timestamp
  startedAt?: string;
  completedAt?: string;
  error?: JobError;
  retryCount: number;
  maxRetries: number;
}

interface Orchestrator {
  enqueue(job: Omit<Job, 'id' | 'status' | 'progress' | 'createdAt'>): Promise<string>;
  pause(jobId: string): Promise<void>;
  resume(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  getStatus(jobId: string): Promise<Job>;
  listJobs(filter?: JobFilter): Promise<Job[]>;
  onProgress(jobId: string, callback: (progress: number) => void): () => void;
}
```

#### 3. AI Runtime Manager

```typescript
// src/dataset-studio/core/ai-runtime/types.ts
interface ModelRegistry {
  listModels(): Promise<ModelInfo[]>;
  getModel(modelId: string): Promise<ModelInfo | null>;
  loadModel(modelId: string): Promise<LoadedModel>;
  unloadModel(modelId: string): Promise<void>;
  downloadModel(modelId: string, options?: DownloadOptions): Promise<void>;
}

interface ModelInfo {
  id: string;                    // e.g., 'llama-3.2-3b-q4'
  name: string;
  modality: 'text' | 'image' | 'audio' | 'embedding' | 'multimodal';
  capabilities: ModelCapability[];
  quantization?: string;         // e.g., 'Q4_K_M'
  sizeBytes: number;
  memoryRequired: number;
  isDownloaded: boolean;
  localPath?: string;
}

interface InferenceRunner {
  runText(model: LoadedModel, request: TextRequest): AsyncGenerator<TextChunk>;
  runImage(model: LoadedModel, request: ImageRequest): Promise<ImageResult>;
  runAudio(model: LoadedModel, request: AudioRequest): Promise<AudioResult>;
  runEmbedding(model: LoadedModel, request: EmbedRequest): Promise<number[]>;
}

// Provider interface for hybrid local/remote
interface Provider {
  id: string;
  name: string;
  type: 'local' | 'remote';
  isAvailable(): Promise<boolean>;
  
  generateText(request: TextGenerationRequest): AsyncGenerator<TextChunk>;
  generateImage(request: ImageGenerationRequest): Promise<ImageResult>;
  transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResult>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
```

#### 4. Media Pipeline

```typescript
// src/dataset-studio/core/media-pipeline/types.ts
interface MediaPipeline {
  // Image operations
  processImage(input: ImageInput, operations: ImageOperation[]): Promise<ImageOutput>;
  
  // Video operations
  processVideo(input: VideoInput, operations: VideoOperation[]): Promise<VideoOutput>;
  extractFrames(input: VideoInput, options: FrameExtractionOptions): AsyncGenerator<Frame>;
  detectScenes(input: VideoInput): Promise<Scene[]>;
  
  // Audio operations
  processAudio(input: AudioInput, operations: AudioOperation[]): Promise<AudioOutput>;
  transcribe(input: AudioInput, options?: TranscribeOptions): Promise<Transcript>;
  
  // Common
  getMediaInfo(path: string): Promise<MediaInfo>;
  convertFormat(input: string, output: string, format: MediaFormat): Promise<void>;
}

type ImageOperation = 
  | { type: 'resize'; width: number; height: number; mode: 'fit' | 'fill' | 'crop' }
  | { type: 'crop'; x: number; y: number; width: number; height: number }
  | { type: 'format'; format: 'png' | 'jpeg' | 'webp'; quality?: number }
  | { type: 'blur_faces'; threshold: number }
  | { type: 'strip_metadata' }
  | { type: 'upscale'; scale: number };

type VideoOperation =
  | { type: 'trim'; startMs: number; endMs: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'extract_audio' }
  | { type: 'add_captions'; captions: Caption[] }
  | { type: 'blur_faces'; threshold: number };
```

#### 5. Dataset Engine

```typescript
// src/dataset-studio/core/dataset-engine/types.ts
interface DatasetEngine {
  // Dataset CRUD
  createDataset(config: DatasetConfig): Promise<Dataset>;
  getDataset(datasetId: string): Promise<Dataset | null>;
  updateDataset(datasetId: string, updates: Partial<DatasetConfig>): Promise<Dataset>;
  deleteDataset(datasetId: string): Promise<void>;
  listDatasets(filter?: DatasetFilter): Promise<Dataset[]>;
  
  // Item management
  addItem(datasetId: string, item: DatasetItemInput): Promise<DatasetItem>;
  addItems(datasetId: string, items: DatasetItemInput[]): Promise<DatasetItem[]>;
  updateItem(datasetId: string, itemId: string, updates: Partial<DatasetItem>): Promise<DatasetItem>;
  removeItem(datasetId: string, itemId: string): Promise<void>;
  getItem(datasetId: string, itemId: string): Promise<DatasetItem | null>;
  listItems(datasetId: string, options?: ListOptions): AsyncGenerator<DatasetItem>;
  
  // Build & export
  buildManifest(datasetId: string): Promise<DatasetManifest>;
  createSplits(datasetId: string, config: SplitConfig): Promise<SplitInfo>;
  exportDataset(datasetId: string, format: ExportFormat, outputPath: string): Promise<void>;
  
  // Quality & validation
  computeStats(datasetId: string): Promise<DatasetStats>;
  validateDataset(datasetId: string): Promise<ValidationResult>;
  detectDuplicates(datasetId: string): Promise<DuplicateGroup[]>;
}
```

#### 6. Vault (Encrypted Storage)

```typescript
// src/dataset-studio/core/vault/types.ts
interface Vault {
  // Initialization
  initialize(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  lock(): Promise<void>;
  isUnlocked(): boolean;
  changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void>;
  
  // Identity & keys
  getIdentity(): Promise<Identity>;
  createIdentity(name: string): Promise<Identity>;
  signData(data: Uint8Array): Promise<Signature>;
  verifySignature(data: Uint8Array, signature: Signature, publicKey: Uint8Array): boolean;
  
  // Secrets
  storeSecret(key: string, value: Uint8Array): Promise<void>;
  getSecret(key: string): Promise<Uint8Array | null>;
  deleteSecret(key: string): Promise<void>;
  
  // Peer keys
  addTrustedPeer(peerId: string, publicKey: Uint8Array, name: string): Promise<void>;
  removeTrustedPeer(peerId: string): Promise<void>;
  getTrustedPeers(): Promise<TrustedPeer[]>;
}

interface Identity {
  id: string;                    // Derived from public key
  name: string;
  publicKey: Uint8Array;         // Ed25519 public key
  createdAt: string;
}
```

#### 7. Index (SQLite + FTS)

```typescript
// src/dataset-studio/core/index/types.ts
interface Index {
  // Full-text search
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  
  // Metadata queries
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  
  // Indexing
  indexItem(item: IndexableItem): Promise<void>;
  indexItems(items: IndexableItem[]): Promise<void>;
  removeFromIndex(itemId: string): Promise<void>;
  rebuildIndex(): Promise<void>;
  
  // Tags & categories
  getTags(): Promise<TagInfo[]>;
  getCategories(): Promise<CategoryInfo[]>;
  getItemsByTag(tag: string): Promise<string[]>;
}
```

#### 8. P2P Layer

```typescript
// src/dataset-studio/core/p2p/types.ts
interface P2PNode {
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): P2PStatus;
  
  // Discovery
  discoverPeers(): AsyncGenerator<PeerInfo>;
  connectToPeer(peerId: string, address?: string): Promise<PeerConnection>;
  disconnectPeer(peerId: string): Promise<void>;
  getConnectedPeers(): Promise<PeerInfo[]>;
  
  // Content exchange
  announceDataset(datasetId: string, manifest: DatasetManifest): Promise<void>;
  requestDataset(peerId: string, datasetId: string): Promise<SyncSession>;
  requestBlob(peerId: string, hash: string): Promise<Uint8Array>;
  
  // Replication
  syncWithPeer(peerId: string, datasetId: string): Promise<SyncResult>;
  
  // Events
  on(event: 'peer:discovered', handler: (peer: PeerInfo) => void): void;
  on(event: 'peer:connected', handler: (peer: PeerInfo) => void): void;
  on(event: 'peer:disconnected', handler: (peerId: string) => void): void;
  on(event: 'dataset:announced', handler: (announcement: DatasetAnnouncement) => void): void;
}

interface ContentAddressedStore {
  put(data: Uint8Array): Promise<string>;        // Returns SHA-256 hash
  get(hash: string): Promise<Uint8Array | null>;
  has(hash: string): Promise<boolean>;
  delete(hash: string): Promise<void>;
  list(): AsyncGenerator<string>;
  
  // Pinning
  pin(hash: string): Promise<void>;
  unpin(hash: string): Promise<void>;
  isPinned(hash: string): Promise<boolean>;
  getPinnedHashes(): Promise<string[]>;
}
```

#### 9. Federation Connector

```typescript
// src/dataset-studio/core/federation/types.ts
interface FederationConnector {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Auth
  authenticate(credentials: AuthCredentials): Promise<AuthToken>;
  refreshToken(): Promise<AuthToken>;
  
  // Dataset operations
  publishDataset(dataset: PublishableDataset): Promise<PublishResult>;
  updateDataset(datasetId: string, updates: DatasetUpdate): Promise<void>;
  unpublishDataset(datasetId: string): Promise<void>;
  
  // Sync
  syncManifest(datasetId: string): Promise<ManifestSyncResult>;
  uploadBlob(hash: string, data: Uint8Array): Promise<void>;
  downloadBlob(hash: string): Promise<Uint8Array>;
  
  // Queue (offline support)
  queueOperation(operation: QueuedOperation): Promise<void>;
  processQueue(): Promise<QueueProcessResult>;
  getQueueStatus(): Promise<QueueStatus>;
  
  // Browse
  searchDatasets(query: DatasetSearchQuery): Promise<DatasetSearchResult>;
  getDatasetInfo(datasetId: string): Promise<RemoteDatasetInfo>;
}
```

#### 10. Provenance Tracker

```typescript
// src/dataset-studio/core/provenance/types.ts
interface ProvenanceTracker {
  // Record lineage
  recordGeneration(itemId: string, lineage: GenerationLineage): Promise<void>;
  recordTransformation(itemId: string, transformation: Transformation): Promise<void>;
  recordImport(itemId: string, source: ImportSource): Promise<void>;
  
  // Query
  getLineage(itemId: string): Promise<ProvenanceChain>;
  getGenerationParams(itemId: string): Promise<GenerationParams | null>;
  
  // Verification
  verifyIntegrity(itemId: string): Promise<IntegrityResult>;
  
  // Reports
  generateReport(datasetId: string): Promise<ProvenanceReport>;
}

interface GenerationLineage {
  generator: 'local_model' | 'provider_api' | 'human';
  modelId?: string;
  modelVersion?: string;
  prompt?: string;
  systemPrompt?: string;
  seed?: number;
  parameters?: Record<string, unknown>;
  timestamp: string;
  cost?: { amount: number; currency: string };
}
```

#### 11. Policy Engine

```typescript
// src/dataset-studio/core/policy/types.ts
interface PolicyEngine {
  // Policy management
  loadPolicies(): Promise<void>;
  addPolicy(policy: Policy): Promise<void>;
  removePolicy(policyId: string): Promise<void>;
  getPolicies(): Promise<Policy[]>;
  
  // Validation
  validateItem(item: DatasetItem): Promise<PolicyViolation[]>;
  validateDataset(dataset: Dataset): Promise<PolicyViolation[]>;
  validateForPublish(dataset: Dataset): Promise<PolicyViolation[]>;
  
  // Content filtering
  checkContent(content: ContentInput): Promise<ContentCheckResult>;
  
  // License compatibility
  checkLicenseCompatibility(licenses: License[]): Promise<LicenseCompatibility>;
}

interface Policy {
  id: string;
  name: string;
  type: 'content' | 'privacy' | 'license' | 'quality';
  enabled: boolean;
  severity: 'error' | 'warning' | 'info';
  rules: PolicyRule[];
}

interface PolicyRule {
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'regex' | 'custom';
  value: unknown;
  message: string;
}
```

---

## Tech Stack

### Desktop Application

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Shell** | Electron 34+ | Mature, cross-platform, existing JoyCreate infrastructure |
| **UI Framework** | React 19 + TypeScript | Type safety, existing codebase |
| **State Management** | TanStack Query + Jotai | Async state + local atoms |
| **UI Components** | shadcn/ui + Tailwind | Existing design system |
| **IPC** | Electron IPC (typed) | Secure main↔renderer communication |

### Core Runtime

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Job Queue** | BullMQ (in-process) + SQLite | Persistent, resumable, no Redis needed |
| **Database** | SQLite + Drizzle ORM | Offline-first, FTS5, existing stack |
| **Search** | SQLite FTS5 | Full-text search, no external deps |
| **File Hashing** | Node.js crypto (SHA-256) | Native, fast |
| **Encryption** | libsodium (sodium-native) | AES-GCM, Ed25519, battle-tested |

### Local AI Runtime

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **LLM Inference** | llama.cpp (via llama-node) | GGUF models, CPU/GPU, quantized |
| **Image Generation** | Stable Diffusion.cpp | Local diffusion, no Python |
| **Embeddings** | ONNX Runtime | Fast CPU inference |
| **ASR (Speech-to-Text)** | Whisper.cpp | Offline transcription |
| **TTS (Text-to-Speech)** | Piper TTS | Offline synthesis |
| **Vision (OCR/Detection)** | ONNX (YOLOv8, PaddleOCR) | Object detection, OCR |

### Media Processing

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Video/Audio** | FFmpeg (fluent-ffmpeg) | Industry standard |
| **Image Processing** | Sharp | Fast, native bindings |
| **PDF Extraction** | pdf-lib + Tesseract.js | Text extraction |
| **Perceptual Hashing** | imghash (pHash) | Deduplication |

### P2P & Networking

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **P2P Transport** | libp2p (js-libp2p) | Mature, modular, NAT traversal |
| **Discovery** | mDNS (libp2p) + DHT | LAN + WAN discovery |
| **Content Addressing** | Multihash + CID | IPFS-compatible addressing |
| **Block Exchange** | Bitswap protocol | Efficient block transfer |
| **Optional Relay** | libp2p Circuit Relay | NAT hole-punching |

### Federation Client

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **HTTP Client** | ky + retry logic | Modern fetch, auto-retry |
| **Auth** | Ed25519 signatures + JWT | Wallet-style auth |
| **Offline Queue** | SQLite-backed queue | Persistent, resumable |
| **Upload** | Chunked + resumable (tus) | Large file support |

---

## Data Schemas

### 1. Asset Record Schema (JSONL)

```typescript
// src/dataset-studio/schemas/asset.ts
import { z } from 'zod';

export const ModalitySchema = z.enum([
  'image',
  'video', 
  'audio',
  'text',
  'context',
]);

export const SourceTypeSchema = z.enum([
  'captured',      // Webcam, mic, screen capture
  'imported',      // File import
  'generated',     // AI-generated
  'api',           // External API result
]);

export const GeneratorSchema = z.enum([
  'local_model',
  'provider_api',
  'human',
]);

export const QualitySignalsSchema = z.object({
  blur_score: z.number().min(0).max(1).optional(),
  nsfw_score: z.number().min(0).max(1).optional(),
  aesthetic_score: z.number().min(0).max(1).optional(),
  ocr_confidence: z.number().min(0).max(1).optional(),
  audio_snr_db: z.number().optional(),
  text_perplexity: z.number().optional(),
  duplicate_hash: z.string().optional(),
});

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  label: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export const LabelsSchema = z.object({
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  caption: z.string().optional(),
  transcript: z.string().optional(),
  bounding_boxes: z.array(BoundingBoxSchema).default([]),
  segments: z.array(z.object({
    start_ms: z.number(),
    end_ms: z.number(),
    label: z.string(),
    text: z.string().optional(),
  })).default([]),
  custom: z.record(z.unknown()).default({}),
});

export const LineageSchema = z.object({
  generator: GeneratorSchema,
  model_id: z.string().optional(),
  model_version: z.string().optional(),
  provider_id: z.string().optional(),
  prompt: z.string().optional(),
  system_prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
  seed: z.number().optional(),
  parameters: z.record(z.unknown()).default({}),
  parent_ids: z.array(z.string()).default([]),
  cost: z.object({
    amount: z.number(),
    currency: z.string(),
  }).optional(),
});

export const RightsSchema = z.object({
  license: z.string(),                    // SPDX identifier or custom
  license_url: z.string().url().optional(),
  copyright_holder: z.string().optional(),
  consent_obtained: z.boolean().default(false),
  consent_type: z.enum(['explicit', 'implicit', 'public_domain', 'unknown']).optional(),
  restrictions: z.array(z.string()).default([]),
  attribution_required: z.boolean().default(false),
  commercial_use_allowed: z.boolean().default(true),
  derivative_works_allowed: z.boolean().default(true),
});

export const SignatureSchema = z.object({
  signer_id: z.string(),
  public_key: z.string(),                 // Base64-encoded Ed25519 public key
  signature: z.string(),                  // Base64-encoded signature
  signed_at: z.string().datetime(),
  algorithm: z.literal('Ed25519'),
});

export const AssetRecordSchema = z.object({
  // Identity
  id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  
  // Content identification
  modality: ModalitySchema,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),  // SHA-256
  merkle_root: z.string().optional(),                 // For chunked assets
  byte_size: z.number().int().positive(),
  mime_type: z.string(),
  
  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  captured_at: z.string().datetime().optional(),
  
  // Source tracking
  source_type: SourceTypeSchema,
  source_path: z.string().optional(),                 // Original path (convenience)
  source_url: z.string().url().optional(),
  
  // Generation lineage
  lineage: LineageSchema.optional(),
  
  // Labels & annotations
  labels: LabelsSchema,
  
  // Quality signals
  quality_signals: QualitySignalsSchema,
  
  // Rights & licensing
  rights: RightsSchema,
  
  // Signatures
  signatures: z.array(SignatureSchema).default([]),
  
  // Content-addressed pointer
  content_uri: z.string(),                           // e.g., "sha256:abc123..." or CID
  
  // Media-specific metadata
  media_info: z.object({
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    duration_ms: z.number().int().optional(),
    frame_rate: z.number().optional(),
    sample_rate: z.number().int().optional(),
    channels: z.number().int().optional(),
    bit_depth: z.number().int().optional(),
    codec: z.string().optional(),
    color_space: z.string().optional(),
    pages: z.number().int().optional(),              // For PDFs
    word_count: z.number().int().optional(),         // For text
  }).optional(),
  
  // Embedding vector (stored separately, reference only)
  embedding_id: z.string().optional(),
});

export type AssetRecord = z.infer<typeof AssetRecordSchema>;
```

### 2. Dataset Manifest Schema

```typescript
// src/dataset-studio/schemas/manifest.ts
import { z } from 'zod';

export const SplitSchema = z.object({
  name: z.string(),                        // 'train', 'val', 'test'
  item_count: z.number().int(),
  byte_size: z.number().int(),
  item_ids: z.array(z.string().uuid()),
  seed: z.number().int().optional(),
  ratio: z.number().min(0).max(1).optional(),
});

export const DatasetStatsSchema = z.object({
  total_items: z.number().int(),
  total_bytes: z.number().int(),
  modality_counts: z.record(z.number().int()),
  label_distribution: z.record(z.number().int()),
  quality_summary: z.object({
    avg_blur_score: z.number().optional(),
    avg_aesthetic_score: z.number().optional(),
    nsfw_flagged_count: z.number().int().optional(),
    duplicate_count: z.number().int().optional(),
  }),
  created_range: z.object({
    earliest: z.string().datetime(),
    latest: z.string().datetime(),
  }),
});

export const DatasetManifestSchema = z.object({
  // Identity
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  
  // Versioning
  version: z.string().regex(/^\d+\.\d+\.\d+$/),  // Semver
  previous_version: z.string().uuid().optional(),
  
  // Schema
  schema_version: z.literal('1.0.0'),
  modalities: z.array(z.string()),
  
  // Content
  item_count: z.number().int(),
  total_bytes: z.number().int(),
  splits: z.array(SplitSchema).default([]),
  stats: DatasetStatsSchema,
  
  // Metadata file references
  metadata_format: z.enum(['jsonl', 'parquet']),
  metadata_files: z.array(z.object({
    path: z.string(),
    hash: z.string(),
    byte_size: z.number().int(),
    item_count: z.number().int(),
  })),
  
  // Rights
  license: z.string(),
  license_url: z.string().url().optional(),
  citation: z.string().optional(),
  
  // Creator
  creator: z.object({
    id: z.string(),
    name: z.string(),
    public_key: z.string(),
  }),
  
  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  published_at: z.string().datetime().optional(),
  
  // Integrity
  manifest_hash: z.string(),              // Hash of this manifest (excluding this field)
  merkle_root: z.string(),                // Root of all content hashes
  
  // Signatures
  signatures: z.array(z.object({
    signer_id: z.string(),
    public_key: z.string(),
    signature: z.string(),
    signed_at: z.string().datetime(),
  })),
  
  // Tags & discoverability
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  language: z.string().optional(),         // ISO 639-1
  
  // Feature flags
  features: z.object({
    has_embeddings: z.boolean().default(false),
    has_annotations: z.boolean().default(false),
    has_quality_scores: z.boolean().default(false),
    is_synthetic: z.boolean().default(false),
  }),
});

export type DatasetManifest = z.infer<typeof DatasetManifestSchema>;
```

### 3. Provenance Schema

```typescript
// src/dataset-studio/schemas/provenance.ts
import { z } from 'zod';

export const ProvenanceEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('creation'),
    timestamp: z.string().datetime(),
    generator: z.enum(['local_model', 'provider_api', 'human']),
    model_id: z.string().optional(),
    model_version: z.string().optional(),
    prompt: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
    seed: z.number().optional(),
  }),
  z.object({
    type: z.literal('import'),
    timestamp: z.string().datetime(),
    source_path: z.string().optional(),
    source_url: z.string().url().optional(),
    original_hash: z.string(),
  }),
  z.object({
    type: z.literal('transformation'),
    timestamp: z.string().datetime(),
    operation: z.string(),
    parameters: z.record(z.unknown()),
    input_hash: z.string(),
    output_hash: z.string(),
    tool_version: z.string().optional(),
  }),
  z.object({
    type: z.literal('annotation'),
    timestamp: z.string().datetime(),
    annotator: z.enum(['human', 'model']),
    model_id: z.string().optional(),
    annotation_type: z.string(),
  }),
  z.object({
    type: z.literal('verification'),
    timestamp: z.string().datetime(),
    verifier_id: z.string(),
    result: z.enum(['valid', 'invalid', 'modified']),
    details: z.string().optional(),
  }),
]);

export const ProvenanceChainSchema = z.object({
  item_id: z.string().uuid(),
  content_hash: z.string(),
  events: z.array(ProvenanceEventSchema),
  parent_chains: z.array(z.string().uuid()).default([]),
});

export const ProvenanceReportSchema = z.object({
  dataset_id: z.string().uuid(),
  dataset_version: z.string(),
  generated_at: z.string().datetime(),
  
  summary: z.object({
    total_items: z.number().int(),
    generation_sources: z.record(z.number().int()),
    models_used: z.array(z.object({
      model_id: z.string(),
      model_version: z.string().optional(),
      item_count: z.number().int(),
    })),
    transformations_applied: z.record(z.number().int()),
  }),
  
  chains: z.array(ProvenanceChainSchema),
  
  integrity: z.object({
    all_hashes_valid: z.boolean(),
    all_signatures_valid: z.boolean(),
    verification_timestamp: z.string().datetime(),
  }),
});

export type ProvenanceEvent = z.infer<typeof ProvenanceEventSchema>;
export type ProvenanceChain = z.infer<typeof ProvenanceChainSchema>;
export type ProvenanceReport = z.infer<typeof ProvenanceReportSchema>;
```

### 4. Policy Schema

```typescript
// src/dataset-studio/schemas/policy.ts
import { z } from 'zod';

export const ContentPolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.enum([
    'nsfw',
    'violence',
    'hate_speech',
    'pii',
    'copyright',
    'custom',
  ]),
  detector: z.enum(['model', 'regex', 'hash_list', 'custom']),
  detector_config: z.record(z.unknown()),
  threshold: z.number().min(0).max(1),
  action: z.enum(['block', 'warn', 'flag', 'redact']),
  enabled: z.boolean().default(true),
});

export const LicensePolicySchema = z.object({
  allowed_licenses: z.array(z.string()),           // SPDX identifiers
  require_attribution: z.boolean().default(true),
  allow_commercial: z.boolean().default(true),
  allow_derivatives: z.boolean().default(true),
  copyleft_compatible: z.boolean().default(false),
});

export const QualityPolicySchema = z.object({
  min_resolution: z.object({
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  }).optional(),
  max_blur_score: z.number().min(0).max(1).optional(),
  min_aesthetic_score: z.number().min(0).max(1).optional(),
  require_captions: z.boolean().default(false),
  require_tags: z.boolean().default(false),
  min_tags: z.number().int().optional(),
});

export const PrivacyPolicySchema = z.object({
  detect_faces: z.boolean().default(true),
  blur_faces_by_default: z.boolean().default(false),
  detect_pii: z.boolean().default(true),
  pii_patterns: z.array(z.string()).default([]),
  strip_exif: z.boolean().default(true),
  strip_gps: z.boolean().default(true),
});

export const DatasetPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  
  content: z.array(ContentPolicyRuleSchema).default([]),
  licensing: LicensePolicySchema.optional(),
  quality: QualityPolicySchema.optional(),
  privacy: PrivacyPolicySchema.optional(),
  
  enforce_on_import: z.boolean().default(true),
  enforce_on_generate: z.boolean().default(true),
  enforce_on_publish: z.boolean().default(true),
  
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type DatasetPolicy = z.infer<typeof DatasetPolicySchema>;
```

### 5. Context Pack Schema

```typescript
// src/dataset-studio/schemas/context-pack.ts
import { z } from 'zod';

export const ContextPackSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  
  // Prompts
  prompts: z.array(z.object({
    id: z.string(),
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
    name: z.string().optional(),
  })),
  
  // System settings
  settings: z.object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().optional(),
    max_tokens: z.number().int().optional(),
    stop_sequences: z.array(z.string()).optional(),
    seed: z.number().int().optional(),
  }).optional(),
  
  // Toolchain versions
  toolchain: z.object({
    app_version: z.string(),
    model_id: z.string().optional(),
    model_version: z.string().optional(),
    pipeline_version: z.string().optional(),
  }),
  
  // Source references
  sources: z.array(z.object({
    type: z.enum(['file', 'url', 'content_hash', 'dataset']),
    reference: z.string(),
    description: z.string().optional(),
  })).default([]),
  
  // Human notes
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  
  // Consent & usage
  consent: z.object({
    data_collection_consent: z.boolean().default(false),
    training_consent: z.boolean().default(false),
    commercial_consent: z.boolean().default(false),
  }),
  
  usage_restrictions: z.array(z.string()).default([]),
  
  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ContextPack = z.infer<typeof ContextPackSchema>;
```

### Example Records

```jsonl
// Example: Image with caption + tags
{"id":"550e8400-e29b-41d4-a716-446655440001","dataset_id":"550e8400-e29b-41d4-a716-446655440000","modality":"image","content_hash":"a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd","byte_size":245760,"mime_type":"image/jpeg","created_at":"2026-01-19T10:30:00Z","updated_at":"2026-01-19T10:35:00Z","source_type":"imported","source_path":"/Users/creator/photos/landscape.jpg","lineage":{"generator":"human"},"labels":{"tags":["landscape","mountain","sunset"],"categories":["nature","photography"],"caption":"A stunning sunset over mountain peaks with orange and purple hues","bounding_boxes":[],"segments":[],"custom":{}},"quality_signals":{"blur_score":0.12,"aesthetic_score":0.87,"nsfw_score":0.01},"rights":{"license":"CC-BY-4.0","copyright_holder":"John Creator","consent_obtained":true,"consent_type":"explicit","restrictions":[],"attribution_required":true,"commercial_use_allowed":true,"derivative_works_allowed":true},"signatures":[{"signer_id":"creator-123","public_key":"MCowBQYDK2VwAyEA...","signature":"SGVsbG8gV29ybGQ...","signed_at":"2026-01-19T10:35:00Z","algorithm":"Ed25519"}],"content_uri":"sha256:a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd","media_info":{"width":4096,"height":2731,"color_space":"sRGB"}}

// Example: Video clip with transcript + scenes
{"id":"550e8400-e29b-41d4-a716-446655440002","dataset_id":"550e8400-e29b-41d4-a716-446655440000","modality":"video","content_hash":"b2c3d4e5f67890123456789012345678901234567890123456789012345bcde","byte_size":52428800,"mime_type":"video/mp4","created_at":"2026-01-19T11:00:00Z","updated_at":"2026-01-19T11:30:00Z","source_type":"captured","lineage":{"generator":"human"},"labels":{"tags":["interview","tech","ai"],"categories":["education"],"transcript":"Welcome to our discussion about artificial intelligence...","segments":[{"start_ms":0,"end_ms":5000,"label":"intro","text":"Welcome to our discussion"},{"start_ms":5000,"end_ms":120000,"label":"main_content","text":"Today we'll explore..."},{"start_ms":120000,"end_ms":135000,"label":"outro","text":"Thank you for watching"}],"custom":{"scene_count":3,"keyframes":["sha256:abc...","sha256:def..."]}},"quality_signals":{"blur_score":0.08,"audio_snr_db":35.5},"rights":{"license":"CC-BY-NC-4.0","consent_obtained":true,"consent_type":"explicit","restrictions":["no_commercial_training"],"attribution_required":true,"commercial_use_allowed":false,"derivative_works_allowed":true},"signatures":[],"content_uri":"sha256:b2c3d4e5f67890123456789012345678901234567890123456789012345bcde","media_info":{"width":1920,"height":1080,"duration_ms":135000,"frame_rate":30,"codec":"h264"},"embedding_id":"emb-550e8400-002"}

// Example: AI-generated text with full lineage
{"id":"550e8400-e29b-41d4-a716-446655440003","dataset_id":"550e8400-e29b-41d4-a716-446655440000","modality":"text","content_hash":"c3d4e5f678901234567890123456789012345678901234567890123456cdef","byte_size":2048,"mime_type":"text/plain","created_at":"2026-01-19T12:00:00Z","updated_at":"2026-01-19T12:00:00Z","source_type":"generated","lineage":{"generator":"local_model","model_id":"llama-3.2-3b-instruct","model_version":"q4_k_m","prompt":"Write a detailed explanation of photosynthesis for a high school biology textbook.","system_prompt":"You are an educational content writer specializing in biology.","seed":42,"parameters":{"temperature":0.7,"top_p":0.9,"max_tokens":1024},"parent_ids":[]},"labels":{"tags":["biology","photosynthesis","education"],"categories":["science","textbook"],"custom":{"reading_level":"high_school","word_count":512}},"quality_signals":{"text_perplexity":12.5},"rights":{"license":"CC0-1.0","consent_obtained":true,"consent_type":"implicit","restrictions":[],"attribution_required":false,"commercial_use_allowed":true,"derivative_works_allowed":true},"signatures":[{"signer_id":"creator-123","public_key":"MCowBQYDK2VwAyEA...","signature":"U2lnbmF0dXJlLi4u...","signed_at":"2026-01-19T12:00:00Z","algorithm":"Ed25519"}],"content_uri":"sha256:c3d4e5f678901234567890123456789012345678901234567890123456cdef","media_info":{"word_count":512}}
```

---

## Pipelines

### Pipeline A: Offline Dataset Creation from Imports

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PIPELINE A: IMPORT → DATASET                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │  INPUT  │───▶│  SCAN   │───▶│ PROCESS │───▶│  INDEX  │───▶│  BUILD  │  │
│  │  FILES  │    │ & HASH  │    │ & LABEL │    │& STORE  │    │MANIFEST │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Steps:**

| Step | Input | Output | Failure Mode | Recovery |
|------|-------|--------|--------------|----------|
| 1. Scan | File paths/folders | File list with types | Invalid path, permission denied | Skip invalid, log warning |
| 2. Hash | File content | SHA-256 hash + metadata | Corrupt file, read error | Skip, mark as failed |
| 3. Dedup | Hashes | Deduplicated list | None | N/A |
| 4. Process | Raw files | Normalized media | Format error, codec missing | Fallback to raw, flag |
| 5. Auto-label | Processed files | Labels + quality scores | Model load failure | Skip auto-label, manual later |
| 6. Policy check | Labeled items | Validation results | Policy violation | Quarantine item |
| 7. Store | Valid items | Content-addressed blobs | Disk full | Pause, alert user |
| 8. Index | Stored items | Searchable metadata | DB error | Retry with backoff |
| 9. Build manifest | Dataset | Signed manifest | Vault locked | Prompt unlock |

**Resumability:** Checkpoint after each batch (100 items). Store progress in `jobs` table.

```typescript
// src/dataset-studio/pipelines/import.ts
interface ImportPipelineConfig {
  sourcePaths: string[];
  datasetId: string;
  options: {
    recursive: boolean;
    includeHidden: boolean;
    fileTypes?: string[];
    maxFileSize?: number;
    autoLabel: boolean;
    qualityCheck: boolean;
    deduplication: boolean;
    normalizeMedia: boolean;
    stripMetadata: boolean;
  };
}

interface ImportPipelineState {
  phase: 'scanning' | 'hashing' | 'processing' | 'labeling' | 'storing' | 'indexing' | 'complete';
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  lastCheckpoint: {
    phase: string;
    index: number;
    timestamp: string;
  };
}
```

### Pipeline B: Offline Synthetic Dataset Generation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PIPELINE B: SYNTHETIC GENERATION                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │ PROMPT  │───▶│  QUEUE  │───▶│GENERATE │───▶│ FILTER  │───▶│  STORE  │  │
│  │ CONFIG  │    │  JOBS   │    │  (AI)   │    │& SCORE  │    │& INDEX  │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                                             │
│                        ▲                                                    │
│                        │ Retry failed                                       │
│                        └────────────────────────────────────────────────────│
└─────────────────────────────────────────────────────────────────────────────┘
```

**Steps:**

| Step | Input | Output | Failure Mode | Recovery |
|------|-------|--------|--------------|----------|
| 1. Parse config | Generation config | Prompt queue | Invalid config | Validation error |
| 2. Check resources | System state | Resource allocation | Insufficient RAM/VRAM | Queue with lower batch |
| 3. Load model | Model ID | Loaded model | Model missing | Download prompt |
| 4. Generate batch | Prompts + params | Raw outputs | OOM, model crash | Reduce batch, retry |
| 5. Quality filter | Raw outputs | Filtered outputs | All rejected | Log, continue |
| 6. Record lineage | Outputs + params | Provenance records | DB error | Retry |
| 7. Store | Filtered outputs | Content blobs | Disk full | Pause |
| 8. Index | Stored items | Searchable records | DB error | Retry |

```typescript
// src/dataset-studio/pipelines/generate.ts
interface GenerationPipelineConfig {
  datasetId: string;
  modality: 'text' | 'image' | 'audio';
  provider: 'local' | string;           // Provider ID
  modelId: string;
  prompts: GenerationPrompt[];
  options: {
    batchSize: number;
    maxConcurrent: number;
    qualityThreshold: number;
    maxRetries: number;
    seed?: number;
    temperature?: number;
    // Modality-specific options
    imageOptions?: ImageGenerationOptions;
    textOptions?: TextGenerationOptions;
    audioOptions?: AudioGenerationOptions;
  };
}

interface GenerationPrompt {
  id: string;
  prompt: string;
  negativePrompt?: string;
  count: number;                        // How many to generate
  parameters?: Record<string, unknown>;
}
```

### Pipeline C: Hybrid Local Draft → API Refinement

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PIPELINE C: HYBRID GENERATION                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │  LOCAL  │───▶│  DRAFT  │───▶│ REVIEW  │───▶│   API   │───▶│  MERGE  │  │
│  │GENERATE │    │  STORE  │    │& SELECT │    │ REFINE  │    │& STORE  │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                                             │
│                                     │                                       │
│                          (User approval gate)                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Flow:**

1. Generate draft locally (fast, cheap)
2. Store draft with `status: 'draft'`
3. User reviews and selects candidates for refinement
4. If API allowed: send to remote provider with enhancement prompt
5. Record both lineages (local draft → API refinement)
6. Merge: keep original draft + refined version as variants

```typescript
// src/dataset-studio/pipelines/hybrid-generate.ts
interface HybridPipelineConfig {
  datasetId: string;
  draftProvider: 'local';
  draftModelId: string;
  refineProvider: string;              // Remote provider ID
  refineModelId: string;
  prompts: GenerationPrompt[];
  refinementPrompt: string;            // How to enhance
  options: {
    autoSelectThreshold?: number;      // Auto-select if quality > threshold
    requireApproval: boolean;          // Manual gate
    costLimit?: number;                // Max API spend
    keepDrafts: boolean;               // Store originals too
  };
}
```

### Pipeline D: P2P Replication

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PIPELINE D: P2P SYNC                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    PEER A                                              PEER B               │
│  ┌─────────┐                                        ┌─────────┐            │
│  │ Dataset │                                        │(empty)  │            │
│  │ v1.0.0  │                                        │         │            │
│  └────┬────┘                                        └────┬────┘            │
│       │                                                  │                  │
│       │  1. Announce manifest                            │                  │
│       ├─────────────────────────────────────────────────▶│                  │
│       │                                                  │                  │
│       │  2. Request manifest                             │                  │
│       │◀─────────────────────────────────────────────────┤                  │
│       │                                                  │                  │
│       │  3. Send manifest + verify signature             │                  │
│       ├─────────────────────────────────────────────────▶│                  │
│       │                                                  │                  │
│       │  4. Request missing blobs (by hash)              │                  │
│       │◀─────────────────────────────────────────────────┤                  │
│       │                                                  │                  │
│       │  5. Stream blobs (chunked)                       │                  │
│       ├─────────────────────────────────────────────────▶│                  │
│       │                                                  │                  │
│       │  6. Verify hashes & signatures                   │                  │
│       │                                        ┌────┴────┐                  │
│       │                                        │ Dataset │                  │
│       │                                        │ v1.0.0  │                  │
│       │                                        └─────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Conflict Resolution (CRDT-style):**

- Each item has a vector clock: `{ [peerId]: logicalTime }`
- On conflict: merge labels (union), keep highest quality signals
- Manifest versions form a DAG, not linear history
- Never silently overwrite; always create merge commit

```typescript
// src/dataset-studio/pipelines/p2p-sync.ts
interface P2PSyncSession {
  id: string;
  peerId: string;
  datasetId: string;
  direction: 'push' | 'pull' | 'bidirectional';
  status: 'connecting' | 'syncing' | 'verifying' | 'complete' | 'failed';
  progress: {
    manifestSynced: boolean;
    totalBlobs: number;
    syncedBlobs: number;
    bytesTransferred: number;
  };
  conflicts: SyncConflict[];
}

interface SyncConflict {
  itemId: string;
  localVersion: string;
  remoteVersion: string;
  resolution: 'pending' | 'local_wins' | 'remote_wins' | 'merged';
}
```

### Pipeline E: Federation Publish

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PIPELINE E: PUBLISH TO JOYMARKETPLACE                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │VALIDATE │───▶│  SIGN   │───▶│  QUEUE  │───▶│ UPLOAD  │───▶│ CONFIRM │  │
│  │& CHECK  │    │MANIFEST │    │  (if    │    │ BLOBS   │    │LISTING  │  │
│  │ POLICY  │    │& PROOFS │    │offline) │    │& META   │    │         │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│       │                             │                             │         │
│       ▼                             ▼                             ▼         │
│  [Block if                    [Persist to                   [Update        │
│   violations]                  offline queue]                local status] │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```typescript
// src/dataset-studio/pipelines/publish.ts
interface PublishPipelineConfig {
  datasetId: string;
  version: string;
  visibility: 'public' | 'unlisted' | 'private';
  options: {
    includeBlobs: boolean;            // Upload content or just manifest
    encryptBlobs: boolean;            // Encrypt before upload
    priceCredits?: number;            // If selling
    changelog?: string;
  };
}

interface PublishState {
  phase: 'validating' | 'signing' | 'queued' | 'uploading' | 'confirming' | 'complete' | 'failed';
  validationResult?: ValidationResult;
  uploadProgress?: {
    totalBytes: number;
    uploadedBytes: number;
    currentFile: string;
  };
  remoteUrl?: string;
  error?: string;
}
```

### Pipeline F: Update & Patch Publish

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PIPELINE F: DELTA UPDATE (v1 → v1.1)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │  DIFF   │───▶│ CREATE  │───▶│  SIGN   │───▶│ UPLOAD  │───▶│  LINK   │  │
│  │VERSIONS │    │CHANGELOG│    │ DELTA   │    │  DELTA  │    │VERSIONS │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Delta contains:**
- Added item IDs + their blobs
- Removed item IDs
- Modified items (new hash, old hash)
- Updated manifest fields
- Signed changelog

---

## P2P Sync Protocol

### Discovery

```typescript
// src/dataset-studio/p2p/discovery.ts
interface DiscoveryProtocol {
  // LAN discovery via mDNS
  startLANDiscovery(): void;
  stopLANDiscovery(): void;
  
  // WAN discovery via DHT (when online)
  startDHTDiscovery(): void;
  stopDHTDiscovery(): void;
  
  // Manual peer addition
  addPeer(address: string): Promise<PeerInfo>;
  
  // Events
  on(event: 'peer:found', handler: (peer: PeerInfo) => void): void;
}

interface PeerInfo {
  id: string;                           // libp2p peer ID
  addresses: string[];                  // Multiaddrs
  publicKey: Uint8Array;
  name?: string;
  lastSeen: string;
  trusted: boolean;
}
```

### Content Exchange Protocol

```
Message Types:
─────────────────────────────────────────────────────────────
ANNOUNCE_DATASET    → { datasetId, version, manifestHash }
REQUEST_MANIFEST    → { datasetId }
SEND_MANIFEST       → { manifest, signature }
REQUEST_BLOBS       → { hashes: string[] }
SEND_BLOB           → { hash, data, proof }
SYNC_COMPLETE       → { datasetId, version, itemCount }
SYNC_ERROR          → { code, message }
─────────────────────────────────────────────────────────────
```

### Block Transfer

```typescript
// src/dataset-studio/p2p/block-transfer.ts
interface BlockTransfer {
  // Request blocks by hash
  requestBlocks(peerId: string, hashes: string[]): AsyncGenerator<Block>;
  
  // Serve blocks
  serveBlock(hash: string): Promise<Uint8Array | null>;
  
  // Bandwidth management
  setUploadLimit(bytesPerSecond: number): void;
  setDownloadLimit(bytesPerSecond: number): void;
}

interface Block {
  hash: string;
  data: Uint8Array;
  size: number;
}
```

### Trusted Peer Groups

```typescript
// src/dataset-studio/p2p/peer-groups.ts
interface PeerGroup {
  id: string;
  name: string;
  members: string[];                    // Peer IDs
  sharedKey?: Uint8Array;              // For encrypted sharing
  permissions: {
    canRead: boolean;
    canWrite: boolean;
    canInvite: boolean;
  };
}
```

---

## Federation (JoyMarketplace.io) API

### Authentication

```yaml
# OpenAPI 3.1
openapi: 3.1.0
info:
  title: JoyMarketplace Federation API
  version: 1.0.0
  
servers:
  - url: https://api.joymarketplace.io/v1
  
paths:
  /auth/challenge:
    post:
      summary: Request authentication challenge
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                publicKey:
                  type: string
                  description: Base64-encoded Ed25519 public key
              required: [publicKey]
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  challenge:
                    type: string
                  expiresAt:
                    type: string
                    format: date-time
                    
  /auth/verify:
    post:
      summary: Verify signed challenge and get token
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                publicKey:
                  type: string
                challenge:
                  type: string
                signature:
                  type: string
              required: [publicKey, challenge, signature]
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  token:
                    type: string
                  refreshToken:
                    type: string
                  expiresAt:
                    type: string
                    format: date-time
                    
  /auth/refresh:
    post:
      summary: Refresh access token
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                refreshToken:
                  type: string
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  token:
                    type: string
                  expiresAt:
                    type: string
```

### Dataset Operations

```yaml
  /datasets:
    get:
      summary: List/search datasets
      parameters:
        - name: q
          in: query
          schema:
            type: string
        - name: modality
          in: query
          schema:
            type: array
            items:
              type: string
        - name: license
          in: query
          schema:
            type: string
        - name: minItems
          in: query
          schema:
            type: integer
        - name: page
          in: query
          schema:
            type: integer
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  datasets:
                    type: array
                    items:
                      $ref: '#/components/schemas/DatasetSummary'
                  total:
                    type: integer
                  page:
                    type: integer
                    
    post:
      summary: Create new dataset listing
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateDatasetRequest'
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Dataset'
                
  /datasets/{id}:
    get:
      summary: Get dataset details
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Dataset'
                
    patch:
      summary: Update dataset metadata
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateDatasetRequest'
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Dataset'
                
    delete:
      summary: Unpublish dataset
      security:
        - bearerAuth: []
      responses:
        '204':
          description: Deleted
          
  /datasets/{id}/manifests:
    get:
      summary: List all manifest versions
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/ManifestVersion'
                  
    post:
      summary: Upload new manifest version
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/DatasetManifest'
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManifestVersion'
                
  /datasets/{id}/manifests/{version}:
    get:
      summary: Get specific manifest version
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DatasetManifest'
                
  /datasets/{id}/blobs:
    post:
      summary: Upload blob (resumable)
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/octet-stream:
            schema:
              type: string
              format: binary
      parameters:
        - name: Upload-Length
          in: header
          required: true
          schema:
            type: integer
        - name: Content-Hash
          in: header
          required: true
          schema:
            type: string
      responses:
        '201':
          headers:
            Location:
              schema:
                type: string
                
  /datasets/{id}/blobs/{hash}:
    head:
      summary: Check if blob exists
      responses:
        '200':
          description: Blob exists
        '404':
          description: Blob not found
          
    get:
      summary: Download blob
      responses:
        '200':
          content:
            application/octet-stream:
              schema:
                type: string
                format: binary
                
  /datasets/{id}/proofs:
    get:
      summary: Get integrity proofs
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/IntegrityProofs'
                
    post:
      summary: Submit integrity proofs
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/IntegrityProofs'
              
  /datasets/{id}/releases:
    get:
      summary: List releases
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Release'
                  
    post:
      summary: Create new release
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                version:
                  type: string
                manifestHash:
                  type: string
                changelog:
                  type: string
                signature:
                  type: string
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Release'

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      
  schemas:
    DatasetSummary:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        description:
          type: string
        version:
          type: string
        itemCount:
          type: integer
        totalBytes:
          type: integer
        modalities:
          type: array
          items:
            type: string
        license:
          type: string
        creator:
          type: object
          properties:
            id:
              type: string
            name:
              type: string
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
          
    IntegrityProofs:
      type: object
      properties:
        datasetId:
          type: string
        version:
          type: string
        manifestHash:
          type: string
        merkleRoot:
          type: string
        signatures:
          type: array
          items:
            type: object
            properties:
              signerId:
                type: string
              publicKey:
                type: string
              signature:
                type: string
              signedAt:
                type: string
                format: date-time
```

---

## Security & Privacy

### Key Management

```typescript
// src/dataset-studio/security/keys.ts
interface KeyManager {
  // Master key (derived from passphrase via Argon2id)
  deriveMasterKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array>;
  
  // Identity keys (Ed25519)
  generateIdentityKeyPair(): Promise<KeyPair>;
  
  // Encryption keys (X25519 for key exchange, AES-256-GCM for data)
  generateEncryptionKeyPair(): Promise<KeyPair>;
  deriveSharedKey(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array>;
  
  // Signing
  sign(data: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array>;
  verify(data: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
}

interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}
```

### Encryption Scheme

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VAULT ENCRYPTION                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Passphrase ──▶ Argon2id ──▶ Master Key (256-bit)                         │
│                    │                                                        │
│                    ▼                                                        │
│              ┌─────────────┐                                                │
│              │   Vault     │                                                │
│              │  Key Store  │                                                │
│              │             │                                                │
│              │ • Identity  │◀── Ed25519 keypair                            │
│              │   Keys      │                                                │
│              │             │                                                │
│              │ • Encrypt   │◀── X25519 keypair                             │
│              │   Keys      │                                                │
│              │             │                                                │
│              │ • API Keys  │◀── AES-GCM encrypted                          │
│              │             │                                                │
│              │ • Peer Keys │◀── Trusted peer public keys                   │
│              └─────────────┘                                                │
│                                                                             │
│   Blob Encryption:                                                          │
│   ────────────────                                                          │
│   1. Generate random 256-bit key per blob                                   │
│   2. Encrypt blob with AES-256-GCM                                          │
│   3. Encrypt blob key with master key                                       │
│   4. Store: encrypted_blob || nonce || encrypted_key || auth_tag            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Access Control

```typescript
// src/dataset-studio/security/access.ts
interface AccessControl {
  // Dataset-level permissions
  setDatasetAccess(datasetId: string, access: DatasetAccess): Promise<void>;
  getDatasetAccess(datasetId: string): Promise<DatasetAccess>;
  
  // Check permissions
  canRead(datasetId: string, peerId?: string): Promise<boolean>;
  canWrite(datasetId: string, peerId?: string): Promise<boolean>;
  canShare(datasetId: string): Promise<boolean>;
  canPublish(datasetId: string): Promise<boolean>;
}

interface DatasetAccess {
  visibility: 'private' | 'peer_share' | 'public';
  allowedPeers?: string[];              // For peer_share
  encryptionKey?: Uint8Array;           // For encrypted sharing
  permissions: {
    read: boolean;
    write: boolean;
    share: boolean;
    publish: boolean;
  };
}
```

### Privacy Tools

```typescript
// src/dataset-studio/privacy/redaction.ts
interface RedactionTools {
  // Face detection & blurring
  detectFaces(image: Uint8Array): Promise<BoundingBox[]>;
  blurRegions(image: Uint8Array, regions: BoundingBox[]): Promise<Uint8Array>;
  
  // Metadata stripping
  stripExif(image: Uint8Array): Promise<Uint8Array>;
  stripGPS(image: Uint8Array): Promise<Uint8Array>;
  stripAllMetadata(file: Uint8Array, mimeType: string): Promise<Uint8Array>;
  
  // PII detection
  detectPII(text: string): Promise<PIIMatch[]>;
  redactPII(text: string, matches: PIIMatch[]): string;
  
  // Audio redaction
  detectSpeechSegments(audio: Uint8Array): Promise<TimeRange[]>;
  muteSegments(audio: Uint8Array, segments: TimeRange[]): Promise<Uint8Array>;
}

interface PIIMatch {
  type: 'email' | 'phone' | 'ssn' | 'address' | 'name' | 'custom';
  start: number;
  end: number;
  text: string;
  confidence: number;
}
```

---

## MVP + Roadmap

### MVP Scope (8 weeks)

**Week 1-2: Foundation**
- [ ] SQLite schema + Drizzle setup for datasets/items
- [ ] Content-addressed blob store
- [ ] Basic vault (passphrase encryption)
- [ ] File import pipeline (images, text, PDF)

**Week 3-4: AI Integration**
- [ ] Local LLM integration (llama.cpp)
- [ ] Auto-captioning for images
- [ ] Text generation pipeline
- [ ] Quality scoring (blur, basic filters)

**Week 5-6: Dataset Builder**
- [ ] Dataset creation UI
- [ ] Labeling interface (tags, categories)
- [ ] Manifest generation
- [ ] Basic provenance tracking
- [ ] Export to JSONL + blobs

**Week 7-8: Basic Sync**
- [ ] P2P discovery (LAN only)
- [ ] Manifest exchange
- [ ] Blob transfer
- [ ] CLI commands (import, build, export)

**MVP Deliverables:**
- Desktop app with dataset creation workflow
- Local AI labeling assistance
- Export datasets with provenance
- LAN peer sync

### Phase 2 (Weeks 9-16)

- [ ] Full P2P sync with conflict resolution
- [ ] Video/audio processing pipelines
- [ ] Image generation (Stable Diffusion)
- [ ] Federation connector (JoyMarketplace.io)
- [ ] Policy engine (content filtering)
- [ ] Advanced labeling (bounding boxes, segments)

### Phase 3 (Weeks 17-24)

- [ ] WAN P2P (relay, NAT traversal)
- [ ] Encrypted sharing
- [ ] Marketplace publishing workflow
- [ ] Context packs
- [ ] Embedding generation
- [ ] Advanced provenance reports
- [ ] Mobile companion app (viewing only)

---

## Testing & Acceptance Criteria

### Unit Tests

```typescript
// Coverage targets
const COVERAGE_TARGETS = {
  statements: 80,
  branches: 75,
  functions: 80,
  lines: 80,
};

// Critical paths requiring 100% coverage
const CRITICAL_PATHS = [
  'src/dataset-studio/core/vault/**',
  'src/dataset-studio/security/**',
  'src/dataset-studio/schemas/**',
];
```

### Integration Tests

| Test Suite | Description | Pass Criteria |
|------------|-------------|---------------|
| Import Pipeline | Import 1000 mixed files | All valid files indexed, <5% error rate |
| Generation Pipeline | Generate 100 text items | All items have valid lineage |
| P2P Sync | Sync 10MB dataset between peers | Byte-perfect match, signatures valid |
| Federation | Publish + download roundtrip | Manifest matches, all blobs retrieved |
| Vault | Encrypt/decrypt cycle | Data integrity preserved |

### E2E Tests

```typescript
// src/dataset-studio/__tests__/e2e/dataset-workflow.spec.ts
describe('Dataset Creation Workflow', () => {
  test('complete flow: import → label → build → export', async () => {
    // 1. Import files
    // 2. Auto-label with AI
    // 3. Build manifest
    // 4. Sign dataset
    // 5. Export
    // 6. Verify export integrity
  });
});

describe('P2P Sync Workflow', () => {
  test('sync dataset between two peers', async () => {
    // 1. Create dataset on peer A
    // 2. Discover peer B
    // 3. Sync dataset
    // 4. Verify identical content
  });
});
```

### Acceptance Criteria

| Feature | Criteria |
|---------|----------|
| **Offline Operation** | All creation workflows work with network disabled |
| **Import** | Support jpg, png, webp, mp4, mp3, wav, txt, pdf, json, csv |
| **Generation** | Local text generation <2s for 100 tokens on CPU |
| **Labeling** | Auto-caption <1s per image |
| **Build** | Process 10k items in <5 minutes |
| **P2P Sync** | Transfer 100MB in <30s on LAN |
| **Encryption** | Vault unlock <500ms |
| **Search** | FTS query <100ms for 100k items |

---

## CLI Specification

```bash
# joycreate CLI

# Import files into a dataset
joycreate import <path> [options]
  --dataset, -d <id>      Target dataset ID (creates new if omitted)
  --name <name>           Dataset name (for new dataset)
  --recursive, -r         Scan directories recursively
  --types <ext,...>       Filter by file extensions
  --auto-label            Run auto-labeling after import
  --dry-run               Preview without importing

# Generate synthetic data
joycreate generate [options]
  --dataset, -d <id>      Target dataset ID
  --modality <type>       text | image | audio
  --provider <id>         Provider ID (default: local)
  --model <id>            Model ID
  --prompt <text>         Generation prompt
  --prompt-file <path>    File with prompts (one per line)
  --count <n>             Number to generate per prompt
  --seed <n>              Random seed
  --output <path>         Output directory (if not adding to dataset)

# Label/annotate items
joycreate label <dataset-id> [options]
  --auto                  Run auto-labeling on unlabeled items
  --tags <tag,...>        Add tags to all items
  --category <cat>        Set category
  --interactive           Interactive labeling mode

# Build dataset manifest
joycreate build <dataset-id> [options]
  --version <semver>      Version string
  --splits <ratios>       Train/val/test ratios (e.g., "0.8,0.1,0.1")
  --seed <n>              Split seed
  --validate              Run validation checks
  --output <path>         Output directory

# Sign dataset
joycreate sign <dataset-id> [options]
  --version <semver>      Version to sign
  --identity <name>       Identity to use (default: primary)

# P2P sync
joycreate p2p sync <dataset-id> [options]
  --peer <address>        Peer address (multiaddr)
  --direction <dir>       push | pull | bidirectional
  --discover              Auto-discover peers on LAN

joycreate p2p list-peers   # List discovered/connected peers
joycreate p2p status       # Show sync status

# Publish to JoyMarketplace
joycreate publish <dataset-id> [options]
  --version <semver>      Version to publish
  --visibility <v>        public | unlisted | private
  --changelog <text>      Release notes
  --dry-run               Validate without publishing

# Other commands
joycreate datasets list              # List local datasets
joycreate datasets show <id>         # Show dataset details
joycreate datasets delete <id>       # Delete dataset
joycreate datasets export <id>       # Export to directory

joycreate models list                # List available models
joycreate models download <id>       # Download model
joycreate models remove <id>         # Remove model

joycreate vault init                 # Initialize vault
joycreate vault unlock               # Unlock vault
joycreate vault lock                 # Lock vault
joycreate vault identity list        # List identities
joycreate vault identity create      # Create new identity
```

---

## Sequence Diagram: Publish Flow

```
┌────────┐          ┌──────────┐          ┌─────────┐          ┌─────────────────┐
│  User  │          │ JoyCreate│          │  Vault  │          │ JoyMarketplace  │
└───┬────┘          └────┬─────┘          └────┬────┘          └────────┬────────┘
    │                    │                     │                        │
    │ publish(datasetId) │                     │                        │
    │───────────────────▶│                     │                        │
    │                    │                     │                        │
    │                    │ validate(dataset)   │                        │
    │                    │────────┐            │                        │
    │                    │        │            │                        │
    │                    │◀───────┘            │                        │
    │                    │                     │                        │
    │                    │ [If violations]     │                        │
    │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                     │                        │
    │   ValidationError  │                     │                        │
    │                    │                     │                        │
    │                    │ buildManifest()     │                        │
    │                    │────────┐            │                        │
    │                    │        │            │                        │
    │                    │◀───────┘            │                        │
    │                    │                     │                        │
    │                    │ getIdentity()       │                        │
    │                    │────────────────────▶│                        │
    │                    │                     │                        │
    │                    │      identity       │                        │
    │                    │◀────────────────────│                        │
    │                    │                     │                        │
    │                    │ sign(manifest)      │                        │
    │                    │────────────────────▶│                        │
    │                    │                     │                        │
    │                    │    signature        │                        │
    │                    │◀────────────────────│                        │
    │                    │                     │                        │
    │                    │                     │  POST /auth/challenge  │
    │                    │─────────────────────────────────────────────▶│
    │                    │                     │                        │
    │                    │                     │        challenge       │
    │                    │◀─────────────────────────────────────────────│
    │                    │                     │                        │
    │                    │ sign(challenge)     │                        │
    │                    │────────────────────▶│                        │
    │                    │                     │                        │
    │                    │  challengeSig       │                        │
    │                    │◀────────────────────│                        │
    │                    │                     │                        │
    │                    │                     │   POST /auth/verify    │
    │                    │─────────────────────────────────────────────▶│
    │                    │                     │                        │
    │                    │                     │         token          │
    │                    │◀─────────────────────────────────────────────│
    │                    │                     │                        │
    │                    │                     │  POST /datasets/{id}/  │
    │                    │                     │       manifests        │
    │                    │─────────────────────────────────────────────▶│
    │                    │                     │                        │
    │                    │                     │    manifestVersion     │
    │                    │◀─────────────────────────────────────────────│
    │                    │                     │                        │
    │                    │                     │ HEAD /datasets/{id}/   │
    │                    │                     │    blobs/{hash}        │
    │                    │─────────────────────────────────────────────▶│
    │                    │                     │                        │
    │                    │                     │ [For each missing blob]│
    │                    │                     │                        │
    │                    │                     │ POST /datasets/{id}/   │
    │                    │                     │    blobs (resumable)   │
    │                    │─────────────────────────────────────────────▶│
    │                    │                     │                        │
    │                    │                     │         ack            │
    │                    │◀─────────────────────────────────────────────│
    │                    │                     │                        │
    │                    │                     │  POST /datasets/{id}/  │
    │                    │                     │       releases         │
    │                    │─────────────────────────────────────────────▶│
    │                    │                     │                        │
    │                    │                     │       release          │
    │                    │◀─────────────────────────────────────────────│
    │                    │                     │                        │
    │  PublishComplete   │                     │                        │
    │◀───────────────────│                     │                        │
    │  {url, version}    │                     │                        │
    │                    │                     │                        │
```

---

## Open Questions

1. **Model Distribution**: How should local AI models be distributed? Options:
   - Bundle with app (increases app size significantly)
   - Download on first use from CDN
   - P2P model sharing between peers

2. **Large File Handling**: For video datasets >10GB, should we:
   - Support chunked storage with separate chunk pinning?
   - Require external storage backends (S3-compatible)?

3. **Marketplace Economics**: Payment/credit system design for JoyMarketplace.io is out of scope for this spec but will affect the publish flow.

---

## Appendix: File Structure

```
src/dataset-studio/
├── core/
│   ├── orchestrator/           # Job queue and pipeline coordination
│   ├── ai-runtime/             # Local AI model management
│   ├── media-pipeline/         # FFmpeg, Sharp integration
│   ├── dataset-engine/         # Dataset CRUD, manifests
│   ├── vault/                  # Encrypted storage, keys
│   ├── index/                  # SQLite FTS search
│   ├── provenance/             # Lineage tracking
│   └── policy/                 # Content/privacy policies
├── p2p/
│   ├── discovery/              # mDNS, DHT
│   ├── transport/              # libp2p integration
│   ├── content-store/          # Content-addressed blobs
│   └── sync/                   # Replication protocol
├── federation/
│   ├── client/                 # JoyMarketplace.io API client
│   ├── queue/                  # Offline operation queue
│   └── upload/                 # Resumable uploads (tus)
├── security/
│   ├── keys/                   # Key management
│   ├── encryption/             # AES-GCM, Ed25519
│   └── access/                 # Permission checks
├── privacy/
│   ├── detection/              # PII, face detection
│   └── redaction/              # Blur, strip, mute
├── pipelines/
│   ├── import.ts
│   ├── generate.ts
│   ├── hybrid-generate.ts
│   ├── p2p-sync.ts
│   ├── publish.ts
│   └── update.ts
├── schemas/
│   ├── asset.ts
│   ├── manifest.ts
│   ├── provenance.ts
│   ├── policy.ts
│   └── context-pack.ts
├── ui/
│   ├── pages/
│   │   ├── Ingestion/
│   │   ├── Studio/
│   │   ├── DatasetExplorer/
│   │   ├── SyncStatus/
│   │   └── Publish/
│   └── components/
├── cli/
│   ├── commands/
│   └── index.ts
└── __tests__/
    ├── unit/
    ├── integration/
    └── e2e/
```

---

*This specification is implementation-ready. All interfaces are concrete, all flows are defined, and all acceptance criteria are measurable.*
