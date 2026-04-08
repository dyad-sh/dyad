/**
 * n8n Integration Service
 * Connects agents to n8n for workflow automation
 */

import { IpcMainInvokeEvent, ipcMain } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "node:path";
import fs from "fs-extra";
import log from "electron-log";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserDataPath } from "@/paths/paths";
import { getOllamaApiUrl } from "@/ipc/handlers/local_model_ollama_handler";
import { readSettings } from "@/main/settings";

import type {
  N8nWorkflow,
  N8nNode,
  N8nConnections,
  N8nApiConfig,
  N8nExecutionResult,
  WorkflowBuildRequest,
  WorkflowGenerationRequest,
  WorkflowGenerationResult,
  AgentMessage,
  AgentCollaboration,
  N8N_NODE_TYPES,
} from "@/types/n8n_types";

const logger = log.scope("n8n_integration");

// ============================================================================
// n8n Configuration Types
// ============================================================================

export interface N8nDatabaseConfig {
  type: "sqlite" | "postgresdb";
  // PostgreSQL specific
  postgresHost?: string;
  postgresPort?: number;
  postgresDatabase?: string;
  postgresUser?: string;
  postgresPassword?: string;
  postgresSchema?: string;
  postgresSsl?: boolean;
}

// Default to SQLite for simplicity - no external database server needed
// Users can switch to PostgreSQL in settings if they have it configured
let n8nDbConfig: N8nDatabaseConfig = {
  type: "sqlite",
};

// ============================================================================
// Local Workflow Store (fallback when n8n is unavailable / unauthenticated)
// ============================================================================

interface LocalWorkflowEntry {
  workflow: N8nWorkflow;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

const localWorkflows = new Map<string, LocalWorkflowEntry>();
let localIdCounter = 1000;

function getLocalStoreFile(): string {
  return path.join(getUserDataPath(), "n8n", "local_workflows.json");
}

async function loadLocalWorkflows(): Promise<void> {
  try {
    const file = getLocalStoreFile();
    if (await fs.pathExists(file)) {
      const data = JSON.parse(await fs.readFile(file, "utf-8"));
      localWorkflows.clear();
      for (const [id, entry] of Object.entries(data.workflows || {})) {
        localWorkflows.set(id, entry as LocalWorkflowEntry);
      }
      localIdCounter = data.nextId || 1000;
      logger.info(`Loaded ${localWorkflows.size} local workflows`);
    }
  } catch (err) {
    logger.warn("Failed to load local workflows:", err);
  }
}

async function saveLocalWorkflows(): Promise<void> {
  try {
    const file = getLocalStoreFile();
    await fs.ensureDir(path.dirname(file));
    const data: Record<string, unknown> = { nextId: localIdCounter, workflows: {} };
    const wfObj = data.workflows as Record<string, LocalWorkflowEntry>;
    for (const [id, entry] of localWorkflows) {
      wfObj[id] = entry;
    }
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    logger.warn("Failed to save local workflows:", err);
  }
}

function nextLocalId(): string {
  return `local-${localIdCounter++}`;
}

// ============================================================================
// n8n Process Management
// ============================================================================

let n8nProcess: ChildProcess | null = null;
let n8nConfig: N8nApiConfig = {
  baseUrl: "http://localhost:5678",
  apiKey: "",
};

/**
 * Fetch the owner API key from the local n8n instance.
 * n8n >= 1.x exposes GET /api/v1/me which returns the logged-in user,
 * but only after an API key has been created, so we attempt a no-auth
 * health probe first. If n8n responds without auth, we leave apiKey
 * empty (no auth needed for local). If it 401s on /api/v1/workflows
 * we try to fall back to any persisted key.
 */
async function refreshN8nApiKey(): Promise<void> {
  try {
    // Try a real API call without auth — local n8n usually has no auth
    const res = await fetch(`${n8nConfig.baseUrl}/api/v1/workflows?limit=1`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      // No auth needed — clear any stale key
      n8nConfig.apiKey = "";
      return;
    }
    // If 401, look for a persisted key in userdata
    if (res.status === 401) {
      const keyFile = path.join(getUserDataPath(), "n8n", "api_key.txt");
      if (await fs.pathExists(keyFile)) {
        n8nConfig.apiKey = (await fs.readFile(keyFile, "utf-8")).trim();
        logger.info("Loaded n8n API key from persisted file");
      } else {
        logger.warn("n8n requires auth but no API key is persisted — requests will fail");
      }
    }
  } catch {
    // n8n not reachable
  }
}

/**
 * Configure n8n database settings
 */
export function configureN8nDatabase(config: Partial<N8nDatabaseConfig>): void {
  n8nDbConfig = { ...n8nDbConfig, ...config };
  logger.info("n8n database configured:", { type: n8nDbConfig.type });
}

/**
 * Get environment variables for n8n database
 */
function getN8nDatabaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  
  if (n8nDbConfig.type === "postgresdb") {
    env.DB_TYPE = "postgresdb";
    env.DB_POSTGRESDB_HOST = n8nDbConfig.postgresHost || "localhost";
    env.DB_POSTGRESDB_PORT = String(n8nDbConfig.postgresPort || 5432);
    env.DB_POSTGRESDB_DATABASE = n8nDbConfig.postgresDatabase || "n8n";
    env.DB_POSTGRESDB_USER = n8nDbConfig.postgresUser || "postgres";
    env.DB_POSTGRESDB_PASSWORD = n8nDbConfig.postgresPassword || "postgres";
    env.DB_POSTGRESDB_SCHEMA = n8nDbConfig.postgresSchema || "public";
    if (n8nDbConfig.postgresSsl) {
      env.DB_POSTGRESDB_SSL_ENABLED = "true";
    }
  } else {
    // SQLite fallback - store in user data directory
    env.DB_TYPE = "sqlite";
    env.DB_SQLITE_DATABASE = path.join(getUserDataPath(), "n8n.sqlite");
  }
  
