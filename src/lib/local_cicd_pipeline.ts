/**
 * Local CI/CD Pipeline
 * Build, test, and deploy applications without external CI services.
 * Supports Node.js, Python, Rust, Go, and Docker workflows.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync, createWriteStream } from "fs";
import { spawn, ChildProcess, exec } from "child_process";
import { promisify } from "util";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";

import type {
  PipelineId,
  Pipeline,
  PipelineStep,
  PipelineRun,
  StepResult,
  PipelineTrigger,
  ArtifactConfig,
} from "@/types/sovereign_stack_types";

const execAsync = promisify(exec);
const logger = log.scope("local_cicd_pipeline");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PIPELINES_DIR = path.join(app.getPath("userData"), "pipelines");
const MAX_CONCURRENT_RUNS = 3;
const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// =============================================================================
// PIPELINE TEMPLATES
// =============================================================================

interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  language: string;
  steps: PipelineStep[];
}

const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: "nodejs-basic",
    name: "Node.js Basic",
    description: "Basic Node.js build and test pipeline",
    language: "nodejs",
    steps: [
      {
        id: "install",
        name: "Install Dependencies",
        command: "npm ci",
        continueOnError: false,
        timeout: 300000,
      },
      {
        id: "lint",
        name: "Lint",
        command: "npm run lint",
        continueOnError: true,
        timeout: 120000,
      },
      {
        id: "test",
        name: "Run Tests",
        command: "npm test",
        continueOnError: false,
        timeout: 600000,
      },
      {
        id: "build",
        name: "Build",
        command: "npm run build",
        continueOnError: false,
        timeout: 300000,
      },
    ],
  },
  {
    id: "python-basic",
    name: "Python Basic",
    description: "Basic Python test and lint pipeline",
    language: "python",
    steps: [
      {
        id: "venv",
        name: "Create Virtual Environment",
        command: "python -m venv .venv",
        continueOnError: false,
        timeout: 60000,
      },
      {
        id: "install",
        name: "Install Dependencies",
        command: ".venv/bin/pip install -r requirements.txt",
        windowsCommand: ".venv\\Scripts\\pip install -r requirements.txt",
        continueOnError: false,
        timeout: 300000,
      },
      {
        id: "lint",
        name: "Lint with Ruff",
        command: ".venv/bin/ruff check .",
        windowsCommand: ".venv\\Scripts\\ruff check .",
        continueOnError: true,
        timeout: 120000,
      },
      {
        id: "test",
        name: "Run Tests",
        command: ".venv/bin/pytest",
        windowsCommand: ".venv\\Scripts\\pytest",
        continueOnError: false,
        timeout: 600000,
      },
    ],
  },
  {
    id: "docker-build",
    name: "Docker Build & Push",
    description: "Build and push Docker images",
    language: "docker",
    steps: [
      {
        id: "build",
        name: "Build Docker Image",
        command: "docker build -t $IMAGE_NAME:$IMAGE_TAG .",
        continueOnError: false,
        timeout: 600000,
        env: {
          IMAGE_NAME: "my-app",
          IMAGE_TAG: "latest",
        },
      },
      {
        id: "test",
        name: "Test Image",
        command: "docker run --rm $IMAGE_NAME:$IMAGE_TAG echo 'Container works!'",
        continueOnError: false,
        timeout: 60000,
      },
      {
        id: "push",
        name: "Push to Registry",
        command: "docker push $IMAGE_NAME:$IMAGE_TAG",
        continueOnError: false,
        timeout: 300000,
        condition: "env.PUSH_TO_REGISTRY === 'true'",
      },
    ],
  },
  {
    id: "rust-cargo",
    name: "Rust Cargo",
    description: "Rust build, test, and clippy pipeline",
    language: "rust",
    steps: [
      {
        id: "check",
        name: "Cargo Check",
        command: "cargo check",
        continueOnError: false,
        timeout: 300000,
      },
      {
        id: "clippy",
        name: "Clippy Lint",
        command: "cargo clippy -- -D warnings",
        continueOnError: true,
        timeout: 300000,
      },
      {
        id: "test",
        name: "Run Tests",
        command: "cargo test",
        continueOnError: false,
        timeout: 600000,
      },
      {
        id: "build",
        name: "Build Release",
        command: "cargo build --release",
        continueOnError: false,
        timeout: 600000,
      },
    ],
  },
  {
    id: "go-basic",
    name: "Go Basic",
    description: "Go build and test pipeline",
    language: "go",
    steps: [
      {
        id: "mod",
        name: "Download Dependencies",
        command: "go mod download",
        continueOnError: false,
        timeout: 300000,
      },
      {
        id: "vet",
        name: "Go Vet",
        command: "go vet ./...",
        continueOnError: true,
        timeout: 120000,
      },
      {
        id: "test",
        name: "Run Tests",
        command: "go test -v ./...",
        continueOnError: false,
        timeout: 600000,
      },
      {
        id: "build",
        name: "Build",
        command: "go build -o ./bin/app ./...",
        continueOnError: false,
        timeout: 300000,
      },
    ],
  },
  {
    id: "ipfs-deploy",
    name: "IPFS Deploy",
    description: "Build and deploy to IPFS",
    language: "nodejs",
    steps: [
      {
        id: "install",
        name: "Install Dependencies",
        command: "npm ci",
        continueOnError: false,
        timeout: 300000,
      },
      {
        id: "build",
        name: "Build",
        command: "npm run build",
        continueOnError: false,
        timeout: 300000,
      },
      {
        id: "ipfs-add",
        name: "Add to IPFS",
        command: "ipfs add -r --pin ./dist",
        continueOnError: false,
        timeout: 300000,
      },
    ],
  },
];

// =============================================================================
// LOCAL CI/CD PIPELINE SERVICE
// =============================================================================

export class LocalCICDPipeline extends EventEmitter {
  private pipelinesDir: string;
  private pipelines: Map<PipelineId, Pipeline> = new Map();
  private runs: Map<string, PipelineRun> = new Map();
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private runQueue: Array<{ pipelineId: PipelineId; env: Record<string, string> }> = [];
  
  constructor(pipelinesDir?: string) {
    super();
    this.pipelinesDir = pipelinesDir || DEFAULT_PIPELINES_DIR;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing local CI/CD pipeline", { pipelinesDir: this.pipelinesDir });
    
    await fs.mkdir(this.pipelinesDir, { recursive: true });
    await this.scanPipelines();
    
    logger.info("CI/CD pipeline initialized", { pipelineCount: this.pipelines.size });
  }
  
  private async scanPipelines(): Promise<void> {
    const entries = await fs.readdir(this.pipelinesDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const configPath = path.join(this.pipelinesDir, entry.name, "pipeline.json");
        
        if (existsSync(configPath)) {
          try {
            const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
            this.pipelines.set(config.id as PipelineId, config);
          } catch (error) {
            logger.warn("Failed to load pipeline config", { path: configPath, error });
          }
        }
      }
    }
    
    // Also scan for runs
    for (const [pipelineId, pipeline] of this.pipelines) {
      const runsDir = path.join(this.pipelinesDir, pipelineId, "runs");
      if (existsSync(runsDir)) {
        const runDirs = await fs.readdir(runsDir, { withFileTypes: true });
        for (const runDir of runDirs) {
          if (runDir.isDirectory()) {
            const runPath = path.join(runsDir, runDir.name, "run.json");
            if (existsSync(runPath)) {
              try {
                const run = JSON.parse(await fs.readFile(runPath, "utf-8"));
                this.runs.set(run.id, run);
              } catch {}
            }
          }
        }
      }
    }
  }
  
  // ===========================================================================
  // TEMPLATES
  // ===========================================================================
  
  getTemplates(): PipelineTemplate[] {
    return PIPELINE_TEMPLATES;
  }
  
  getTemplate(id: string): PipelineTemplate | null {
    return PIPELINE_TEMPLATES.find((t) => t.id === id) || null;
  }
  
  // ===========================================================================
  // PIPELINE MANAGEMENT
  // ===========================================================================
  
  async createPipeline(params: {
    name: string;
    description?: string;
    workingDirectory: string;
    templateId?: string;
    steps?: PipelineStep[];
    triggers?: PipelineTrigger[];
    env?: Record<string, string>;
    artifacts?: ArtifactConfig[];
  }): Promise<Pipeline> {
    const id = crypto.randomUUID() as PipelineId;
    const pipelineDir = path.join(this.pipelinesDir, id);
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.mkdir(path.join(pipelineDir, "runs"), { recursive: true });
    await fs.mkdir(path.join(pipelineDir, "artifacts"), { recursive: true });
    
    let steps = params.steps || [];
    
    if (params.templateId) {
      const template = this.getTemplate(params.templateId);
      if (template) {
        steps = template.steps;
      }
    }
    
    const pipeline: Pipeline = {
      id,
      name: params.name,
      description: params.description,
      workingDirectory: params.workingDirectory,
      steps,
      triggers: params.triggers || [],
      env: params.env || {},
      artifacts: params.artifacts || [],
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.savePipeline(pipeline);
    this.pipelines.set(id, pipeline);
    this.emit("pipeline:created", pipeline);
    
    return pipeline;
  }
  
  async savePipeline(pipeline: Pipeline): Promise<void> {
    const pipelineDir = path.join(this.pipelinesDir, pipeline.id);
    await fs.mkdir(pipelineDir, { recursive: true });
    
    pipeline.updatedAt = Date.now();
    await fs.writeFile(
      path.join(pipelineDir, "pipeline.json"),
      JSON.stringify(pipeline, null, 2)
    );
    
    this.pipelines.set(pipeline.id, pipeline);
  }
  
  listPipelines(): Pipeline[] {
    return Array.from(this.pipelines.values());
  }
  
  getPipeline(id: PipelineId): Pipeline | null {
    return this.pipelines.get(id) || null;
  }
  
  async updatePipeline(id: PipelineId, updates: Partial<Pipeline>): Promise<Pipeline> {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${id}`);
    }
    
    Object.assign(pipeline, updates);
    await this.savePipeline(pipeline);
    this.emit("pipeline:updated", pipeline);
    
    return pipeline;
  }
  
  async deletePipeline(id: PipelineId): Promise<void> {
    // Cancel any running runs
    for (const [runId, run] of this.runs) {
      if (run.pipelineId === id && run.status === "running") {
        await this.cancelRun(runId);
      }
    }
    
    const pipelineDir = path.join(this.pipelinesDir, id);
    if (existsSync(pipelineDir)) {
      await fs.rm(pipelineDir, { recursive: true, force: true });
    }
    
    this.pipelines.delete(id);
    this.emit("pipeline:deleted", { id });
  }
  
  // ===========================================================================
  // STEP MANAGEMENT
  // ===========================================================================
  
  async addStep(pipelineId: PipelineId, step: PipelineStep): Promise<Pipeline> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    
    // Generate ID if not provided
    if (!step.id) {
      step.id = crypto.randomUUID();
    }
    
    pipeline.steps.push(step);
    await this.savePipeline(pipeline);
    
    return pipeline;
  }
  
  async updateStep(pipelineId: PipelineId, stepId: string, updates: Partial<PipelineStep>): Promise<Pipeline> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    
    const stepIndex = pipeline.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      throw new Error(`Step not found: ${stepId}`);
    }
    
    pipeline.steps[stepIndex] = { ...pipeline.steps[stepIndex], ...updates };
    await this.savePipeline(pipeline);
    
    return pipeline;
  }
  
  async removeStep(pipelineId: PipelineId, stepId: string): Promise<Pipeline> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    
    pipeline.steps = pipeline.steps.filter((s) => s.id !== stepId);
    await this.savePipeline(pipeline);
    
    return pipeline;
  }
  
  async reorderSteps(pipelineId: PipelineId, stepIds: string[]): Promise<Pipeline> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    
    const reordered: PipelineStep[] = [];
    for (const stepId of stepIds) {
      const step = pipeline.steps.find((s) => s.id === stepId);
      if (step) {
        reordered.push(step);
      }
    }
    
    pipeline.steps = reordered;
    await this.savePipeline(pipeline);
    
    return pipeline;
  }
  
  // ===========================================================================
  // PIPELINE EXECUTION
  // ===========================================================================
  
  async triggerRun(pipelineId: PipelineId, params?: {
    env?: Record<string, string>;
    branch?: string;
    commit?: string;
    trigger?: string;
  }): Promise<PipelineRun> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    
    if (!pipeline.enabled) {
      throw new Error("Pipeline is disabled");
    }
    
    const runId = crypto.randomUUID();
    const runNumber = (pipeline.lastRunNumber || 0) + 1;
    
    const run: PipelineRun = {
      id: runId,
      pipelineId,
      runNumber,
      status: "pending",
      trigger: params?.trigger || "manual",
      branch: params?.branch,
      commit: params?.commit,
      env: { ...pipeline.env, ...params?.env },
      steps: pipeline.steps.map((step) => ({
        stepId: step.id,
        name: step.name,
        status: "pending",
      })),
      startedAt: Date.now(),
    };
    
    // Save run
    const runDir = path.join(this.pipelinesDir, pipelineId, "runs", runId);
    await fs.mkdir(runDir, { recursive: true });
    await this.saveRun(run);
    
    // Update pipeline
    pipeline.lastRunNumber = runNumber;
    pipeline.lastRunAt = Date.now();
    await this.savePipeline(pipeline);
    
    this.runs.set(runId, run);
    this.emit("run:created", run);
    
    // Queue or start immediately
    const runningCount = this.countRunningRuns();
    if (runningCount < MAX_CONCURRENT_RUNS) {
      this.executeRun(run);
    } else {
      this.runQueue.push({ pipelineId, env: params?.env || {} });
      logger.info("Run queued", { runId, queuePosition: this.runQueue.length });
    }
    
    return run;
  }
  
  private async executeRun(run: PipelineRun): Promise<void> {
    const pipeline = this.pipelines.get(run.pipelineId);
    if (!pipeline) {
      run.status = "failed";
      run.error = "Pipeline not found";
      await this.saveRun(run);
      return;
    }
    
    logger.info("Executing pipeline run", { runId: run.id, pipelineId: run.pipelineId });
    
    run.status = "running";
    await this.saveRun(run);
    this.emit("run:started", run);
    
    const runDir = path.join(this.pipelinesDir, run.pipelineId, "runs", run.id);
    const logsDir = path.join(runDir, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    
    let allPassed = true;
    
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      const stepResult = run.steps[i];
      
      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, run.env)) {
        stepResult.status = "skipped";
        stepResult.skippedReason = "Condition not met";
        continue;
      }
      
      // Check if should skip on previous failure
      if (!allPassed && !step.continueOnError) {
        stepResult.status = "skipped";
        stepResult.skippedReason = "Previous step failed";
        continue;
      }
      
      stepResult.status = "running";
      stepResult.startedAt = Date.now();
      await this.saveRun(run);
      this.emit("step:started", { runId: run.id, stepId: step.id });
      
      const logFile = path.join(logsDir, `${step.id}.log`);
      const logStream = createWriteStream(logFile);
      
      try {
        const result = await this.executeStep(step, pipeline.workingDirectory, run.env, logStream);
        
        stepResult.status = result.success ? "success" : "failed";
        stepResult.exitCode = result.exitCode;
        stepResult.duration = Date.now() - stepResult.startedAt!;
        stepResult.output = result.output;
        stepResult.logFile = logFile;
        
        if (!result.success) {
          allPassed = false;
          if (!step.continueOnError) {
            stepResult.error = result.error;
          }
        }
      } catch (error) {
        stepResult.status = "failed";
        stepResult.error = error instanceof Error ? error.message : String(error);
        stepResult.duration = Date.now() - stepResult.startedAt!;
        allPassed = false;
      }
      
      logStream.close();
      
      await this.saveRun(run);
      this.emit("step:completed", { runId: run.id, stepId: step.id, result: stepResult });
      
      // Cancel if cancelled externally
      if (run.status === "cancelled") {
        break;
      }
    }
    
    // Collect artifacts
    if (pipeline.artifacts && allPassed) {
      await this.collectArtifacts(run, pipeline);
    }
    
    // Finalize run
    run.status = run.status === "cancelled" ? "cancelled" : allPassed ? "success" : "failed";
    run.finishedAt = Date.now();
    run.duration = run.finishedAt - run.startedAt!;
    
    await this.saveRun(run);
    this.emit("run:completed", run);
    
    logger.info("Pipeline run completed", {
      runId: run.id,
      status: run.status,
      duration: run.duration,
    });
    
    // Process queue
    this.processQueue();
  }
  
  private async executeStep(
    step: PipelineStep,
    workingDirectory: string,
    env: Record<string, string>,
    logStream: fs.FileHandle | NodeJS.WritableStream
  ): Promise<{ success: boolean; exitCode: number; output: string; error?: string }> {
    return new Promise((resolve) => {
      const isWindows = process.platform === "win32";
      const command = isWindows && step.windowsCommand ? step.windowsCommand : step.command;
      
      // Expand environment variables in command
      const expandedCommand = this.expandEnvVars(command, env);
      
      const shellCommand = isWindows ? "cmd.exe" : "/bin/bash";
      const shellArgs = isWindows ? ["/c", expandedCommand] : ["-c", expandedCommand];
      
      const proc = spawn(shellCommand, shellArgs, {
        cwd: workingDirectory,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      
      this.runningProcesses.set(step.id, proc);
      
      let output = "";
      let errorOutput = "";
      
      proc.stdout?.on("data", (data) => {
        const text = data.toString();
        output += text;
        if ("write" in logStream) {
          logStream.write(text);
        }
      });
      
      proc.stderr?.on("data", (data) => {
        const text = data.toString();
        errorOutput += text;
        if ("write" in logStream) {
          logStream.write(`[STDERR] ${text}`);
        }
      });
      
      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({
          success: false,
          exitCode: -1,
          output: output + errorOutput,
          error: `Step timed out after ${step.timeout || DEFAULT_TIMEOUT}ms`,
        });
      }, step.timeout || DEFAULT_TIMEOUT);
      
      proc.on("close", (code) => {
        clearTimeout(timeout);
        this.runningProcesses.delete(step.id);
        
        resolve({
          success: code === 0,
          exitCode: code || 0,
          output: output + errorOutput,
          error: code !== 0 ? errorOutput || `Exit code: ${code}` : undefined,
        });
      });
      
      proc.on("error", (err) => {
        clearTimeout(timeout);
        this.runningProcesses.delete(step.id);
        
        resolve({
          success: false,
          exitCode: -1,
          output: output + errorOutput,
          error: err.message,
        });
      });
    });
  }
  
  private async collectArtifacts(run: PipelineRun, pipeline: Pipeline): Promise<void> {
    const artifactsDir = path.join(this.pipelinesDir, run.pipelineId, "runs", run.id, "artifacts");
    await fs.mkdir(artifactsDir, { recursive: true });
    
    run.artifacts = [];
    
    for (const artifact of pipeline.artifacts || []) {
      const sourcePath = path.join(pipeline.workingDirectory, artifact.path);
      
      if (!existsSync(sourcePath)) {
        logger.warn("Artifact not found", { path: sourcePath });
        continue;
      }
      
      const destPath = path.join(artifactsDir, artifact.name);
      
      try {
        const stat = await fs.stat(sourcePath);
        if (stat.isDirectory()) {
          await this.copyDirectory(sourcePath, destPath);
        } else {
          await fs.copyFile(sourcePath, destPath);
        }
        
        run.artifacts.push({
          name: artifact.name,
          path: destPath,
          size: stat.size,
        });
      } catch (error) {
        logger.warn("Failed to collect artifact", { artifact: artifact.name, error });
      }
    }
  }
  
  async cancelRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    
    if (run.status !== "running" && run.status !== "pending") {
      throw new Error(`Run is not running: ${run.status}`);
    }
    
    logger.info("Cancelling run", { runId });
    
    run.status = "cancelled";
    
    // Kill running processes
    for (const stepResult of run.steps) {
      if (stepResult.status === "running") {
        const proc = this.runningProcesses.get(stepResult.stepId);
        if (proc) {
          proc.kill("SIGTERM");
        }
        stepResult.status = "cancelled";
      }
    }
    
    await this.saveRun(run);
    this.emit("run:cancelled", run);
  }
  
  // ===========================================================================
  // RUN HISTORY
  // ===========================================================================
  
  listRuns(pipelineId?: PipelineId): PipelineRun[] {
    const runs = Array.from(this.runs.values());
    
    if (pipelineId) {
      return runs
        .filter((r) => r.pipelineId === pipelineId)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    }
    
    return runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }
  
  getRun(runId: string): PipelineRun | null {
    return this.runs.get(runId) || null;
  }
  
  async getRunLogs(runId: string, stepId?: string): Promise<string> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    
    const logsDir = path.join(this.pipelinesDir, run.pipelineId, "runs", runId, "logs");
    
    if (stepId) {
      const logFile = path.join(logsDir, `${stepId}.log`);
      if (existsSync(logFile)) {
        return fs.readFile(logFile, "utf-8");
      }
      return "";
    }
    
    // Combine all logs
    let combinedLogs = "";
    for (const stepResult of run.steps) {
      const logFile = path.join(logsDir, `${stepResult.stepId}.log`);
      if (existsSync(logFile)) {
        combinedLogs += `\n=== ${stepResult.name} ===\n`;
        combinedLogs += await fs.readFile(logFile, "utf-8");
      }
    }
    
    return combinedLogs;
  }
  
  async deleteRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    
    if (run.status === "running") {
      await this.cancelRun(runId);
    }
    
    const runDir = path.join(this.pipelinesDir, run.pipelineId, "runs", runId);
    if (existsSync(runDir)) {
      await fs.rm(runDir, { recursive: true, force: true });
    }
    
    this.runs.delete(runId);
    this.emit("run:deleted", { runId });
  }
  
  // ===========================================================================
  // TRIGGERS
  // ===========================================================================
  
  async setupTrigger(pipelineId: PipelineId, trigger: PipelineTrigger): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    
    // Generate ID if not provided
    if (!trigger.id) {
      trigger.id = crypto.randomUUID();
    }
    
    trigger.enabled = true;
    pipeline.triggers.push(trigger);
    
    // Set up trigger based on type
    switch (trigger.type) {
      case "schedule":
        // In production, this would set up a cron job
        logger.info("Scheduled trigger configured", { pipelineId, schedule: trigger.schedule });
        break;
      
      case "webhook":
        // Generate webhook secret
        trigger.webhookSecret = crypto.randomBytes(32).toString("hex");
        logger.info("Webhook trigger configured", { pipelineId });
        break;
      
      case "file-watch":
        // In production, this would set up file watchers
        logger.info("File watch trigger configured", { pipelineId, patterns: trigger.patterns });
        break;
    }
    
    await this.savePipeline(pipeline);
  }
  
  async removeTrigger(pipelineId: PipelineId, triggerId: string): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    
    pipeline.triggers = pipeline.triggers.filter((t) => t.id !== triggerId);
    await this.savePipeline(pipeline);
  }
  
  // ===========================================================================
  // HELPERS
  // ===========================================================================
  
  private async saveRun(run: PipelineRun): Promise<void> {
    const runDir = path.join(this.pipelinesDir, run.pipelineId, "runs", run.id);
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, "run.json"), JSON.stringify(run, null, 2));
    this.runs.set(run.id, run);
  }
  
  private countRunningRuns(): number {
    return Array.from(this.runs.values()).filter((r) => r.status === "running").length;
  }
  
  private processQueue(): void {
    if (this.runQueue.length === 0) return;
    
    const runningCount = this.countRunningRuns();
    if (runningCount >= MAX_CONCURRENT_RUNS) return;
    
    const next = this.runQueue.shift();
    if (next) {
      this.triggerRun(next.pipelineId, { env: next.env });
    }
  }
  
  private expandEnvVars(command: string, env: Record<string, string>): string {
    return command.replace(/\$(\w+)/g, (_, name) => env[name] || "");
  }
  
  private evaluateCondition(condition: string, env: Record<string, string>): boolean {
    try {
      // Simple condition evaluation
      // In production, use a proper expression parser
      const func = new Function("env", `return ${condition}`);
      return func(env);
    } catch {
      return true;
    }
  }
  
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
  
  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    // Cancel all running runs
    for (const [runId, run] of this.runs) {
      if (run.status === "running") {
        try {
          await this.cancelRun(runId);
        } catch {}
      }
    }
    
    // Kill all running processes
    for (const proc of this.runningProcesses.values()) {
      proc.kill("SIGTERM");
    }
    this.runningProcesses.clear();
  }
}

// Export singleton
export const localCICDPipeline = new LocalCICDPipeline();
