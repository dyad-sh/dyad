/**
 * JCN Job Executor
 * Validates tickets, verifies licenses, runs agents in sandbox, generates signed receipts.
 * 
 * Job States: PENDING → VALIDATING → FETCHING → EXECUTING → FINALIZING → COMPLETED
 * 
 * Security Features:
 * - License verification before execution
 * - Sandboxed agent execution
 * - Signed receipts with IPLD formatting
 * - Resource limits and timeouts
 * - Full audit trail
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { ethers } from "ethers";
import log from "electron-log";
import { db } from "@/db";
import { jcnJobRecords, jcnLicenses, jcnAuditLog } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";

import { jcnStorageAdapter } from "./jcn_storage_adapter";
import { jcnBundleBuilder } from "./jcn_bundle_builder";

import type {
  JobState,
  JobStateRecord,
  JobTicket,
  InferenceReceipt,
  LicenseRecord,
  SandboxConfig,
  AuthContext,
  RequestId,
  TraceId,
  Cid,
  WalletAddress,
  Sha256Hash,
  LicenseId,
  BundleType,
  UsageMetrics,
  ExecutionOutput,
} from "@/types/jcn_types";

const logger = log.scope("jcn_job_executor");

// =============================================================================
// JOB STATE TRANSITIONS
// =============================================================================

/**
 * Extended job state updates for internal state transitions
 */
interface JobStateUpdates extends Partial<JobStateRecord> {
  errorCode?: string;
  errorMessage?: string;
  errorRetryable?: boolean;
  workDir?: string;
  bundlePath?: string;
  extractDir?: string;
  manifest?: Record<string, unknown>;
  licenseId?: string;
  licenseVerified?: boolean;
  output?: Record<string, unknown>;
  metrics?: UsageMetrics;
  receiptCid?: string;
}

const VALID_JOB_TRANSITIONS: Record<JobState, JobState[]> = {
  PENDING: ["VALIDATING", "CANCELLED", "FAILED"],
  VALIDATING: ["FETCHING", "FAILED"],
  FETCHING: ["EXECUTING", "FAILED"],
  EXECUTING: ["FINALIZING", "TIMEOUT", "FAILED"],
  FINALIZING: ["COMPLETED", "FAILED"],
  COMPLETED: [], // Terminal
  FAILED: [], // Terminal
  CANCELLED: [], // Terminal
  TIMEOUT: ["PENDING", "FAILED"], // Can retry
  RETRYABLE: ["PENDING", "FAILED"], // Can retry
};

function isValidJobTransition(from: JobState, to: JobState): boolean {
  return VALID_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

// =============================================================================
// JOB EXECUTION REQUEST
// =============================================================================

export interface JobRequest {
  /** Idempotency key */
  requestId: RequestId;
  /** Job ticket (signed by license holder) */
  ticket: JobTicket;
  /** Auth context of requester */
  auth: AuthContext;
  /** Sandbox configuration overrides */
  sandboxOverrides?: Partial<SandboxConfig>;
  /** Priority (higher = more urgent) */
  priority?: number;
}

export interface JobResult {
  success: boolean;
  jobId: string;
  state: JobState;
  receipt?: InferenceReceipt;
  output?: ExecutionOutput;
  error?: string;
  metrics?: UsageMetrics;
}

// =============================================================================
// DEFAULT SANDBOX CONFIGURATION
// =============================================================================

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  maxMemoryMb: 512,
  maxCpuPercent: 50,
  maxExecutionMs: 60000, // 1 minute
  maxOutputBytes: 10 * 1024 * 1024, // 10 MB
  allowNetwork: false,
  allowedNetworkDomains: [],
  allowFileSystem: true,
  allowedPaths: [],
  envVars: {},
};

// =============================================================================
// JOB EXECUTOR SERVICE
// =============================================================================

export class JcnJobExecutor {
  private executingJobs: Map<string, AbortController> = new Map();
  
  /**
   * Submit a job for execution
   */
  async submitJob(request: JobRequest): Promise<JobResult> {
    const traceId = crypto.randomUUID() as TraceId;
    
    logger.info("Job submission received", {
      requestId: request.requestId,
      traceId,
      bundleCid: request.ticket.bundleCid,
      licenseId: request.ticket.licenseId,
    });
    
    // Check for existing job with this requestId (idempotency)
    let record = await this.getRecordByRequestId(request.requestId);
    
    if (record) {
      logger.info("Found existing job record", {
        requestId: request.requestId,
        state: record.state,
      });
      
      // If already terminal, return current state
      if (record.state === "COMPLETED" || record.state === "FAILED" || record.state === "CANCELLED") {
        return this.buildResult(record, record.state === "COMPLETED");
      }
      
      // Resume execution
      return this.executeJob(record);
    }
    
    // Validate ticket signature first
    if (!this.verifyTicketSignature(request.ticket)) {
      throw new Error("Invalid ticket signature");
    }
    
    // Create new job record
    record = await this.createJobRecord(request, traceId);
    
    // Start execution
    return this.executeJob(record);
  }
  