  return env;
}

export async function startN8n(): Promise<{ success: boolean; error?: string }> {
  if (n8nProcess) {
    return { success: true };
  }

  try {
    logger.info("Starting n8n with database type:", n8nDbConfig.type);
    
    const dbEnv = getN8nDatabaseEnv();
    
    // Use npx to run n8n
    n8nProcess = spawn("npx", ["n8n", "start"], {
      shell: true,
      env: {
        ...process.env,
        ...dbEnv,
        N8N_PORT: "5678",
        N8N_PROTOCOL: "http",
        N8N_HOST: "localhost",
        GENERIC_TIMEZONE: "UTC",
        N8N_SECURE_COOKIE: "false",
        // User data directory for n8n
        N8N_USER_FOLDER: path.join(getUserDataPath(), "n8n"),
      },
      detached: false,
    });

    n8nProcess.stdout?.on("data", (data) => {
      logger.info(`n8n: ${data}`);
    });

    n8nProcess.stderr?.on("data", (data) => {
      logger.error(`n8n error: ${data}`);
    });

    n8nProcess.on("close", (code) => {
      logger.info(`n8n process exited with code ${code}`);
      n8nProcess = null;
    });

    // Wait for n8n to be ready
    await waitForN8n();
    
    return { success: true };
  } catch (error) {
    logger.error("Failed to start n8n:", error);
    return { success: false, error: String(error) };
  }
}

export async function stopN8n(): Promise<void> {
  if (n8nProcess) {
    n8nProcess.kill();
    n8nProcess = null;
    logger.info("n8n stopped");
  }
}

