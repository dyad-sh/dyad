/**
 * Helia Verification Service
 * Content-addressed storage and verification for trustless AI inference
 */

import crypto from "crypto";
import path from "node:path";
import fs from "fs-extra";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";

import type {
  InferenceRequest,
  InferenceResponse,
  InferenceProof,
  InferenceRecord,
  VerificationResult,
  HeliaNodeConfig,
  HeliaNodeStatus,
  LocalModelInfo,
} from "@/types/trustless_inference";

const logger = log.scope("helia_verification");

// Dynamic imports for ESM-only modules
let createHelia: any;
let json: any;
let unixfs: any;
let FsBlockstore: any;
let FsDatastore: any;
let CID: any;
let raw: any;
let sha256: any;

async function loadEsmModules() {
  if (!createHelia) {
    const heliaModule = await import("helia");
    createHelia = heliaModule.createHelia;
    
    const jsonModule = await import("@helia/json");
    json = jsonModule.json;
    
    const unixfsModule = await import("@helia/unixfs");
    unixfs = unixfsModule.unixfs;
    
    const blockstoreModule = await import("blockstore-fs");
    FsBlockstore = blockstoreModule.FsBlockstore;
    
    const datastoreModule = await import("datastore-fs");
    FsDatastore = datastoreModule.FsDatastore;
    
    const cidModule = await import("multiformats/cid");
    CID = cidModule.CID;
    
    const rawModule = await import("multiformats/codecs/raw");
    raw = rawModule;
    
    const sha256Module = await import("multiformats/hashes/sha2");
    sha256 = sha256Module.sha256;
  }
}

// ============================================================================
// Helia Node Manager
// ============================================================================

class HeliaVerificationService {
  private helia: any = null;
  private jsonCodec: any = null;
  private fsCodec: any = null;
  private config: HeliaNodeConfig;
  private records: Map<string, InferenceRecord> = new Map();
  private storagePath: string;

  constructor(config?: Partial<HeliaNodeConfig>) {
    this.config = {
      enablePersistence: true,
      storagePath: path.join(getUserDataPath(), "helia-store"),
      ...config,
    };
    this.storagePath = this.config.storagePath!;
  }