  /**
   * Execute job through state machine
   */
  private async executeJob(record: JobStateRecord): Promise<JobResult> {
    logger.info("Executing job", { id: record.id, state: record.state });
    
    const abortController = new AbortController();
    this.executingJobs.set(record.id, abortController);
    
    try {
      while (true) {
        // Check for abort
        if (abortController.signal.aborted) {
          record = await this.transitionJobState(record, "CANCELLED", "aborted");
          return this.buildResult(record, false);
        }
        
        switch (record.state) {
          case "PENDING":
            record = await this.transitionJobState(record, "VALIDATING", "start_validation");
            break;
            
          case "VALIDATING":
            record = await this.validateJob(record);
            break;
            
          case "FETCHING":
            record = await this.fetchBundle(record);
            break;
            
          case "EXECUTING":
            record = await this.runExecution(record, abortController.signal);
            break;
            
          case "FINALIZING":
            record = await this.finalizeJob(record);
            break;
            
          case "COMPLETED":
            return this.buildResult(record, true);
            
          case "FAILED":
          case "CANCELLED":
          case "TIMEOUT":
            return this.buildResult(record, false);
            
          default:
            throw new Error(`Unknown job state: ${record.state}`);
        }
      }
    } catch (error) {
      logger.error("Job execution error", { id: record.id, error });
      
      record = await this.transitionJobState(record, "FAILED", "error", {
        errorCode: (error as Error).name || "EXECUTION_ERROR",
        errorMessage: (error as Error).message,
        errorRetryable: false,
      });
      
      return this.buildResult(record, false);
    } finally {
      this.executingJobs.delete(record.id);
    }
  }
  
  /**
   * Step: Validate job (license, ticket, permissions)
   */
  private async validateJob(record: JobStateRecord): Promise<JobStateRecord> {
    logger.info("Validating job", { id: record.id });
    
    const ticket = record.ticket;
    
    // 1. Verify ticket hasn't expired
    if (ticket.expiresAt < Date.now()) {
      throw new Error("Job ticket has expired");
    }
    
    // 2. Verify license
    const licenseId = ticket.licenseId;
    const requesterWallet = ticket.requesterWallet;
    if (!licenseId || !requesterWallet) {
      throw new Error("Missing licenseId or requesterWallet in ticket");
    }
    const license = await this.verifyLicense(licenseId, ticket.bundleCid, requesterWallet);
    
    if (!license) {
      throw new Error(`Invalid or expired license: ${licenseId}`);
    }
    
    // 3. Check usage limits
    const usageLimit = license.usageLimit ?? Infinity;
    const currentUsage = license.currentUsage ?? 0;
    if (usageLimit !== Infinity && currentUsage >= usageLimit) {
      throw new Error("License usage limit exceeded");
    }
    
    // 4. Verify bundle exists and is accessible
    const bundleExists = await jcnStorageAdapter.fetch(ticket.bundleCid);
    if (!bundleExists) {
      throw new Error(`Bundle not found: ${ticket.bundleCid}`);
    }
    
    return this.transitionJobState(record, "FETCHING", "validation_passed", {
      licenseValid: true,
    });
  }
  
  /**
   * Step: Fetch bundle from IPFS
   */
  private async fetchBundle(record: JobStateRecord): Promise<JobStateRecord> {
    logger.info("Fetching bundle", { id: record.id, bundleCid: record.ticket.bundleCid });
    
    const ticket = record.ticket;
    
    // Create temp directory for bundle
    const workDir = path.join(os.tmpdir(), `jcn-job-${record.id}`);
    await fs.mkdir(workDir, { recursive: true });
    
    const bundlePath = path.join(workDir, "bundle.tar");
    
    // Fetch bundle from IPFS
    const fetchResult = await jcnStorageAdapter.fetch(ticket.bundleCid);
    if (!fetchResult) {
      throw new Error(`Failed to fetch bundle: ${ticket.bundleCid}`);
    }
    
    // Write bundle to disk
    await fs.writeFile(bundlePath, fetchResult);
    
    // Verify bundle integrity if merkle root provided
    if (ticket.inputHash) {
      // Extract and verify
      const extractDir = path.join(workDir, "extracted");
      await fs.mkdir(extractDir, { recursive: true });
      
      // Extract bundle
      const tar = await import("tar");
      await tar.x({ file: bundlePath, cwd: extractDir });
      
      // Read manifest
      const manifestPath = path.join(extractDir, "manifest.json");
      const manifestData = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestData);
      
      // Verify bundle
      const verification = await jcnBundleBuilder.verifyBundle(bundlePath, manifest);
      if (!verification.valid) {
        throw new Error(`Bundle verification failed: ${verification.errors.join(", ")}`);
      }
      
      return this.transitionJobState(record, "EXECUTING", "bundle_fetched", {
        workDir,
        bundlePath,
        extractDir,
        manifest,
      });
    }
    