async function waitForN8n(maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${n8nConfig.baseUrl}/healthz`);
      if (response.ok) {
        logger.info("n8n is ready");
        await refreshN8nApiKey();
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("n8n failed to start within timeout");
}

export function isN8nRunning(): boolean {
  // If we started n8n ourselves, trust the process handle
  if (n8nProcess !== null) return true;
  // Otherwise, do a quick synchronous check — caller should prefer checkN8nAvailable() for accuracy
  return false;
}

/** Async check: is n8n actually responding on its port? Works even if started externally. */
export async function isN8nReachable(): Promise<boolean> {
  if (n8nProcess !== null) return true;
  try {
    const response = await fetch(`${n8nConfig.baseUrl}/healthz`, {
      signal: AbortSignal.timeout(2000),
      redirect: "manual",
    });
    // Any HTTP response means n8n is up (even 401/302)
    return response.status > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// n8n API Client
// ============================================================================

async function n8nApiRequest<T>(
  method: string,
  endpoint: string,
  body?: unknown,
  timeoutMs: number = 10000
): Promise<T> {
  const url = `${n8nConfig.baseUrl}/api/v1${endpoint}`;
  
  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (n8nConfig.apiKey) h["X-N8N-API-KEY"] = n8nConfig.apiKey;
    return h;
  };

  const doFetch = async (headers: Record<string, string>) =>
    fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

  try {
    let response = await doFetch(buildHeaders());

    // On 401, try refreshing the API key and retry once
    if (response.status === 401) {
      await refreshN8nApiKey();
      response = await doFetch(buildHeaders());
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`n8n API error: ${response.status} - ${error}`);
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`n8n API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ============================================================================
// Workflow Management
// ============================================================================

/**
 * Check if n8n is available AND authenticated for API calls.
 * Tries a lightweight API call — if 401 auto-refreshes the key once.
 */
async function checkN8nApiReady(): Promise<boolean> {
  try {
    const response = await fetch(`${n8nConfig.baseUrl}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;

    // Healthz is OK, but we also need auth to actually use the API.
    // Try a lightweight API call to confirm.
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (n8nConfig.apiKey) headers["X-N8N-API-KEY"] = n8nConfig.apiKey;
    const probe = await fetch(`${n8nConfig.baseUrl}/api/v1/workflows?limit=1`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (probe.ok) return true;

    // 401 → try refreshing the API key once
    if (probe.status === 401) {
      await refreshN8nApiKey();
      if (n8nConfig.apiKey) {
        const retry = await fetch(`${n8nConfig.baseUrl}/api/v1/workflows?limit=1`, {
          headers: { "Content-Type": "application/json", "X-N8N-API-KEY": n8nConfig.apiKey },
          signal: AbortSignal.timeout(3000),
        });
        return retry.ok;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Keep backwards-compatible healthz-only check for isN8nReachable usage
async function checkN8nAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${n8nConfig.baseUrl}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function createWorkflow(workflow: N8nWorkflow): Promise<N8nWorkflow | null> {
  // Try n8n API first
  if (await checkN8nApiReady()) {
    try {
      const payload = { settings: {}, ...workflow };
      return await n8nApiRequest<N8nWorkflow>("POST", "/workflows", payload);
    } catch (err) {
      logger.warn("n8n API create failed, saving locally:", err);
    }
  }

  // Fallback: save to local store
  const id = nextLocalId();
  const saved: N8nWorkflow = { ...workflow, id };
  localWorkflows.set(id, {
    workflow: saved,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: false,
  });
  await saveLocalWorkflows();
  logger.info(`Workflow saved locally: ${id} — ${workflow.name}`);
  return saved;
}

export async function updateWorkflow(id: string, workflow: N8nWorkflow): Promise<N8nWorkflow | null> {
  // n8n workflow
  if (!id.startsWith("local-")) {
    if (!await checkN8nApiReady()) {
      logger.warn("n8n not available, cannot update workflow");
      return null;
    }
    return n8nApiRequest<N8nWorkflow>("PATCH", `/workflows/${id}`, workflow);
  }

  // Local workflow
  const entry = localWorkflows.get(id);
  if (!entry) return null;
  entry.workflow = { ...workflow, id };
  entry.updatedAt = new Date().toISOString();
  await saveLocalWorkflows();
  return entry.workflow;
}

export async function getWorkflow(id: string): Promise<N8nWorkflow | null> {
  // Local workflow
  if (id.startsWith("local-")) {
    return localWorkflows.get(id)?.workflow ?? null;
  }
  if (!await checkN8nApiReady()) return null;
  return n8nApiRequest<N8nWorkflow>("GET", `/workflows/${id}`);
}

export async function listWorkflows(): Promise<{ data: N8nWorkflow[] }> {
  let n8nList: N8nWorkflow[] = [];
  if (await checkN8nApiReady()) {
    try {
      const result = await n8nApiRequest<{ data: N8nWorkflow[] }>("GET", "/workflows");
      n8nList = result.data || [];
    } catch (err) {
      logger.warn("n8n API list failed:", err);
    }
  }

  // Merge local workflows
  const localList = Array.from(localWorkflows.values()).map(e => ({
    ...e.workflow,
    active: e.active,
  }));

  return { data: [...n8nList, ...localList] };
}

export async function deleteWorkflow(id: string): Promise<{ success: boolean; error?: string }> {
  if (id.startsWith("local-")) {
    const deleted = localWorkflows.delete(id);
    if (deleted) await saveLocalWorkflows();
    return { success: deleted, error: deleted ? undefined : "Workflow not found" };
  }
  if (!await checkN8nApiReady()) {
    return { success: false, error: "n8n is not running or not authenticated" };
  }
  await n8nApiRequest<void>("DELETE", `/workflows/${id}`);
  return { success: true };
}

export async function activateWorkflow(id: string): Promise<N8nWorkflow | null> {
  if (id.startsWith("local-")) {
    const entry = localWorkflows.get(id);
    if (!entry) return null;
    entry.active = true;
    entry.updatedAt = new Date().toISOString();
    await saveLocalWorkflows();
    return { ...entry.workflow, active: true };
  }
  if (!await checkN8nApiReady()) {
    logger.warn("n8n not available, cannot activate workflow");
    return null;
  }
  return n8nApiRequest<N8nWorkflow>("POST", `/workflows/${id}/activate`);
}

export async function deactivateWorkflow(id: string): Promise<N8nWorkflow | null> {
  if (id.startsWith("local-")) {
    const entry = localWorkflows.get(id);
    if (!entry) return null;
    entry.active = false;
    entry.updatedAt = new Date().toISOString();
    await saveLocalWorkflows();
    return { ...entry.workflow, active: false };
  }
  if (!await checkN8nApiReady()) {
    logger.warn("n8n not available, cannot deactivate workflow");
    return null;
  }
  return n8nApiRequest<N8nWorkflow>("POST", `/workflows/${id}/deactivate`);
}

export async function executeWorkflow(id: string, data?: Record<string, unknown>): Promise<N8nExecutionResult | null> {
  if (id.startsWith("local-")) {
    // Local workflows can't actually execute, but we return a descriptive result
    const entry = localWorkflows.get(id);
    if (!entry) return null;
    return {
      finished: true,
      mode: "manual",
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      data: { resultData: { runData: {} } },
      status: "success",
    } as unknown as N8nExecutionResult;
  }
  if (!await checkN8nApiReady()) {
    logger.warn("n8n not available, cannot execute workflow");
    return null;
  }
  return n8nApiRequest<N8nExecutionResult>("POST", `/workflows/${id}/execute`, { data });
}

// ============================================================================
// AI-Powered Workflow Generation with NLP
// ============================================================================

/**
 * Call Ollama to generate workflow JSON from natural language
 */
async function callOllamaForWorkflow(prompt: string, model?: string): Promise<{ workflow: N8nWorkflow; explanation: string } | null> {
  const systemPrompt = `You are an expert n8n workflow designer. Given a natural language description, generate a valid n8n workflow JSON.

Available n8n node types:
TRIGGERS:
- n8n-nodes-base.manualTrigger - Manual execution
- n8n-nodes-base.webhook - HTTP webhook trigger
- n8n-nodes-base.scheduleTrigger - Cron/schedule trigger
- n8n-nodes-base.emailReadImap - Email trigger

ACTIONS:
- n8n-nodes-base.httpRequest - Make HTTP requests
- n8n-nodes-base.code - Custom JavaScript/Python code
- n8n-nodes-base.set - Set/transform data
- n8n-nodes-base.if - Conditional logic
- n8n-nodes-base.switch - Multi-way branching
- n8n-nodes-base.merge - Merge data streams
- n8n-nodes-base.splitInBatches - Process items in batches
- n8n-nodes-base.wait - Add delay
- n8n-nodes-base.noOp - No operation (placeholder)

INTEGRATIONS:
- n8n-nodes-base.openAi - OpenAI API (GPT, embeddings)
- @n8n/n8n-nodes-langchain.chainLlm - LangChain LLM
- @n8n/n8n-nodes-langchain.agent - AI Agent
- n8n-nodes-base.slack - Slack messaging
- n8n-nodes-base.discord - Discord messaging
- n8n-nodes-base.telegram - Telegram messaging
- n8n-nodes-base.emailSend - Send emails
- n8n-nodes-base.postgres - PostgreSQL database
- n8n-nodes-base.mysql - MySQL database
- n8n-nodes-base.mongodb - MongoDB
- n8n-nodes-base.googleSheets - Google Sheets
- n8n-nodes-base.airtable - Airtable
- n8n-nodes-base.notion - Notion
- n8n-nodes-base.github - GitHub API
- n8n-nodes-base.jira - Jira
- n8n-nodes-base.aws - AWS services

META WORKFLOWS (workflows that create/manage other workflows):
- n8n-nodes-base.executeWorkflow - Run another workflow
- n8n-nodes-base.n8n - Access n8n API to create/modify workflows

OUTPUT FORMAT:
Respond with valid JSON only, no markdown code blocks:
{
  "workflow": {
    "name": "Workflow Name",
    "active": false,
    "nodes": [
      {
        "id": "unique_id",
        "name": "Node Name",
        "type": "node-type",
        "typeVersion": 1,
        "position": [x, y],
        "parameters": {}
      }
    ],
    "connections": {
      "Node Name": {
        "main": [[{ "node": "Next Node Name", "type": "main", "index": 0 }]]
      }
    },
    "settings": { "executionOrder": "v1" }
  },
  "explanation": "Brief explanation of what the workflow does"
}

Position nodes at x=250 starting, y=300, with 200px spacing between nodes.
Always include a trigger node as the first node.
Generate unique IDs for each node.`;

  try {
    const response = await fetch(`${getOllamaApiUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || readSettings().selectedModel?.name || "qwen2.5-coder:7b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create an n8n workflow for: ${prompt}` }
        ],
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 4096,
        },
        format: "json",
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      logger.warn("Ollama request failed, falling back to basic generation");
      return null;
    }

    const data = await response.json();
    const content = data.message?.content || "";
    
    try {
      const parsed = JSON.parse(content);
      if (parsed.workflow && parsed.workflow.nodes) {
        return {
          workflow: parsed.workflow,
          explanation: parsed.explanation || "AI-generated workflow",
        };
      }
    } catch (parseError) {
      logger.warn("Failed to parse AI response:", parseError);
    }
    
    return null;
  } catch (error) {
    logger.warn("Ollama not available:", error);
    return null;
  }
}