  async start(): Promise<void> {
    if (this.helia) {
      logger.info("Helia node already running");
      return;
    }

    try {
      // Load ESM modules dynamically
      await loadEsmModules();
      
      await fs.ensureDir(this.storagePath);
      
      const blockstorePath = path.join(this.storagePath, "blocks");
      const datastorePath = path.join(this.storagePath, "data");
      
      await fs.ensureDir(blockstorePath);
      await fs.ensureDir(datastorePath);

      const blockstore = new FsBlockstore(blockstorePath);
      const datastore = new FsDatastore(datastorePath);

      this.helia = await createHelia({
        blockstore,
        datastore,
      });

      this.jsonCodec = json(this.helia);
      this.fsCodec = unixfs(this.helia);

      // Load existing records
      await this.loadRecords();

      logger.info("Helia verification service started", {
        peerId: this.helia.libp2p.peerId.toString(),
      });
    } catch (error) {
      logger.error("Failed to start Helia:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.helia) {
      await this.saveRecords();
      await this.helia.stop();
      this.helia = null;
      this.jsonCodec = null;
      this.fsCodec = null;
      logger.info("Helia verification service stopped");
    }
  }

  async getStatus(): Promise<HeliaNodeStatus> {
    if (!this.helia) {
      return {
        running: false,
        connectedPeers: 0,
        storedCids: 0,
        storageUsedBytes: 0,
      };
    }

    const peerId = this.helia.libp2p.peerId.toString();
    const multiaddrs = this.helia.libp2p.getMultiaddrs().map((ma: any) => ma.toString());
    const connectedPeers = this.helia.libp2p.getPeers().length;

    // Get storage stats
    let storageUsedBytes = 0;
    try {
      const stats = await fs.stat(this.storagePath);
      storageUsedBytes = stats.size;
    } catch {
      // Ignore
    }

    return {
      running: true,
      peerId,
      multiaddrs,
      connectedPeers,
      storedCids: this.records.size,
      storageUsedBytes,
    };
  }

  // ============================================================================
  // Hashing Utilities
  // ============================================================================

  private hashString(data: string): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  private hashObject(data: Record<string, unknown>): string {
    const canonical = JSON.stringify(data, Object.keys(data).sort());
    return this.hashString(canonical);
  }

  private async createCID(data: Uint8Array): Promise<string> {
    await loadEsmModules();
    const hash = await sha256.digest(data);
    const cid = CID.create(1, raw.code, hash);
    return cid.toString();
  }

  private async collectCatStream(cid: string): Promise<Buffer> {
    await loadEsmModules();
    if (!this.fsCodec) {
      throw new Error("Helia UnixFS not available");
    }
    const parsed = CID.parse(cid);
    const chunks: Buffer[] = [];
    for await (const chunk of this.fsCodec.cat(parsed)) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // ============================================================================
  // Inference Verification
  // ============================================================================

  async createInferenceProof(
    request: InferenceRequest,
    response: InferenceResponse,
    modelInfo: LocalModelInfo
  ): Promise<InferenceProof> {
    const timestamps = {
      requested: request.timestamp,
      started: response.timestamp - response.generationTimeMs,
      completed: response.timestamp,
    };

    // Create hashes for verification
    const promptHash = this.hashString(request.prompt);
    const systemPromptHash = request.systemPrompt
      ? this.hashString(request.systemPrompt)
      : undefined;
    const messagesHash = request.messages
      ? this.hashObject({ messages: request.messages })
      : undefined;
    const configHash = this.hashObject({
      options: request.modelConfig.options,
    });
    const outputHash = this.hashString(response.output);

    // Create model verification data
    const modelVerification = {
      id: modelInfo.id,
      name: modelInfo.name,
      provider: modelInfo.provider,
      weightsHash: modelInfo.modelHash || modelInfo.digest,
      configHash: modelInfo.digest,
      quantization: modelInfo.quantization,
    };

    const proof: InferenceProof = {
      version: "1.0.0",
      proofType: "inference-verification",
      requestCid: "", // Will be set after storing
      responseCid: "", // Will be set after storing
      model: modelVerification,
      request: {
        promptHash,
        systemPromptHash,
        messagesHash,
        configHash,
      },
      response: {
        outputHash,
        tokenCount: response.totalTokens,
        generationTimeMs: response.generationTimeMs,
      },
      timestamps,
      node: {
        peerId: this.helia?.libp2p.peerId.toString(),
      },
    };

    return proof;
  }

  async storeInferenceRecord(
    request: InferenceRequest,
    response: InferenceResponse,
    proof: InferenceProof
  ): Promise<InferenceRecord> {
    if (!this.helia || !this.jsonCodec) {
      throw new Error("Helia node not running");
    }

    // Store request
    const requestCid = await this.jsonCodec.add({
      type: "inference-request",
      ...request,
    });
    proof.requestCid = requestCid.toString();

    // Store response
    const responseCid = await this.jsonCodec.add({
      type: "inference-response",
      ...response,
    });
    proof.responseCid = responseCid.toString();

    // Store proof
    const proofCid = await this.jsonCodec.add(proof);
    proof.proofCid = proofCid.toString();

    const record: InferenceRecord = {
      id: response.id,
      proof,
      request,
      response,
      cid: proofCid.toString(),
      pinned: false,
      verified: true,
      createdAt: Date.now(),
    };

    this.records.set(record.id, record);
    await this.saveRecords();

    logger.info("Stored inference record", {
      id: record.id,
      cid: record.cid,
      model: proof.model.id,
    });

    return record;
  }

  async verifyInferenceRecord(recordId: string): Promise<VerificationResult> {
    const record = this.records.get(recordId);
    if (!record) {
      return {
        valid: false,
        checks: {
          requestIntegrity: false,
          responseIntegrity: false,
          modelMatch: false,
          timestampValid: false,
        },
        details: ["Record not found"],
        warnings: [],
      };
    }

    const checks = {
      requestIntegrity: true,
      responseIntegrity: true,
      modelMatch: true,
      timestampValid: true,
    };
    const details: string[] = [];
    const warnings: string[] = [];

    // Verify request integrity
    const computedPromptHash = this.hashString(record.request.prompt);
    if (computedPromptHash !== record.proof.request.promptHash) {
      checks.requestIntegrity = false;
      details.push("Prompt hash mismatch");
    }

    // Verify response integrity
    const computedOutputHash = this.hashString(record.response.output);
    if (computedOutputHash !== record.proof.response.outputHash) {
      checks.responseIntegrity = false;
      details.push("Output hash mismatch");
    }

    // Verify model info
    if (record.response.modelInfo.id !== record.proof.model.id) {
      checks.modelMatch = false;
      details.push("Model ID mismatch");
    }

    // Verify timestamps
    const { requested, started, completed } = record.proof.timestamps;
    if (started < requested || completed < started) {
      checks.timestampValid = false;
      details.push("Invalid timestamp sequence");
    }

    // Check for suspiciously fast generation
    const minExpectedTime = record.proof.response.tokenCount * 5; // 5ms per token minimum
    if (record.proof.response.generationTimeMs < minExpectedTime) {
      warnings.push("Generation time seems unusually fast for token count");
    }

    const valid = Object.values(checks).every((c) => c);

    return { valid, checks, details, warnings };
  }

  async getInferenceRecord(recordId: string): Promise<InferenceRecord | null> {
    return this.records.get(recordId) || null;
  }

  async listInferenceRecords(): Promise<InferenceRecord[]> {
    return Array.from(this.records.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  async pinRecord(recordId: string): Promise<void> {
    const record = this.records.get(recordId);
    if (!record || !this.helia) return;

    try {
      await loadEsmModules();
      const cid = CID.parse(record.cid);
      await this.helia.pins.add(cid);
      record.pinned = true;
      await this.saveRecords();
      logger.info("Pinned record", { id: recordId, cid: record.cid });
    } catch (error) {
      logger.error("Failed to pin record:", error);
      throw error;
    }
  }

  async unpinRecord(recordId: string): Promise<void> {
    const record = this.records.get(recordId);
    if (!record || !this.helia) return;

    try {
      await loadEsmModules();
      const cid = CID.parse(record.cid);
      await this.helia.pins.rm(cid);
      record.pinned = false;
      await this.saveRecords();
      logger.info("Unpinned record", { id: recordId });
    } catch (error) {
      logger.error("Failed to unpin record:", error);
      throw error;
    }
  }

  // ============================================================================
  // Proof Export/Import
  // ============================================================================

  async exportProof(recordId: string): Promise<string> {
    const record = this.records.get(recordId);
    if (!record) throw new Error("Record not found");

    const exportData = {
      version: "1.0.0",
      type: "inference-proof-export",
      record: {
        id: record.id,
        proof: record.proof,
        request: record.request,
        response: record.response,
        cid: record.cid,
        createdAt: record.createdAt,
      },
      exportedAt: Date.now(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  async importProof(proofJson: string): Promise<InferenceRecord> {
    const data = JSON.parse(proofJson);
    
    if (data.version !== "1.0.0" || data.type !== "inference-proof-export") {
      throw new Error("Invalid proof format");
    }

    const record: InferenceRecord = {
      ...data.record,
      pinned: false,
      verified: false,
    };

    // Verify the imported record
    const tempRecords = this.records;
    this.records = new Map([[record.id, record]]);
    const verification = await this.verifyInferenceRecord(record.id);
    this.records = tempRecords;

    record.verified = verification.valid;
    this.records.set(record.id, record);
    await this.saveRecords();

    return record;
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  async createMerkleRoot(recordIds: string[]): Promise<string> {
    const hashes = recordIds
      .map((id) => this.records.get(id)?.cid)
      .filter((cid): cid is string => !!cid)
      .sort();

    if (hashes.length === 0) return "";

    // Simple merkle root implementation
    let currentLevel = hashes;
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || left;
        nextLevel.push(this.hashString(left + right));
      }
      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private async loadRecords(): Promise<void> {
    const recordsPath = path.join(this.storagePath, "records.json");
    try {
      if (await fs.pathExists(recordsPath)) {
        const data = await fs.readJson(recordsPath);
        this.records = new Map(Object.entries(data));
        logger.info(`Loaded ${this.records.size} inference records`);
      }
    } catch (error) {
      logger.warn("Failed to load records:", error);
    }
  }

  private async saveRecords(): Promise<void> {
    const recordsPath = path.join(this.storagePath, "records.json");
    try {
      const data = Object.fromEntries(this.records);
      await fs.writeJson(recordsPath, data, { spaces: 2 });
    } catch (error) {
      logger.error("Failed to save records:", error);
    }
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  async getStats(): Promise<{
    totalRecords: number;
    verifiedRecords: number;
    pinnedRecords: number;
    modelUsage: Record<string, number>;
    totalTokens: number;
    averageGenerationTimeMs: number;
  }> {
    const records = Array.from(this.records.values());
    
    const modelUsage: Record<string, number> = {};
    let totalTokens = 0;
    let totalTime = 0;

    for (const record of records) {
      const modelId = record.proof.model.id;
      modelUsage[modelId] = (modelUsage[modelId] || 0) + 1;
      totalTokens += record.proof.response.tokenCount;
      totalTime += record.proof.response.generationTimeMs;
    }

    return {
      totalRecords: records.length,
      verifiedRecords: records.filter((r) => r.verified).length,
      pinnedRecords: records.filter((r) => r.pinned).length,
      modelUsage,
      totalTokens,
      averageGenerationTimeMs: records.length > 0 ? totalTime / records.length : 0,
    };
  }

  // ========================================================================
  // Model Chunk Storage (UnixFS)
  // ========================================================================

  async storeModelChunkFile(filePath: string): Promise<{ cid: string; bytes: number }> {
    if (!this.helia || !this.fsCodec) {
      throw new Error("Helia node not running");
    }
    const data = await fs.readFile(filePath);
    const cid = await this.fsCodec.addBytes(data);
    return { cid: cid.toString(), bytes: data.length };
  }

  async exportModelChunkToFile(cid: string, outputPath: string): Promise<{ bytes: number }> {
    if (!this.helia || !this.fsCodec) {
      throw new Error("Helia node not running");
    }
    const data = await this.collectCatStream(cid);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, data);
    return { bytes: data.length };
  }
}

// Export singleton
export const heliaVerificationService = new HeliaVerificationService();