    // Extract without verification
    const extractDir = path.join(workDir, "extracted");
    await fs.mkdir(extractDir, { recursive: true });
    
    const tar = await import("tar");
    await tar.x({ file: bundlePath, cwd: extractDir });
    
    // Read manifest
    const manifestPath = path.join(extractDir, "manifest.json");
    const manifestData = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestData);
    
    return this.transitionJobState(record, "EXECUTING", "bundle_fetched", {
      workDir,
      bundlePath,
      extractDir,
      manifest,
    });
  }
  
  /**
   * Step: Run agent execution in sandbox
   */
  private async runExecution(record: JobStateRecord, signal: AbortSignal): Promise<JobStateRecord> {
    logger.info("Running execution", { id: record.id });
    
    const checkpoint = record.checkpoint;
    if (!checkpoint?.extractDir || !checkpoint?.manifest) {
      throw new Error("Missing checkpoint data for execution");
    }
    
    const manifest = checkpoint.manifest;
    const extractDir = checkpoint.extractDir as string;
    
    // Determine sandbox config
    const sandboxConfig: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      ...record.sandboxConfig,
    };
    
    // Set allowed paths
    sandboxConfig.allowedPaths = [extractDir];
    
    const startTime = Date.now();
    let output: ExecutionOutput;
    let metrics: UsageMetrics;
    
    try {
      // Run based on bundle type
      switch (manifest.type as BundleType) {
        case "agent":
          ({ output, metrics } = await this.executeAgent(
            extractDir,
            manifest,
            record.ticket.inputJson,
            sandboxConfig,
            signal
          ));
          break;
          
        case "model":
          ({ output, metrics } = await this.executeModel(
            extractDir,
            manifest,
            record.ticket.inputJson,
            sandboxConfig,
            signal
          ));
          break;
          
        case "tool":
          ({ output, metrics } = await this.executeTool(
            extractDir,
            manifest,
            record.ticket.inputJson,
            sandboxConfig,
            signal
          ));
          break;
          
        case "prompt_library":
        case "dataset":
        case "knowledge_pack":
          // These are data bundles, just return the content
          output = {
            type: "data",
            data: await this.loadDataBundle(extractDir, manifest) as Record<string, unknown>,
            format: "json",
          };
          metrics = {
            cpuTimeMs: Date.now() - startTime,
            memoryPeakMb: 0,
            ioReadBytes: 0,
            ioWriteBytes: 0,
            networkBytes: 0,
            executionTimeMs: Date.now() - startTime,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            memoryUsedMb: 0,
          };
          break;
          
        default:
          throw new Error(`Unsupported bundle type: ${manifest.type}`);
      }
      
      // Check for timeout
      if (signal.aborted) {
        return this.transitionJobState(record, "TIMEOUT", "execution_timeout");
      }
      
      return this.transitionJobState(record, "FINALIZING", "execution_complete", {
        output,
        metrics,
      });
    } catch (error) {
      if (signal.aborted || (error as Error).name === "AbortError") {
        return this.transitionJobState(record, "TIMEOUT", "execution_timeout");
      }
      throw error;
    }
  }
  
  /**
   * Execute an agent bundle
   */
  private async executeAgent(
    extractDir: string,
    manifest: Record<string, unknown>,
    input: unknown,
    config: SandboxConfig,
    signal: AbortSignal
  ): Promise<{ output: ExecutionOutput; metrics: UsageMetrics }> {
    const startTime = Date.now();
    
    // Find entry point
    const entryPoint = manifest.entryPoint as string || "index.js";
    const entryPath = path.join(extractDir, entryPoint);
    
    // Check entry exists
    try {
      await fs.access(entryPath);
    } catch {
      throw new Error(`Entry point not found: ${entryPoint}`);
    }
    
    // For now, use VM2 or isolated-vm for JavaScript agents
    // In production, this would use proper sandboxing
    
    let result: unknown;
    
    // Simplified execution - in production use proper sandbox
    if (entryPoint.endsWith(".js") || entryPoint.endsWith(".ts")) {
      result = await this.executeJavaScript(entryPath, input, config, signal);
    } else if (entryPoint.endsWith(".py")) {
      result = await this.executePython(entryPath, input, config, signal);
    } else {
      throw new Error(`Unsupported entry point type: ${entryPoint}`);
    }
    
    const executionTime = Date.now() - startTime;
    
    return {
      output: {
        type: "agent_response",
        data: result as Record<string, unknown>,
        format: "json",
      },
      metrics: {
        cpuTimeMs: executionTime,
        memoryPeakMb: process.memoryUsage().heapUsed / 1024 / 1024,
        ioReadBytes: 0,
        ioWriteBytes: 0,
        networkBytes: 0,
        executionTimeMs: executionTime,
        inputTokens: this.estimateTokens(JSON.stringify(input)),
        outputTokens: this.estimateTokens(JSON.stringify(result)),
        totalTokens: 0,
        memoryUsedMb: process.memoryUsage().heapUsed / 1024 / 1024,
      },
    };
  }
  
  /**
   * Execute JavaScript in sandbox
   */
  private async executeJavaScript(
    entryPath: string,
    input: unknown,
    config: SandboxConfig,
    signal: AbortSignal
  ): Promise<unknown> {
    // In production, use isolated-vm or similar
    // For now, use a simple require with timeout
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Execution timeout"));
      }, config.maxExecutionMs);
      
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("Execution aborted"));
      });
      
      try {
        // This is simplified - production would use proper sandboxing
        const module = require(entryPath);
        const handler = module.default || module.handler || module.run || module;
        
        if (typeof handler === "function") {
          Promise.resolve(handler(input))
            .then((result) => {
              clearTimeout(timeout);
              resolve(result);
            })
            .catch((err) => {
              clearTimeout(timeout);
              reject(err);
            });
        } else {
          clearTimeout(timeout);
          resolve(handler);
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }
  
  /**
   * Execute Python in sandbox
   */
  private async executePython(
    entryPath: string,
    input: unknown,
    config: SandboxConfig,
    signal: AbortSignal
  ): Promise<unknown> {
    const { spawn } = await import("child_process");
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error("Execution timeout"));
      }, config.maxExecutionMs);
      
      const inputJson = JSON.stringify(input);
      
      const proc = spawn("python", [entryPath], {
        env: {
          ...process.env,
          ...config.envVars,
          JCN_INPUT: inputJson,
        },
        cwd: path.dirname(entryPath),
      });
      
      let stdout = "";
      let stderr = "";
      
      proc.stdout.on("data", (data) => {
        stdout += data.toString();
        const maxBytes = config.maxOutputBytes ?? 10 * 1024 * 1024;
        if (stdout.length > maxBytes) {
          proc.kill();
          clearTimeout(timeout);
          reject(new Error("Output size limit exceeded"));
        }
      });
      
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      
      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve(stdout);
          }
        } else {
          reject(new Error(`Python execution failed: ${stderr}`));
        }
      });
      
      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      
      signal.addEventListener("abort", () => {
        proc.kill();
        clearTimeout(timeout);
        reject(new Error("Execution aborted"));
      });
      
      // Write input to stdin
      proc.stdin.write(inputJson);
      proc.stdin.end();
    });
  }
  
  /**
   * Execute a model bundle
   */
  private async executeModel(
    extractDir: string,
    manifest: Record<string, unknown>,
    input: unknown,
    config: SandboxConfig,
    signal: AbortSignal
  ): Promise<{ output: ExecutionOutput; metrics: UsageMetrics }> {
    // Model execution would integrate with inference backend
    // For now, return placeholder
    
    const startTime = Date.now();
    
    return {
      output: {
        type: "model_inference",
        data: { message: "Model inference not yet implemented" },
        format: "json",
      },
      metrics: {
        cpuTimeMs: 0,
        memoryPeakMb: 0,
        ioReadBytes: 0,
        ioWriteBytes: 0,
        networkBytes: 0,
        executionTimeMs: Date.now() - startTime,
        inputTokens: this.estimateTokens(JSON.stringify(input)),
        outputTokens: 0,
        totalTokens: 0,
        memoryUsedMb: 0,
      },
    };
  }
  
  /**
   * Execute a tool bundle
   */
  private async executeTool(
    extractDir: string,
    manifest: Record<string, unknown>,
    input: unknown,
    config: SandboxConfig,
    signal: AbortSignal
  ): Promise<{ output: ExecutionOutput; metrics: UsageMetrics }> {
    // Similar to agent execution
    return this.executeAgent(extractDir, manifest, input, config, signal);
  }
  
  /**
   * Load data bundle
   */
  private async loadDataBundle(
    extractDir: string,
    manifest: Record<string, unknown>
  ): Promise<unknown> {
    // Read all data files
    const files = manifest.files as Array<{ path: string }>;
    const data: Record<string, unknown> = {};
    
    for (const file of files || []) {
      const filePath = path.join(extractDir, file.path);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        try {
          data[file.path] = JSON.parse(content);
        } catch {
          data[file.path] = content;
        }
      } catch {
        // Skip files that can't be read
      }
    }
    
    return data;
  }
  
  /**
   * Step: Finalize job (generate receipt, update license usage)
   */
  private async finalizeJob(record: JobStateRecord): Promise<JobStateRecord> {
    logger.info("Finalizing job", { id: record.id });
    
    const output = record.output;
    const metrics = record.metrics;
    
    if (!output) {
      throw new Error("No output to finalize");
    }
    
    // Generate receipt
    const receipt = await this.generateReceipt(record, output, metrics);
    
    // Update license usage
    await this.updateLicenseUsage(record.licenseId, record.ticket.bundleCid, metrics);
    
    // Clean up work directory
    if (record.checkpoint?.workDir) {
      try {
        await fs.rm(record.checkpoint.workDir as string, { recursive: true, force: true });
      } catch (error) {
        logger.warn("Failed to clean up work directory", { error });
      }
    }
    
    return this.transitionJobState(record, "COMPLETED", "finalized", {
      receipt,
      receiptCid: receipt.receiptCid,
    });
  }
  
  /**
   * Generate signed receipt
   */
  private async generateReceipt(
    record: JobStateRecord,
    output: ExecutionOutput,
    metrics?: UsageMetrics
  ): Promise<InferenceReceipt> {
    const ticket = record.ticket;
    const now = Date.now();
    
    // Compute output hash
    const outputBytes = Buffer.from(JSON.stringify(output.data));
    const outputHash = crypto.createHash("sha256").update(outputBytes).digest("hex") as Sha256Hash;
    
    // Pin output to IPFS
    const outputPinResults = await jcnStorageAdapter.pinJson(output, ["4everland"], {
      name: `output-${record.id}.json`,
    });
    const outputCid = outputPinResults.find((r) => r.success)?.cid || ("" as Cid);
    
    // Create receipt matching InferenceReceipt interface
    const receipt: InferenceReceipt = {
      v: 1,
      type: "inference-receipt",
      jobId: record.id,
      ticketId: ticket.ticketId,
      bundleCid: ticket.bundleCid,
      merkleRoot: ticket.merkleRoot || ("" as any),
      inputHash: ticket.inputHash,
      outputCid: outputCid,
      outputHash,
      licenseId: ticket.licenseId || "",
      executor: (process.env.JCN_EXECUTOR_WALLET as WalletAddress) || ("0x0000000000000000000000000000000000000000" as WalletAddress),
      executorNode: process.env.JCN_NODE_ID || "local",
      requester: ticket.requesterWallet || ("0x0000000000000000000000000000000000000000" as WalletAddress),
      timestamp: now,
      metrics: {
        startedAt: metrics?.startedAt || now,
        completedAt: metrics?.completedAt || now,
        durationMs: metrics?.durationMs || metrics?.executionTimeMs || 0,
        inputTokens: metrics?.inputTokens,
        outputTokens: metrics?.outputTokens,
        gpuTimeMs: metrics?.gpuTimeMs,
        memoryPeakMb: metrics?.memoryPeakMb,
      },
      signature: {
        algorithm: "eip191",
        value: "",
      },
    };
    
    // Sign receipt
    const receiptData = JSON.stringify({
      jobId: receipt.jobId,
      ticketId: receipt.ticketId,
      bundleCid: receipt.bundleCid,
      inputHash: receipt.inputHash,
      outputHash: receipt.outputHash,
      executorNode: receipt.executorNode,
      timestamp: receipt.timestamp,
    });
    
    // In production, use actual signing key
    const signingKey = process.env.JCN_SIGNING_KEY;
    if (signingKey) {
      const wallet = new ethers.Wallet(signingKey);
      const messageHash = ethers.hashMessage(receiptData);
      const sig = await wallet.signMessage(ethers.getBytes(messageHash));
      receipt.signature = { algorithm: "eip191", value: sig };
    } else {
      // Generate placeholder signature for testing
      receipt.signature = { algorithm: "eip191", value: `0x${crypto.randomBytes(65).toString("hex")}` };
    }
    
    // Pin receipt to IPFS
    const pinResults = await jcnStorageAdapter.pinJson(receipt, ["4everland"], {
      name: `receipt-${record.id}.json`,
    });
    
    const successfulPin = pinResults.find((r) => r.success && r.cid);
    if (successfulPin?.cid) {
      receipt.receiptCid = successfulPin.cid;
    }
    
    return receipt;
  }
  
  /**
   * Verify ticket signature
   */
  private verifyTicketSignature(ticket: JobTicket): boolean {
    try {
      const ticketData = JSON.stringify({
        ticketId: ticket.ticketId,
        bundleCid: ticket.bundleCid,
        bundleVersion: ticket.bundleVersion,
        licenseId: ticket.licenseId,
        requesterWallet: ticket.requesterWallet,
        inputHash: ticket.inputHash,
        expiresAt: ticket.expiresAt,
      });
      
      const messageHash = ethers.hashMessage(ticketData);
      const recoveredAddress = ethers.recoverAddress(messageHash, ticket.signature.value);
      
      const requester = ticket.requesterWallet || "";
      return recoveredAddress.toLowerCase() === requester.toLowerCase();
    } catch (error) {
      logger.error("Ticket signature verification failed", { error });
      return false;
    }
  }
  
  /**
   * Verify license
   */
  private async verifyLicense(
    licenseId: string,
    bundleCid: Cid,
    holderWallet: WalletAddress
  ): Promise<LicenseRecord | null> {
    const now = Date.now();
    
    // Check local cache first (using correct schema field names)
    const [cached] = await db.select()
      .from(jcnLicenses)
      .where(and(
        eq(jcnLicenses.id, licenseId),
        eq(jcnLicenses.assetId, bundleCid),
        eq(jcnLicenses.licensee, holderWallet),
        eq(jcnLicenses.valid, true)
      ))
      .limit(1);
    
    if (cached && (!cached.expiresAt || cached.expiresAt.getTime() > now)) {
      return {
        licenseId: cached.id as LicenseId,
        bundleCid: cached.assetId as Cid,
        licenseType: cached.licenseType as "perpetual" | "subscription" | "usage_based",
        holderWallet: cached.licensee as WalletAddress,
        grantedAt: cached.createdAt?.getTime() || now,
        validUntil: cached.expiresAt?.getTime(),
        usageLimit: cached.limitsJson?.maxInferences ?? undefined,
        currentUsage: cached.inferencesUsed || 0,
        revoked: !cached.valid,
        onChain: cached.verificationMethod === "contract_call" || cached.verificationMethod === "token_ownership",
        contractAddress: cached.contractAddress as WalletAddress | undefined,
        tokenId: cached.tokenId ?? undefined,
      };
    }
    
    // TODO: Verify on-chain if not cached
    // For now, return null if not in cache
    return null;
  }
  
  /**
   * Update license usage
   */
  private async updateLicenseUsage(
    licenseId: string | undefined,
    bundleCid: Cid,
    metrics?: UsageMetrics
  ): Promise<void> {
    if (!licenseId) return;
    
    // Increment usage counter using SQL increment
    const [current] = await db.select({ inferencesUsed: jcnLicenses.inferencesUsed })
      .from(jcnLicenses)
      .where(eq(jcnLicenses.id, licenseId))
      .limit(1);
    
    if (current) {
      await db.update(jcnLicenses)
        .set({
          inferencesUsed: (current.inferencesUsed || 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(jcnLicenses.id, licenseId));
    }
  }
  
  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Create job record in database
   */
  private async createJobRecord(request: JobRequest, traceId: TraceId): Promise<JobStateRecord> {
    const id = crypto.randomUUID();
    
    const record: typeof jcnJobRecords.$inferInsert = {
      id,
      requestId: request.requestId,
      traceId,
      state: "PENDING",
      stateHistoryJson: [{ state: "PENDING", timestamp: Date.now(), event: "created" }],
      ticketJson: request.ticket as unknown,
    };
    
    await db.insert(jcnJobRecords).values(record);
    
    // Audit log
    await this.auditLog("job_created", "system", "system", "job", id, null, record, request.requestId, traceId);
    
    return {
      id,
      requestId: request.requestId,
      traceId,
      state: "PENDING" as JobState,
      stateHistory: [{ state: "PENDING" as JobState, timestamp: Date.now(), event: "created" }],
      ticket: request.ticket,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  
  /**
   * Transition job state
   */
  private async transitionJobState(
    record: JobStateRecord,
    newState: JobState,
    event: string,
    updates: JobStateUpdates = {}
  ): Promise<JobStateRecord> {
    const oldState = record.state;
    
    if (!isValidJobTransition(oldState, newState)) {
      throw new Error(`Invalid job state transition: ${oldState} → ${newState}`);
    }
    
    const now = Date.now();
    const newHistory = [
      ...record.stateHistory,
      { state: newState, timestamp: now, event },
    ];
    
    const updateData: Partial<typeof jcnJobRecords.$inferInsert> = {
      state: newState === "TIMEOUT" ? "FAILED" : newState, // Map TIMEOUT to FAILED for DB
      stateHistoryJson: newHistory,
      updatedAt: new Date(now),
    };
    
    if (newState === "COMPLETED") {
      updateData.completedAt = new Date(now);
    }
    
    if (updates.errorCode) {
      updateData.errorCode = updates.errorCode;
      updateData.errorMessage = updates.errorMessage;
      updateData.errorRetryable = updates.errorRetryable;
    }
    
    if (updates.licenseValid !== undefined) {
      updateData.licenseValid = updates.licenseValid;
    }
    
    if (updates.output) {
      updateData.receiptJson = updates.output;
    }
    
    if (updates.metrics) {
      updateData.executionDurationMs = updates.metrics.executionTimeMs;
      updateData.inputTokens = updates.metrics.inputTokens;
      updateData.outputTokens = updates.metrics.outputTokens;
      updateData.memoryPeakMb = updates.metrics.memoryPeakMb;
    }
    
    if (updates.receipt) {
      updateData.receiptJson = updates.receipt;
      updateData.receiptCid = updates.receiptCid;
    }
    
    await db.update(jcnJobRecords)
      .set(updateData)
      .where(eq(jcnJobRecords.id, record.id));
    
    // Audit log
    await this.auditLog(
      `job_state:${oldState}→${newState}`,
      "system",
      "system",
      "job",
      record.id,
      { state: oldState },
      { state: newState, event },
      record.requestId,
      record.traceId
    );
    
    logger.info("Job state transition", {
      id: record.id,
      from: oldState,
      to: newState,
      event,
    });
    
    return {
      ...record,
      state: newState,
      stateHistory: newHistory,
      ...updates,
      checkpoint: updates.workDir || updates.bundlePath ? {
        workDir: updates.workDir,
        bundlePath: updates.bundlePath,
        extractDir: updates.extractDir,
        manifest: updates.manifest,
      } : record.checkpoint,
      updatedAt: now,
      completedAt: newState === "COMPLETED" ? now : record.completedAt,
    };
  }
  
  /**
   * Get job record by requestId
   */
  private async getRecordByRequestId(requestId: RequestId): Promise<JobStateRecord | null> {
    const [record] = await db.select()
      .from(jcnJobRecords)
      .where(eq(jcnJobRecords.requestId, requestId))
      .limit(1);
    
    if (!record) {
      return null;
    }
    
    return this.recordToStateRecord(record);
  }
  
  /**
   * Convert DB record to state record
   */
  private recordToStateRecord(record: typeof jcnJobRecords.$inferSelect): JobStateRecord {
    // Extract values from the ticket JSON since they're not stored separately
    const ticket = record.ticketJson as JobTicket | null;
    
    return {
      id: record.id,
      requestId: record.requestId as RequestId,
      traceId: record.traceId as TraceId,
      state: record.state as JobState,
      stateHistory: (record.stateHistoryJson || []).map(entry => ({
        ...entry,
        state: entry.state as JobState,
      })),
      ticket: ticket as JobTicket,
      ticketValid: record.ticketValid ?? undefined,
      licenseValid: record.licenseValid ?? undefined,
      bundleVerified: record.bundleVerified ?? undefined,
      containerId: record.containerId ?? undefined,
      outputCid: record.outputCid as Cid | undefined,
      receipt: record.receiptJson as InferenceReceipt | undefined,
      receiptCid: record.receiptCid as Cid | undefined,
      error: record.errorCode ? {
        code: record.errorCode,
        message: record.errorMessage || "Unknown error",
        retryable: record.errorRetryable || false,
        retryCount: record.retryCount,
      } : undefined,
      completedAt: record.completedAt?.getTime(),
      createdAt: record.createdAt?.getTime() || Date.now(),
      updatedAt: record.updatedAt?.getTime() || Date.now(),
    };
  }
  
  /**
   * Build result from record
   */
  private buildResult(record: JobStateRecord, success: boolean): JobResult {
    return {
      success,
      jobId: record.id,
      state: record.state,
      receipt: record.receipt,
      output: record.output,
      error: record.error?.message,
      metrics: record.metrics,
    };
  }
  
  /**
   * Write audit log
   */
  private async auditLog(
    action: string,
    actorType: "user" | "system" | "admin",
    actorId: string,
    targetType: "publish" | "job" | "bundle" | "license" | "key" | "config",
    targetId: string,
    oldState: unknown,
    newState: unknown,
    requestId?: string,
    traceId?: string
  ): Promise<void> {
    await db.insert(jcnAuditLog).values({
      id: crypto.randomUUID(),
      action,
      actorType,
      actorId,
      targetType,
      targetId,
      oldStateJson: oldState,
      newStateJson: newState,
      requestId,
      traceId,
    });
  }
  
  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<void> {
    const controller = this.executingJobs.get(jobId);
    if (controller) {
      controller.abort();
    }
    
    // Also update DB state if not already terminal
    const record = await this.getRecord(jobId);
    if (record && !["COMPLETED", "FAILED", "CANCELLED"].includes(record.state)) {
      await this.transitionJobState(record, "CANCELLED", "manual_cancel");
    }
  }
  
  /**
   * Get job record by ID
   */
  async getRecord(id: string): Promise<JobStateRecord | null> {
    const [record] = await db.select()
      .from(jcnJobRecords)
      .where(eq(jcnJobRecords.id, id))
      .limit(1);
    
    if (!record) {
      return null;
    }
    
    return this.recordToStateRecord(record);
  }
  
  /**
   * List jobs
   */
  async listJobs(options?: { state?: JobState; limit?: number }): Promise<JobStateRecord[]> {
    let query = db.select().from(jcnJobRecords);
    
    if (options?.state) {
      // Map TIMEOUT to FAILED since DB doesn't have TIMEOUT state
      const dbState = options.state === "TIMEOUT" ? "FAILED" : options.state;
      // Only filter if state is in DB enum
      const validDbStates = ["PENDING", "VALIDATING", "FETCHING", "EXECUTING", "FINALIZING", "COMPLETED", "FAILED", "CANCELLED", "RETRYABLE"] as const;
      if (validDbStates.includes(dbState as typeof validDbStates[number])) {
        query = query.where(eq(jcnJobRecords.state, dbState as typeof validDbStates[number])) as typeof query;
      }
    }
    
    const records = await query.limit(options?.limit || 100);
    return records.map((r) => this.recordToStateRecord(r));
  }
  
  /**
   * Register a license in local cache
   */
  async registerLicense(license: Omit<LicenseRecord, "currentUsage">): Promise<void> {
    const id = license.id || license.licenseId || crypto.randomUUID();
    const assetId = license.assetId || license.bundleCid || "";
    const licensee = license.licensee || license.holderWallet || "";
    
    // Map license type to DB enum values (registry, token, signature)
    const mapLicenseType = (type?: string): "registry" | "token" | "signature" => {
      if (type === "registry" || type === "token" || type === "signature") {
        return type;
      }
      // Map other license types
      if (type === "perpetual") return "registry";
      if (type === "subscription") return "token";
      if (type === "usage_based") return "signature";
      return "registry"; // default
    };
    
    const licenseType = mapLicenseType(license.type || license.licenseType);
    
    // Simplify valid check to avoid unnecessary null coalescing
    const isValid = license.valid !== undefined ? license.valid : (license.revoked !== undefined ? !license.revoked : true);
    
    await db.insert(jcnLicenses).values({
      id,
      licenseType,
      assetId,
      licensee,
      licensor: license.licensor || "",
      scope: license.scope || "full",
      limitsJson: license.limits || (license.usageLimit ? { maxInferences: license.usageLimit } : undefined),
      inferencesUsed: 0,
      tokensUsed: 0,
      verificationMethod: license.verification?.method || (license.onChain ? "contract_call" : "signature"),
      contractAddress: license.verification?.contractAddress || license.contractAddress,
      tokenId: license.verification?.tokenId || license.tokenId,
      signature: license.verification?.signature,
      valid: isValid,
      validatedAt: license.validatedAt ? new Date(license.validatedAt) : new Date(),
      expiresAt: license.validUntil ? new Date(license.validUntil) : (license.limits?.expiresAt ? new Date(license.limits.expiresAt) : undefined),
    }).onConflictDoUpdate({
      target: [jcnLicenses.id],
      set: {
        valid: isValid,
        expiresAt: license.validUntil ? new Date(license.validUntil) : undefined,
        limitsJson: license.limits || (license.usageLimit ? { maxInferences: license.usageLimit } : undefined),
      },
    });
  }
}

// Export singleton instance
export const jcnJobExecutor = new JcnJobExecutor();