/**
 * Check if Ollama is available
 */
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${getOllamaApiUrl()}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function generateWorkflow(
  request: WorkflowGenerationRequest
): Promise<WorkflowGenerationResult> {
  try {
    let generatedWorkflow: N8nWorkflow | undefined;
    let explanation = "";
    let warnings: string[] = [];

    // Try AI-powered generation first if Ollama is available
    if (await isOllamaAvailable()) {
      logger.info("Using AI-powered workflow generation");
      const aiResult = await callOllamaForWorkflow(request.prompt, request.model);
      
      if (aiResult) {
        // Validate the AI-generated workflow
        const validation = validateWorkflow(aiResult.workflow);
        
        if (validation.valid) {
          generatedWorkflow = aiResult.workflow;
          explanation = aiResult.explanation;
          warnings = validation.warnings || [];
        } else {
          logger.warn("AI-generated workflow failed validation, falling back to basic generation");
        }
      }
    }
    
    // Fallback to basic keyword-based generation
    if (!generatedWorkflow) {
      logger.info("Using basic keyword-based workflow generation");
      const workflowSpec = parseWorkflowPrompt(request.prompt);
      const workflow = buildWorkflowFromSpec(workflowSpec, request.constraints);
      const validation = validateWorkflow(workflow);
      
      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
        };
      }

      generatedWorkflow = workflow;
      explanation = `Created workflow with ${workflow.nodes.length} nodes: ${workflowSpec.description}`;
      warnings = validation.warnings || [];
    }

    // Auto-save the generated workflow (to n8n or local store)
    try {
      const saved = await createWorkflow(generatedWorkflow);
      if (saved?.id) {
        generatedWorkflow = saved;
        logger.info(`Auto-saved generated workflow: ${saved.id}`);
      }
    } catch (saveErr) {
      logger.warn("Failed to auto-save generated workflow:", saveErr);
      warnings.push("Workflow generated but could not be saved automatically");
    }

    return {
      success: true,
      workflow: generatedWorkflow,
      explanation,
      warnings,
    };
  } catch (error) {
    return {
      success: false,
      errors: [String(error)],
    };
  }
}

interface WorkflowSpec {
  description: string;
  trigger: { type: string; config: Record<string, unknown> };
  steps: Array<{ type: string; name: string; config: Record<string, unknown> }>;
  errorHandling: boolean;
}

function parseWorkflowPrompt(prompt: string): WorkflowSpec {
  const promptLower = prompt.toLowerCase();
  
  // Detect trigger type
  let trigger = { type: "n8n-nodes-base.manualTrigger", config: {} };
  if (promptLower.includes("webhook") || promptLower.includes("api")) {
    trigger = { type: "n8n-nodes-base.webhook", config: { httpMethod: "POST", path: "webhook" } };
  } else if (promptLower.includes("schedule") || promptLower.includes("cron") || promptLower.includes("every")) {
    trigger = { type: "n8n-nodes-base.scheduleTrigger", config: { rule: { interval: [{ field: "hours", value: 1 }] } } };
  } else if (promptLower.includes("email")) {
    trigger = { type: "n8n-nodes-base.emailReadImap", config: {} };
  }

  // Detect steps
  const steps: WorkflowSpec["steps"] = [];
  
  if (promptLower.includes("http") || promptLower.includes("api") || promptLower.includes("fetch")) {
    steps.push({ type: "n8n-nodes-base.httpRequest", name: "HTTP Request", config: { method: "GET" } });
  }
  
  if (promptLower.includes("openai") || promptLower.includes("gpt") || promptLower.includes("ai")) {
    steps.push({ type: "n8n-nodes-base.openAi", name: "OpenAI", config: { operation: "message", model: "gpt-4" } });
  }
  
  if (promptLower.includes("slack")) {
    steps.push({ type: "n8n-nodes-base.slack", name: "Slack", config: { operation: "postMessage" } });
  }
  
  if (promptLower.includes("email") || promptLower.includes("send")) {
    steps.push({ type: "n8n-nodes-base.emailSend", name: "Send Email", config: {} });
  }
  
  if (promptLower.includes("database") || promptLower.includes("postgres")) {
    steps.push({ type: "n8n-nodes-base.postgres", name: "Postgres", config: { operation: "select" } });
  }

  if (promptLower.includes("code") || promptLower.includes("transform") || promptLower.includes("process")) {
    steps.push({ type: "n8n-nodes-base.code", name: "Code", config: { language: "javaScript" } });
  }

  // If no steps detected, add a basic set node
  if (steps.length === 0) {
    steps.push({ type: "n8n-nodes-base.set", name: "Set Data", config: {} });
  }

  return {
    description: prompt,
    trigger,
    steps,
    errorHandling: promptLower.includes("error") || promptLower.includes("retry"),
  };
}

function buildWorkflowFromSpec(
  spec: WorkflowSpec,
  constraints?: WorkflowGenerationRequest["constraints"]
): N8nWorkflow {
  const nodes: N8nNode[] = [];
  const connections: N8nConnections = {};
  
  let xPos = 250;
  const yPos = 300;
  const spacing = 200;

  // Add trigger node
  const triggerId = generateNodeId();
  const triggerNode: N8nNode = {
    id: triggerId,
    name: "Trigger",
    type: spec.trigger.type,
    typeVersion: 1,
    position: [xPos, yPos],
    parameters: spec.trigger.config,
  };
  nodes.push(triggerNode);
  
  let prevNodeName = triggerNode.name;
  xPos += spacing;

  // Add step nodes
  for (const step of spec.steps) {
    if (constraints?.maxNodes && nodes.length >= constraints.maxNodes) {
      break;
    }

    const nodeId = generateNodeId();
    const node: N8nNode = {
      id: nodeId,
      name: step.name,
      type: step.type,
      typeVersion: 1,
      position: [xPos, yPos],
      parameters: step.config,
    };
    nodes.push(node);

    // Connect to previous node
    if (!connections[prevNodeName]) {
      connections[prevNodeName] = { main: [[]] };
    }
    connections[prevNodeName].main[0].push({
      node: node.name,
      type: "main",
      index: 0,
    });

    prevNodeName = node.name;
    xPos += spacing;
  }

  // Add error handling if requested
  if (spec.errorHandling) {
    const errorNodeId = generateNodeId();
    const errorNode: N8nNode = {
      id: errorNodeId,
      name: "Error Handler",
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [xPos, yPos + 150],
      parameters: {},
      notes: "Handle errors here",
    };
    nodes.push(errorNode);
  }

  return {
    name: `Generated: ${spec.description.slice(0, 50)}...`,
    active: false,
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      saveManualExecutions: true,
    },
  };
}

function generateNodeId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function validateWorkflow(workflow: N8nWorkflow): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!workflow.nodes || workflow.nodes.length === 0) {
    errors.push("Workflow must have at least one node");
  }

  // Check for trigger node
  const hasTrigger = workflow.nodes.some((n) =>
    n.type.includes("Trigger") || n.type.includes("webhook") || n.type.includes("cron")
  );
  if (!hasTrigger) {
    warnings.push("Workflow has no trigger node - it can only be executed manually");
  }

  // Check for orphan nodes (not connected)
  const connectedNodes = new Set<string>();
  for (const [source, conns] of Object.entries(workflow.connections)) {
    connectedNodes.add(source);
    for (const outputs of Object.values(conns)) {
      for (const output of outputs) {
        for (const conn of output) {
          connectedNodes.add(conn.node);
        }
      }
    }
  }
  
  for (const node of workflow.nodes) {
    if (!connectedNodes.has(node.name) && workflow.nodes.length > 1) {
      warnings.push(`Node "${node.name}" is not connected to the workflow`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Meta Workflow Builder - Workflow that Builds Workflows
// ============================================================================

export function createMetaWorkflowBuilder(): N8nWorkflow {
  // n8n runs in Docker — use host.docker.internal to reach Ollama on the host
  const ollamaUrlInDocker = "http://host.docker.internal:11434";

  return {
    name: "Meta Workflow Builder",
    active: true,
    nodes: [
      {
        id: generateNodeId(),
        name: "Webhook Trigger",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        position: [250, 300],
        parameters: {
          httpMethod: "POST",
          path: "build-workflow",
          responseMode: "responseNode",
        },
      },
      {
        id: generateNodeId(),
        name: "Parse Request",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [450, 300],
        parameters: {
          language: "javaScript",
          code: `// Parse the workflow build request
const request = $input.first().json;

return [{
  json: {
    prompt: request.prompt || '',
    agentId: request.agentId,
    constraints: request.constraints || {},
    timestamp: new Date().toISOString()
  }
}];`,
        },
      },
      {
        id: generateNodeId(),
        name: "AI Workflow Designer",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [650, 300],
        parameters: {
          method: "POST",
          url: `${ollamaUrlInDocker}/api/chat`,
          sendBody: true,
          specifyBody: "json",
          jsonBody: `={{
            JSON.stringify({
              model: "llama3.2:3b",
              messages: [
                {
                  role: "system",
                  content: "You are an n8n workflow designer. Given a description, output valid JSON with keys: name, nodes (array), connections (object). Available node types: webhook, scheduleTrigger, manualTrigger, httpRequest, code, set, if, switch, merge, slack, discord, email, postgres. Output ONLY valid JSON, no commentary."
                },
                {
                  role: "user",
                  content: $json.prompt
                }
              ],
              stream: false,
              format: "json",
              options: { temperature: 0.3, num_predict: 4096 }
            })
          }}`,
          options: {
            timeout: 120000,
          },
        },
      },
      {
        id: generateNodeId(),
        name: "Parse AI Response",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [850, 300],
        parameters: {
          language: "javaScript",
          code: `// Parse Ollama response and extract workflow JSON
const ollamaResponse = $input.first().json;
const content = ollamaResponse.message?.content || '';

try {
  const jsonMatch = content.match(/\\{[\\s\\S]*\\}/);
  if (jsonMatch) {
    const workflow = JSON.parse(jsonMatch[0]);
    return [{ json: { success: true, workflow } }];
  }
  return [{ json: { success: false, error: 'No valid JSON found' } }];
} catch (e) {
  return [{ json: { success: false, error: e.message } }];
}`,
        },
      },
      {
        id: generateNodeId(),
        name: "Create Workflow",
        type: "n8n-nodes-base.n8n",
        typeVersion: 1,
        position: [1050, 300],
        parameters: {
          operation: "create",
          workflowObject: "={{ $json.workflow }}",
        },
      },
      {
        id: generateNodeId(),
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        position: [1250, 300],
        parameters: {
          respondWith: "json",
          responseBody: "={{ $json }}",
        },
      },
    ],
    connections: {
      "Webhook Trigger": {
        main: [[{ node: "Parse Request", type: "main", index: 0 }]],
      },
      "Parse Request": {
        main: [[{ node: "AI Workflow Designer", type: "main", index: 0 }]],
      },
      "AI Workflow Designer": {
        main: [[{ node: "Parse AI Response", type: "main", index: 0 }]],
      },
      "Parse AI Response": {
        main: [[{ node: "Create Workflow", type: "main", index: 0 }]],
      },
      "Create Workflow": {
        main: [[{ node: "Respond", type: "main", index: 0 }]],
      },
    },
    settings: {
      executionOrder: "v1",
    },
  };
}

// ============================================================================
// Agent Communication System
// ============================================================================

const agentMessages: Map<string, AgentMessage[]> = new Map();
const collaborations: Map<string, AgentCollaboration> = new Map();

export function sendAgentMessage(message: Omit<AgentMessage, "id" | "timestamp" | "status">): AgentMessage {
  const fullMessage: AgentMessage = {
    ...message,
    id: generateNodeId(),
    timestamp: Date.now(),
    status: "pending",
  };

  // Store message
  const key = message.toAgentId === "broadcast" ? "broadcast" : String(message.toAgentId);
  if (!agentMessages.has(key)) {
    agentMessages.set(key, []);
  }
  agentMessages.get(key)!.push(fullMessage);

  logger.info(`Agent message sent: ${message.fromAgentId} -> ${message.toAgentId}`);
  
  return fullMessage;
}

export function getAgentMessages(agentId: number): AgentMessage[] {
  const direct = agentMessages.get(String(agentId)) || [];
  const broadcast = agentMessages.get("broadcast") || [];
  return [...direct, ...broadcast].sort((a, b) => b.timestamp - a.timestamp);
}

export function createCollaboration(
  name: string,
  agentIds: number[]
): AgentCollaboration {
  const collab: AgentCollaboration = {
    id: generateNodeId(),
    name,
    agentIds,
    status: "active",
    createdAt: Date.now(),
    messages: [],
  };
  
  collaborations.set(collab.id, collab);
  return collab;
}

export function getCollaboration(id: string): AgentCollaboration | undefined {
  return collaborations.get(id);
}

export function listCollaborations(): AgentCollaboration[] {
  return Array.from(collaborations.values());
}

// ============================================================================
// Agent-to-Agent Workflow Builder
// ============================================================================

export function createAgentCollaborationWorkflow(agentIds: number[]): N8nWorkflow {
  return {
    name: "Agent Collaboration Hub",
    active: true,
    nodes: [
      {
        id: generateNodeId(),
        name: "Message Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        position: [250, 300],
        parameters: {
          httpMethod: "POST",
          path: "agent-message",
          responseMode: "responseNode",
        },
      },
      {
        id: generateNodeId(),
        name: "Route Message",
        type: "n8n-nodes-base.switch",
        typeVersion: 3,
        position: [450, 300],
        parameters: {
          rules: {
            values: [
              {
                conditions: {
                  conditions: [
                    { leftValue: "={{ $json.type }}", operator: { value: "equals" }, rightValue: "workflow-request" },
                  ],
                },
                output: 0,
              },
              {
                conditions: {
                  conditions: [
                    { leftValue: "={{ $json.type }}", operator: { value: "equals" }, rightValue: "task" },
                  ],
                },
                output: 1,
              },
            ],
          },
        },
      },
      {
        id: generateNodeId(),
        name: "Build Workflow",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [650, 200],
        parameters: {
          method: "POST",
          url: "http://localhost:5678/webhook/build-workflow",
          body: "={{ JSON.stringify($json) }}",
          contentType: "application/json",
        },
      },
      {
        id: generateNodeId(),
        name: "Execute Task",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [650, 400],
        parameters: {
          language: "javaScript",
          code: `// Process agent task
const task = $input.first().json;

// Execute task logic here
const result = {
  taskId: task.id,
  status: 'completed',
  result: 'Task processed successfully',
  timestamp: new Date().toISOString()
};

return [{ json: result }];`,
        },
      },
      {
        id: generateNodeId(),
        name: "Notify Agents",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [850, 300],
        parameters: {
          method: "POST",
          url: "http://localhost:3000/api/agent-notification",
          body: "={{ JSON.stringify($json) }}",
          contentType: "application/json",
        },
      },
      {
        id: generateNodeId(),
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        position: [1050, 300],
        parameters: {
          respondWith: "json",
          responseBody: "={{ $json }}",
        },
      },
    ],
    connections: {
      "Message Webhook": {
        main: [[{ node: "Route Message", type: "main", index: 0 }]],
      },
      "Route Message": {
        main: [
          [{ node: "Build Workflow", type: "main", index: 0 }],
          [{ node: "Execute Task", type: "main", index: 0 }],
        ],
      },
      "Build Workflow": {
        main: [[{ node: "Notify Agents", type: "main", index: 0 }]],
      },
      "Execute Task": {
        main: [[{ node: "Notify Agents", type: "main", index: 0 }]],
      },
      "Notify Agents": {
        main: [[{ node: "Respond", type: "main", index: 0 }]],
      },
    },
    settings: {
      executionOrder: "v1",
    },
  };
}

// ============================================================================
// Ollama Credential Provisioning for n8n
// ============================================================================

/**
 * Ensure an Ollama credential exists in n8n pointing to host.docker.internal.
 * This lets n8n AI nodes (LangChain, Agents, etc.) use local Ollama.
 *
 * n8n REST API credential endpoints:
 *   POST /api/v1/credentials  — create
 *   GET  /api/v1/credentials  — list
 */
export async function ensureOllamaCredentialInN8n(): Promise<{
  success: boolean;
  credentialId?: string;
  created?: boolean;
  error?: string;
}> {
  if (!(await checkN8nAvailable())) {
    return { success: false, error: "n8n is not running" };
  }

  try {
    // Check if Ollama credential already exists
    const existing = await n8nApiRequest<{ data: Array<{ id: string; name: string; type: string }> }>(
      "GET",
      "/credentials",
    );

    const ollamaCred = existing.data?.find(
      (c) => c.type === "ollamaApi" || c.name === "Ollama (JoyCreate Local)",
    );

    if (ollamaCred) {
      logger.info(`Ollama credential already exists in n8n: ${ollamaCred.id}`);
      return { success: true, credentialId: ollamaCred.id, created: false };
    }

    // Create the Ollama credential
    // n8n expects: { name, type, data: { baseUrl } }
    const credential = await n8nApiRequest<{ id: string }>("POST", "/credentials", {
      name: "Ollama (JoyCreate Local)",
      type: "ollamaApi",
      data: {
        baseUrl: "http://host.docker.internal:11434",
      },
    });

    logger.info(`Ollama credential created in n8n: ${credential.id}`);
    return { success: true, credentialId: credential.id, created: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to provision Ollama credential in n8n:", msg);
    return { success: false, error: msg };
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function registerN8nHandlers(): void {
  // Load locally-stored workflows on startup
  loadLocalWorkflows().catch(err => logger.warn("Failed to load local workflows on startup:", err));

  // n8n Process Management
  ipcMain.handle("n8n:start", async () => startN8n());
  ipcMain.handle("n8n:stop", async () => stopN8n());
  ipcMain.handle("n8n:status", async () => ({ running: await isN8nReachable() }));
  
  // API Key Management
  ipcMain.handle("n8n:set-api-key", async (_event, apiKey: string) => {
    n8nConfig.apiKey = apiKey;
    const keyFile = path.join(getUserDataPath(), "n8n", "api_key.txt");
    await fs.ensureDir(path.dirname(keyFile));
    await fs.writeFile(keyFile, apiKey, "utf-8");
    return { success: true };
  });
  ipcMain.handle("n8n:refresh-auth", async () => {
    await refreshN8nApiKey();
    return { success: true };
  });

  // Database Configuration
  ipcMain.handle("n8n:db:configure", async (_event, config: Partial<N8nDatabaseConfig>) => {
    configureN8nDatabase(config);
    return { success: true };
  });
  ipcMain.handle("n8n:db:get-config", async () => n8nDbConfig);
  
  // Workflow Management
  ipcMain.handle("n8n:workflow:create", async (_event, workflow: N8nWorkflow) => createWorkflow(workflow));
  ipcMain.handle("n8n:workflow:update", async (_event, id: string, workflow: N8nWorkflow) => updateWorkflow(id, workflow));
  ipcMain.handle("n8n:workflow:get", async (_event, id: string) => getWorkflow(id));
  ipcMain.handle("n8n:workflow:list", async () => listWorkflows());
  ipcMain.handle("n8n:workflow:delete", async (_event, id: string) => deleteWorkflow(id));
  ipcMain.handle("n8n:workflow:activate", async (_event, id: string) => activateWorkflow(id));
  ipcMain.handle("n8n:workflow:deactivate", async (_event, id: string) => deactivateWorkflow(id));
  ipcMain.handle("n8n:workflow:execute", async (_event, id: string, data?: Record<string, unknown>) => executeWorkflow(id, data));
  
  // AI Workflow Generation
  ipcMain.handle("n8n:workflow:generate", async (_event, request: WorkflowGenerationRequest) => generateWorkflow(request));
  ipcMain.handle("n8n:meta-builder:create", async () => createMetaWorkflowBuilder());

  // Ollama credential provisioning for n8n
  ipcMain.handle("n8n:setup-ollama", async () => ensureOllamaCredentialInN8n());
  
  // Agent Communication
  ipcMain.handle("n8n:agent:send-message", async (_event, message) => sendAgentMessage(message));
  ipcMain.handle("n8n:agent:get-messages", async (_event, agentId: number) => getAgentMessages(agentId));
  ipcMain.handle("n8n:agent:create-collaboration", async (_event, name: string, agentIds: number[]) => createCollaboration(name, agentIds));
  ipcMain.handle("n8n:agent:get-collaboration", async (_event, id: string) => getCollaboration(id));
  ipcMain.handle("n8n:agent:list-collaborations", async () => listCollaborations());
  ipcMain.handle("n8n:agent:create-collab-workflow", async (_event, agentIds: number[]) => createAgentCollaborationWorkflow(agentIds));

  logger.info("n8n IPC handlers registered");
}
