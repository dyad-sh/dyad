/**
 * N8n Integration Layer Handlers
 * Bidirectional integration with n8n workflow automation
 * 
 * Features:
 * - Webhook server for n8n triggers
 * - N8n API client for workflow management
 * - Event synchronization
 * - Workflow template import/export
 * - Execution bridging
 * - Credential management
 * - Node type mapping
 */

import { ipcMain, app, BrowserWindow } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as http from "http";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";

const logger = log.scope("n8n_integration");

// ============================================================================
// Types
// ============================================================================

interface N8nConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  webhookPort: number;
  webhookHost: string;
  autoSync: boolean;
  syncInterval: number;
}

interface N8nConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  status: "connected" | "disconnected" | "error";
  lastChecked?: Date;
  version?: string;
  error?: string;
}

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: N8nNode[];
  connections: Record<string, any>;
  settings?: Record<string, any>;
  staticData?: Record<string, any>;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, any>;
  credentials?: Record<string, any>;
  disabled?: boolean;
  notes?: string;
}

interface N8nExecution {
  id: string;
  workflowId: string;
  finished: boolean;
  mode: string;
  startedAt: string;
  stoppedAt?: string;
  status: "success" | "error" | "running" | "waiting";
  data?: any;
  error?: string;
}

interface WebhookEndpoint {
  id: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  handler: WebhookHandler;
  authentication?: WebhookAuth;
  rateLimit?: WebhookRateLimit;
  enabled: boolean;
  description?: string;
  createdAt: Date;
  lastTriggered?: Date;
  triggerCount: number;
}

interface WebhookHandler {
  type: "workflow" | "task" | "agent" | "event" | "custom";
  target: string;
  transformInput?: string;
  transformOutput?: string;
}

interface WebhookAuth {
  type: "none" | "basic" | "token" | "hmac";
  username?: string;
  password?: string;
  token?: string;
  secret?: string;
  headerName?: string;
}

interface WebhookRateLimit {
  maxRequests: number;
  windowMs: number;
}

interface WebhookRequest {
  id: string;
  endpointId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: any;
  ip: string;
  timestamp: Date;
  response?: WebhookResponse;
}

interface WebhookResponse {
  statusCode: number;
  body: any;
  headers?: Record<string, string>;
  duration: number;
}

interface N8nMapping {
  id: string;
  name: string;
  description?: string;
  localType: "workflow" | "task" | "agent" | "pipeline";
  localId: string;
  n8nWorkflowId: string;
  n8nConnectionId: string;
  syncMode: "push" | "pull" | "bidirectional";
  fieldMappings: FieldMapping[];
  triggerConfig?: TriggerConfig;
  lastSynced?: Date;
  syncStatus: "synced" | "pending" | "conflict" | "error";
}

interface FieldMapping {
  localField: string;
  n8nField: string;
  transform?: string;
  direction: "local_to_n8n" | "n8n_to_local" | "bidirectional";
}

interface TriggerConfig {
  type: "webhook" | "schedule" | "event" | "manual";
  webhookPath?: string;
  schedule?: string;
  eventName?: string;
}

interface N8nTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  workflow: N8nWorkflow;
  requiredCredentials: string[];
  variables: TemplateVariable[];
  tags: string[];
}

interface TemplateVariable {
  name: string;
  description: string;
  type: "string" | "number" | "boolean" | "json";
  required: boolean;
  default?: any;
}

// ============================================================================
// Storage & State
// ============================================================================

const connections: Map<string, N8nConnection> = new Map();
const mappings: Map<string, N8nMapping> = new Map();
const webhookEndpoints: Map<string, WebhookEndpoint> = new Map();
const webhookHistory: WebhookRequest[] = [];
const templates: Map<string, N8nTemplate> = new Map();
const eventEmitter = new EventEmitter();

let webhookServer: http.Server | null = null;
let config: N8nConfig = {
  enabled: false,
  baseUrl: "http://localhost:5678",
  webhookPort: 5679,
  webhookHost: "localhost",
  autoSync: false,
  syncInterval: 60000,
};

let syncInterval: NodeJS.Timeout | null = null;

function getN8nStorageDir(): string {
  return path.join(app.getPath("userData"), "n8n-integration");
}

async function initializeN8nIntegration() {
  const storageDir = getN8nStorageDir();
  await fs.ensureDir(storageDir);
  await fs.ensureDir(path.join(storageDir, "templates"));
  
  // Load config
  const configPath = path.join(storageDir, "config.json");
  if (await fs.pathExists(configPath)) {
    config = await fs.readJson(configPath);
  }
  
  // Load connections
  const connectionsPath = path.join(storageDir, "connections.json");
  if (await fs.pathExists(connectionsPath)) {
    const data = await fs.readJson(connectionsPath);
    for (const c of data) {
      connections.set(c.id, {
        ...c,
        lastChecked: c.lastChecked ? new Date(c.lastChecked) : undefined,
      });
    }
  }
  
  // Load mappings
  const mappingsPath = path.join(storageDir, "mappings.json");
  if (await fs.pathExists(mappingsPath)) {
    const data = await fs.readJson(mappingsPath);
    for (const m of data) {
      mappings.set(m.id, {
        ...m,
        lastSynced: m.lastSynced ? new Date(m.lastSynced) : undefined,
      });
    }
  }
  
  // Load webhook endpoints
  const endpointsPath = path.join(storageDir, "webhooks.json");
  if (await fs.pathExists(endpointsPath)) {
    const data = await fs.readJson(endpointsPath);
    for (const e of data) {
      webhookEndpoints.set(e.id, {
        ...e,
        createdAt: new Date(e.createdAt),
        lastTriggered: e.lastTriggered ? new Date(e.lastTriggered) : undefined,
      });
    }
  }
  
  // Initialize default templates
  initializeDefaultTemplates();
  
  // Start webhook server if enabled
  if (config.enabled) {
    await startWebhookServer();
  }
  
  // Start auto-sync if enabled
  if (config.autoSync && config.syncInterval > 0) {
    startAutoSync();
  }
  
  logger.info(`N8n integration initialized: ${connections.size} connections, ${webhookEndpoints.size} endpoints`);
}

function initializeDefaultTemplates() {
  const defaultTemplates: N8nTemplate[] = [
    {
      id: "data-import-webhook",
      name: "Data Import via Webhook",
      description: "Receive data via webhook and import to JoyCreate",
      category: "data",
      workflow: {
        id: "",
        name: "Data Import Webhook",
        active: true,
        nodes: [
          {
            id: "webhook",
            name: "Webhook",
            type: "n8n-nodes-base.webhook",
            typeVersion: 1,
            position: [0, 0],
            parameters: {
              httpMethod: "POST",
              path: "import-data",
              responseMode: "responseNode",
            },
          },
          {
            id: "transform",
            name: "Transform Data",
            type: "n8n-nodes-base.set",
            typeVersion: 1,
            position: [200, 0],
            parameters: {},
          },
          {
            id: "joycreate",
            name: "JoyCreate Import",
            type: "n8n-nodes-base.httpRequest",
            typeVersion: 4,
            position: [400, 0],
            parameters: {
              method: "POST",
              url: "={{$vars.joycreateWebhookUrl}}/api/import",
            },
          },
          {
            id: "response",
            name: "Response",
            type: "n8n-nodes-base.respondToWebhook",
            typeVersion: 1,
            position: [600, 0],
            parameters: {},
          },
        ],
        connections: {
          webhook: { main: [[{ node: "transform", type: "main", index: 0 }]] },
          transform: { main: [[{ node: "joycreate", type: "main", index: 0 }]] },
          joycreate: { main: [[{ node: "response", type: "main", index: 0 }]] },
        },
      },
      requiredCredentials: [],
      variables: [
        {
          name: "joycreateWebhookUrl",
          description: "JoyCreate webhook URL",
          type: "string",
          required: true,
          default: "http://localhost:5679",
        },
      ],
      tags: ["data", "import", "webhook"],
    },
    {
      id: "scheduled-export",
      name: "Scheduled Data Export",
      description: "Export data on a schedule",
      category: "data",
      workflow: {
        id: "",
        name: "Scheduled Export",
        active: true,
        nodes: [
          {
            id: "schedule",
            name: "Schedule Trigger",
            type: "n8n-nodes-base.scheduleTrigger",
            typeVersion: 1,
            position: [0, 0],
            parameters: {
              rule: {
                interval: [{ field: "hours", hoursInterval: 24 }],
              },
            },
          },
          {
            id: "fetch",
            name: "Fetch Data",
            type: "n8n-nodes-base.httpRequest",
            typeVersion: 4,
            position: [200, 0],
            parameters: {
              method: "GET",
              url: "={{$vars.joycreateApiUrl}}/api/export",
            },
          },
          {
            id: "process",
            name: "Process Data",
            type: "n8n-nodes-base.code",
            typeVersion: 1,
            position: [400, 0],
            parameters: {
              jsCode: "return items;",
            },
          },
        ],
        connections: {
          schedule: { main: [[{ node: "fetch", type: "main", index: 0 }]] },
          fetch: { main: [[{ node: "process", type: "main", index: 0 }]] },
        },
      },
      requiredCredentials: [],
      variables: [
        {
          name: "joycreateApiUrl",
          description: "JoyCreate API URL",
          type: "string",
          required: true,
        },
      ],
      tags: ["data", "export", "scheduled"],
    },
    {
      id: "agent-trigger",
      name: "AI Agent Trigger",
      description: "Trigger JoyCreate AI agent from n8n",
      category: "agents",
      workflow: {
        id: "",
        name: "Agent Trigger",
        active: true,
        nodes: [
          {
            id: "trigger",
            name: "Manual Trigger",
            type: "n8n-nodes-base.manualTrigger",
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          },
          {
            id: "agent",
            name: "Execute Agent",
            type: "n8n-nodes-base.httpRequest",
            typeVersion: 4,
            position: [200, 0],
            parameters: {
              method: "POST",
              url: "={{$vars.joycreateWebhookUrl}}/api/agent/execute",
              body: {
                agentId: "={{$vars.agentId}}",
                input: "={{$json}}",
              },
            },
          },
        ],
        connections: {
          trigger: { main: [[{ node: "agent", type: "main", index: 0 }]] },
        },
      },
      requiredCredentials: [],
      variables: [
        {
          name: "joycreateWebhookUrl",
          description: "JoyCreate webhook URL",
          type: "string",
          required: true,
        },
        {
          name: "agentId",
          description: "Agent ID to execute",
          type: "string",
          required: true,
        },
      ],
      tags: ["agents", "automation"],
    },
    {
      id: "event-bridge",
      name: "Event Bridge",
      description: "Bridge events between JoyCreate and n8n",
      category: "integration",
      workflow: {
        id: "",
        name: "Event Bridge",
        active: true,
        nodes: [
          {
            id: "webhook",
            name: "Event Webhook",
            type: "n8n-nodes-base.webhook",
            typeVersion: 1,
            position: [0, 0],
            parameters: {
              httpMethod: "POST",
              path: "events",
            },
          },
          {
            id: "switch",
            name: "Route by Event",
            type: "n8n-nodes-base.switch",
            typeVersion: 2,
            position: [200, 0],
            parameters: {
              dataPropertyName: "eventType",
              rules: {
                values: [
                  { value: "task.completed" },
                  { value: "agent.executed" },
                  { value: "data.imported" },
                ],
              },
            },
          },
        ],
        connections: {
          webhook: { main: [[{ node: "switch", type: "main", index: 0 }]] },
        },
      },
      requiredCredentials: [],
      variables: [],
      tags: ["events", "integration"],
    },
  ];
  
  for (const t of defaultTemplates) {
    templates.set(t.id, t);
  }
}

async function saveConfig() {
  const storageDir = getN8nStorageDir();
  await fs.writeJson(path.join(storageDir, "config.json"), config, { spaces: 2 });
}

async function saveConnections() {
  const storageDir = getN8nStorageDir();
  await fs.writeJson(
    path.join(storageDir, "connections.json"),
    Array.from(connections.values()),
    { spaces: 2 }
  );
}

async function saveMappings() {
  const storageDir = getN8nStorageDir();
  await fs.writeJson(
    path.join(storageDir, "mappings.json"),
    Array.from(mappings.values()),
    { spaces: 2 }
  );
}

async function saveWebhookEndpoints() {
  const storageDir = getN8nStorageDir();
  await fs.writeJson(
    path.join(storageDir, "webhooks.json"),
    Array.from(webhookEndpoints.values()),
    { spaces: 2 }
  );
}

// ============================================================================
// Webhook Server
// ============================================================================

async function startWebhookServer(): Promise<void> {
  if (webhookServer) {
    return;
  }
  
  webhookServer = http.createServer(async (req, res) => {
    const startTime = Date.now();
    const requestId = uuidv4();
    
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const pathParts = url.pathname.split("/").filter(Boolean);
      
      // Find matching endpoint
      let matchedEndpoint: WebhookEndpoint | null = null;
      
      for (const endpoint of webhookEndpoints.values()) {
        if (!endpoint.enabled) continue;
        
        const endpointPath = endpoint.path.startsWith("/") ? endpoint.path : `/${endpoint.path}`;
        
        if (url.pathname === endpointPath && 
            (endpoint.method === req.method || endpoint.method === "POST" && !req.method)) {
          matchedEndpoint = endpoint;
          break;
        }
      }
      
      if (!matchedEndpoint) {
        // Check for built-in endpoints
        if (pathParts[0] === "api") {
          await handleBuiltinEndpoint(pathParts.slice(1), req, res, requestId);
          return;
        }
        
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Endpoint not found" }));
        return;
      }
      
      // Parse body
      let body: any = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        body = await parseRequestBody(req);
      }
      
      // Parse query
      const query: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      
      // Authenticate
      if (matchedEndpoint.authentication && matchedEndpoint.authentication.type !== "none") {
        const authResult = authenticateRequest(req, matchedEndpoint.authentication);
        if (!authResult) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }
      
      // Rate limiting
      if (matchedEndpoint.rateLimit) {
        const isAllowed = checkRateLimit(matchedEndpoint.id, matchedEndpoint.rateLimit);
        if (!isAllowed) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Rate limit exceeded" }));
          return;
        }
      }
      
      // Create request record
      const webhookRequest: WebhookRequest = {
        id: requestId,
        endpointId: matchedEndpoint.id,
        method: req.method || "GET",
        path: url.pathname,
        headers: req.headers as Record<string, string>,
        query,
        body,
        ip: req.socket.remoteAddress || "",
        timestamp: new Date(),
      };
      
      // Transform input if specified
      let processedInput = body;
      if (matchedEndpoint.handler.transformInput) {
        try {
          const fn = new Function("input", "query", "headers", matchedEndpoint.handler.transformInput);
          processedInput = fn(body, query, req.headers);
        } catch (err: any) {
          logger.error("Input transform failed:", err);
        }
      }
      
      // Execute handler
      let result: any;
      
      switch (matchedEndpoint.handler.type) {
        case "workflow":
          result = await triggerWorkflow(matchedEndpoint.handler.target, processedInput);
          break;
        
        case "task":
          result = await triggerTask(matchedEndpoint.handler.target, processedInput);
          break;
        
        case "agent":
          result = await triggerAgent(matchedEndpoint.handler.target, processedInput);
          break;
        
        case "event":
          result = await emitEvent(matchedEndpoint.handler.target, processedInput);
          break;
        
        case "custom":
          try {
            const fn = new Function("input", "query", "headers", matchedEndpoint.handler.target);
            result = await fn(processedInput, query, req.headers);
          } catch (err: any) {
            throw new Error(`Custom handler error: ${err.message}`);
          }
          break;
        
        default:
          result = { received: true };
      }
      
      // Transform output if specified
      let response = result;
      if (matchedEndpoint.handler.transformOutput) {
        try {
          const fn = new Function("output", matchedEndpoint.handler.transformOutput);
          response = fn(result);
        } catch (err: any) {
          logger.error("Output transform failed:", err);
        }
      }
      
      // Update endpoint stats
      matchedEndpoint.lastTriggered = new Date();
      matchedEndpoint.triggerCount++;
      await saveWebhookEndpoints();
      
      // Record response
      webhookRequest.response = {
        statusCode: 200,
        body: response,
        duration: Date.now() - startTime,
      };
      
      // Keep history (limited)
      webhookHistory.push(webhookRequest);
      if (webhookHistory.length > 1000) {
        webhookHistory.shift();
      }
      
      // Send response
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      
    } catch (error: any) {
      logger.error("Webhook error:", error);
      
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  
  return new Promise((resolve, reject) => {
    webhookServer!.listen(config.webhookPort, config.webhookHost, () => {
      logger.info(`Webhook server started on ${config.webhookHost}:${config.webhookPort}`);
      resolve();
    });
    
    webhookServer!.on("error", (err) => {
      logger.error("Webhook server error:", err);
      reject(err);
    });
  });
}

function stopWebhookServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!webhookServer) {
      resolve();
      return;
    }
    
    webhookServer.close(() => {
      webhookServer = null;
      logger.info("Webhook server stopped");
      resolve();
    });
  });
}

async function parseRequestBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    req.on("data", (chunk) => chunks.push(chunk));
    
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString();
        const contentType = req.headers["content-type"] || "";
        
        if (contentType.includes("application/json")) {
          resolve(JSON.parse(body));
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          resolve(Object.fromEntries(new URLSearchParams(body)));
        } else {
          resolve(body);
        }
      } catch (err) {
        reject(err);
      }
    });
    
    req.on("error", reject);
  });
}

function authenticateRequest(req: http.IncomingMessage, auth: WebhookAuth): boolean {
  switch (auth.type) {
    case "basic":
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Basic ")) return false;
      
      const credentials = Buffer.from(authHeader.slice(6), "base64").toString();
      const [username, password] = credentials.split(":");
      return username === auth.username && password === auth.password;
    
    case "token":
      const headerName = auth.headerName || "Authorization";
      const token = req.headers[headerName.toLowerCase()];
      return token === auth.token || token === `Bearer ${auth.token}`;
    
    case "hmac":
      // HMAC validation would go here
      return true;
    
    default:
      return true;
  }
}

const rateLimitStore: Map<string, number[]> = new Map();

function checkRateLimit(endpointId: string, limit: WebhookRateLimit): boolean {
  const now = Date.now();
  const windowStart = now - limit.windowMs;
  
  let requests = rateLimitStore.get(endpointId) || [];
  requests = requests.filter(t => t > windowStart);
  
  if (requests.length >= limit.maxRequests) {
    return false;
  }
  
  requests.push(now);
  rateLimitStore.set(endpointId, requests);
  return true;
}

async function handleBuiltinEndpoint(
  pathParts: string[],
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string
) {
  const [resource, action] = pathParts;
  
  let body: any = null;
  if (req.method !== "GET") {
    body = await parseRequestBody(req);
  }
  
  try {
    switch (resource) {
      case "health":
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", requestId }));
        break;
      
      case "trigger":
        if (action === "workflow") {
          const result = await triggerWorkflow(body.workflowId, body.input);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else if (action === "task") {
          const result = await triggerTask(body.taskId || body.templateId, body.input);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else if (action === "agent") {
          const result = await triggerAgent(body.agentId, body.input);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(404);
          res.end();
        }
        break;
      
      case "event":
        const eventResult = await emitEvent(body.eventType, body.data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(eventResult));
        break;
      
      default:
        res.writeHead(404);
        res.end();
    }
  } catch (error: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
}

// ============================================================================
// Trigger Functions
// ============================================================================

async function triggerWorkflow(workflowId: string, input: any): Promise<any> {
  eventEmitter.emit("n8n:trigger-workflow", { workflowId, input });
  notifyRenderer("n8n:workflow-triggered", { workflowId, input });
  return { triggered: true, workflowId, timestamp: new Date().toISOString() };
}

async function triggerTask(taskIdOrTemplate: string, input: any): Promise<any> {
  eventEmitter.emit("n8n:trigger-task", { taskId: taskIdOrTemplate, input });
  notifyRenderer("n8n:task-triggered", { taskId: taskIdOrTemplate, input });
  return { triggered: true, taskId: taskIdOrTemplate, timestamp: new Date().toISOString() };
}

async function triggerAgent(agentId: string, input: any): Promise<any> {
  eventEmitter.emit("n8n:trigger-agent", { agentId, input });
  notifyRenderer("n8n:agent-triggered", { agentId, input });
  return { triggered: true, agentId, timestamp: new Date().toISOString() };
}

async function emitEvent(eventType: string, data: any): Promise<any> {
  eventEmitter.emit(eventType, data);
  notifyRenderer("n8n:event-emitted", { eventType, data });
  return { emitted: true, eventType, timestamp: new Date().toISOString() };
}

// ============================================================================
// N8n API Client
// ============================================================================

async function n8nApiRequest(
  connection: N8nConnection,
  method: string,
  endpoint: string,
  body?: any
): Promise<any> {
  const url = `${connection.baseUrl}/api/v1${endpoint}`;
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  if (connection.apiKey) {
    headers["X-N8N-API-KEY"] = connection.apiKey;
  }
  
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    throw new Error(`N8n API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

async function testConnection(connection: N8nConnection): Promise<boolean> {
  try {
    const result = await n8nApiRequest(connection, "GET", "/workflows?limit=1");
    connection.status = "connected";
    connection.lastChecked = new Date();
    connection.error = undefined;
    
    // Try to get version
    try {
      const version = await n8nApiRequest(connection, "GET", "/");
      connection.version = version.version;
    } catch {
      // Version endpoint may not exist in all versions
    }
    
    return true;
  } catch (error: any) {
    connection.status = "error";
    connection.error = error.message;
    connection.lastChecked = new Date();
    return false;
  }
}

// ============================================================================
// Auto Sync
// ============================================================================

function startAutoSync() {
  if (syncInterval) return;
  
  syncInterval = setInterval(async () => {
    await performSync();
  }, config.syncInterval);
  
  logger.info("Auto-sync started");
}

function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    logger.info("Auto-sync stopped");
  }
}

async function performSync() {
  for (const mapping of mappings.values()) {
    try {
      const connection = connections.get(mapping.n8nConnectionId);
      if (!connection || connection.status !== "connected") continue;
      
      // Sync based on mode
      if (mapping.syncMode === "pull" || mapping.syncMode === "bidirectional") {
        await pullFromN8n(mapping, connection);
      }
      
      if (mapping.syncMode === "push" || mapping.syncMode === "bidirectional") {
        await pushToN8n(mapping, connection);
      }
      
      mapping.lastSynced = new Date();
      mapping.syncStatus = "synced";
      
    } catch (error: any) {
      logger.error(`Sync failed for mapping ${mapping.id}:`, error);
      mapping.syncStatus = "error";
    }
  }
  
  await saveMappings();
}

async function pullFromN8n(mapping: N8nMapping, connection: N8nConnection) {
  const workflow = await n8nApiRequest(
    connection,
    "GET",
    `/workflows/${mapping.n8nWorkflowId}`
  );
  
  // Transform and emit event for local update
  eventEmitter.emit("n8n:workflow-pulled", {
    mappingId: mapping.id,
    workflow,
    localType: mapping.localType,
    localId: mapping.localId,
  });
}

async function pushToN8n(mapping: N8nMapping, connection: N8nConnection) {
  // Get local data and push to n8n
  eventEmitter.emit("n8n:workflow-push-requested", {
    mappingId: mapping.id,
    localType: mapping.localType,
    localId: mapping.localId,
    n8nWorkflowId: mapping.n8nWorkflowId,
    connection,
  });
}

function notifyRenderer(channel: string, data: any) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerN8nIntegrationHandlers() {
  logger.info("Registering N8n Integration handlers");

  app.whenReady().then(() => {
    initializeN8nIntegration().catch(err => {
      logger.error("Failed to initialize n8n integration:", err);
    });
  });

  app.on("before-quit", async () => {
    stopAutoSync();
    await stopWebhookServer();
  });

  // ========== Configuration ==========

  ipcMain.handle("n8n:get-config", async () => {
    return { success: true, config };
  });

  ipcMain.handle("n8n:update-config", async (_event, updates: Partial<N8nConfig>) => {
    try {
      config = { ...config, ...updates };
      await saveConfig();
      
      // Handle enable/disable
      if (updates.enabled !== undefined) {
        if (updates.enabled) {
          await startWebhookServer();
        } else {
          await stopWebhookServer();
        }
      }
      
      // Handle auto-sync
      if (updates.autoSync !== undefined || updates.syncInterval !== undefined) {
        stopAutoSync();
        if (config.autoSync && config.syncInterval > 0) {
          startAutoSync();
        }
      }
      
      return { success: true, config };
    } catch (error) {
      logger.error("Update config failed:", error);
      throw error;
    }
  });

  // ========== Connection Management ==========

  ipcMain.handle("n8n:add-connection", async (_event, args: {
    name: string;
    baseUrl: string;
    apiKey?: string;
  }) => {
    try {
      const id = uuidv4();
      
      const connection: N8nConnection = {
        id,
        name: args.name,
        baseUrl: args.baseUrl.replace(/\/$/, ""),
        apiKey: args.apiKey,
        status: "disconnected",
      };
      
      // Test connection
      await testConnection(connection);
      
      connections.set(id, connection);
      await saveConnections();
      
      return { success: true, connection };
    } catch (error) {
      logger.error("Add connection failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:test-connection", async (_event, connectionId: string) => {
    try {
      const connection = connections.get(connectionId);
      if (!connection) throw new Error("Connection not found");
      
      const result = await testConnection(connection);
      await saveConnections();
      
      return { success: true, connected: result, connection };
    } catch (error) {
      logger.error("Test connection failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:list-connections", async () => {
    return { success: true, connections: Array.from(connections.values()) };
  });

  ipcMain.handle("n8n:remove-connection", async (_event, connectionId: string) => {
    try {
      connections.delete(connectionId);
      await saveConnections();
      return { success: true };
    } catch (error) {
      logger.error("Remove connection failed:", error);
      throw error;
    }
  });

  // ========== Workflow Operations ==========

  ipcMain.handle("n8n:list-workflows", async (_event, connectionId: string) => {
    try {
      const connection = connections.get(connectionId);
      if (!connection) throw new Error("Connection not found");
      
      const result = await n8nApiRequest(connection, "GET", "/workflows");
      return { success: true, workflows: result.data };
    } catch (error) {
      logger.error("List workflows failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:get-workflow", async (_event, args: {
    connectionId: string;
    workflowId: string;
  }) => {
    try {
      const connection = connections.get(args.connectionId);
      if (!connection) throw new Error("Connection not found");
      
      const workflow = await n8nApiRequest(
        connection,
        "GET",
        `/workflows/${args.workflowId}`
      );
      
      return { success: true, workflow };
    } catch (error) {
      logger.error("Get workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:create-workflow", async (_event, args: {
    connectionId: string;
    workflow: Partial<N8nWorkflow>;
  }) => {
    try {
      const connection = connections.get(args.connectionId);
      if (!connection) throw new Error("Connection not found");
      
      const result = await n8nApiRequest(
        connection,
        "POST",
        "/workflows",
        args.workflow
      );
      
      return { success: true, workflow: result };
    } catch (error) {
      logger.error("Create workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:execute-workflow", async (_event, args: {
    connectionId: string;
    workflowId: string;
    data?: any;
  }) => {
    try {
      const connection = connections.get(args.connectionId);
      if (!connection) throw new Error("Connection not found");
      
      const result = await n8nApiRequest(
        connection,
        "POST",
        `/workflows/${args.workflowId}/run`,
        { data: args.data }
      );
      
      return { success: true, execution: result };
    } catch (error) {
      logger.error("Execute workflow failed:", error);
      throw error;
    }
  });

  // ========== Webhook Endpoints ==========

  ipcMain.handle("n8n:create-webhook", async (_event, args: {
    path: string;
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    handler: WebhookHandler;
    authentication?: WebhookAuth;
    rateLimit?: WebhookRateLimit;
    description?: string;
  }) => {
    try {
      const id = uuidv4();
      
      const endpoint: WebhookEndpoint = {
        id,
        path: args.path.startsWith("/") ? args.path : `/${args.path}`,
        method: args.method || "POST",
        handler: args.handler,
        authentication: args.authentication,
        rateLimit: args.rateLimit,
        description: args.description,
        enabled: true,
        createdAt: new Date(),
        triggerCount: 0,
      };
      
      webhookEndpoints.set(id, endpoint);
      await saveWebhookEndpoints();
      
      const webhookUrl = `http://${config.webhookHost}:${config.webhookPort}${endpoint.path}`;
      
      return { success: true, endpoint, webhookUrl };
    } catch (error) {
      logger.error("Create webhook failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:list-webhooks", async () => {
    const result = Array.from(webhookEndpoints.values()).map(e => ({
      ...e,
      webhookUrl: `http://${config.webhookHost}:${config.webhookPort}${e.path}`,
    }));
    return { success: true, webhooks: result };
  });

  ipcMain.handle("n8n:delete-webhook", async (_event, webhookId: string) => {
    try {
      webhookEndpoints.delete(webhookId);
      await saveWebhookEndpoints();
      return { success: true };
    } catch (error) {
      logger.error("Delete webhook failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:toggle-webhook", async (_event, args: {
    webhookId: string;
    enabled: boolean;
  }) => {
    try {
      const endpoint = webhookEndpoints.get(args.webhookId);
      if (!endpoint) throw new Error("Webhook not found");
      
      endpoint.enabled = args.enabled;
      await saveWebhookEndpoints();
      
      return { success: true, endpoint };
    } catch (error) {
      logger.error("Toggle webhook failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:get-webhook-history", async (_event, args?: {
    endpointId?: string;
    limit?: number;
  }) => {
    let result = webhookHistory;
    
    if (args?.endpointId) {
      result = result.filter(r => r.endpointId === args.endpointId);
    }
    
    result = result.slice(-(args?.limit || 100));
    
    return { success: true, history: result };
  });

  // ========== Mappings ==========

  ipcMain.handle("n8n:create-mapping", async (_event, args: {
    name: string;
    description?: string;
    localType: "workflow" | "task" | "agent" | "pipeline";
    localId: string;
    n8nWorkflowId: string;
    n8nConnectionId: string;
    syncMode?: "push" | "pull" | "bidirectional";
    fieldMappings?: FieldMapping[];
    triggerConfig?: TriggerConfig;
  }) => {
    try {
      const id = uuidv4();
      
      const mapping: N8nMapping = {
        id,
        name: args.name,
        description: args.description,
        localType: args.localType,
        localId: args.localId,
        n8nWorkflowId: args.n8nWorkflowId,
        n8nConnectionId: args.n8nConnectionId,
        syncMode: args.syncMode || "bidirectional",
        fieldMappings: args.fieldMappings || [],
        triggerConfig: args.triggerConfig,
        syncStatus: "pending",
      };
      
      mappings.set(id, mapping);
      await saveMappings();
      
      // Create webhook if trigger is webhook
      if (args.triggerConfig?.type === "webhook" && args.triggerConfig.webhookPath) {
        const webhookId = uuidv4();
        const webhookEndpoint: WebhookEndpoint = {
          id: webhookId,
          path: args.triggerConfig.webhookPath,
          method: "POST",
          handler: {
            type: args.localType === "workflow" ? "workflow" : 
                  args.localType === "task" ? "task" :
                  args.localType === "agent" ? "agent" : "event",
            target: args.localId,
          },
          enabled: true,
          createdAt: new Date(),
          triggerCount: 0,
        };
        
        webhookEndpoints.set(webhookId, webhookEndpoint);
        await saveWebhookEndpoints();
      }
      
      return { success: true, mapping };
    } catch (error) {
      logger.error("Create mapping failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:list-mappings", async () => {
    return { success: true, mappings: Array.from(mappings.values()) };
  });

  ipcMain.handle("n8n:sync-mapping", async (_event, mappingId: string) => {
    try {
      const mapping = mappings.get(mappingId);
      if (!mapping) throw new Error("Mapping not found");
      
      const connection = connections.get(mapping.n8nConnectionId);
      if (!connection) throw new Error("Connection not found");
      
      if (mapping.syncMode === "pull" || mapping.syncMode === "bidirectional") {
        await pullFromN8n(mapping, connection);
      }
      
      if (mapping.syncMode === "push" || mapping.syncMode === "bidirectional") {
        await pushToN8n(mapping, connection);
      }
      
      mapping.lastSynced = new Date();
      mapping.syncStatus = "synced";
      await saveMappings();
      
      return { success: true, mapping };
    } catch (error) {
      logger.error("Sync mapping failed:", error);
      throw error;
    }
  });

  // ========== Templates ==========

  ipcMain.handle("n8n:list-templates", async (_event, category?: string) => {
    let result = Array.from(templates.values());
    
    if (category) {
      result = result.filter(t => t.category === category);
    }
    
    return { success: true, templates: result };
  });

  ipcMain.handle("n8n:deploy-template", async (_event, args: {
    templateId: string;
    connectionId: string;
    variables: Record<string, any>;
    name?: string;
  }) => {
    try {
      const template = templates.get(args.templateId);
      if (!template) throw new Error("Template not found");
      
      const connection = connections.get(args.connectionId);
      if (!connection) throw new Error("Connection not found");
      
      // Clone workflow and apply variables
      const workflow = JSON.parse(JSON.stringify(template.workflow));
      workflow.name = args.name || template.name;
      
      // Replace variables in workflow
      const workflowStr = JSON.stringify(workflow);
      let processedStr = workflowStr;
      
      for (const [key, value] of Object.entries(args.variables)) {
        processedStr = processedStr.replace(
          new RegExp(`\\{\\{\\$vars\\.${key}\\}\\}`, "g"),
          String(value)
        );
      }
      
      const processedWorkflow = JSON.parse(processedStr);
      
      // Create in n8n
      const result = await n8nApiRequest(connection, "POST", "/workflows", processedWorkflow);
      
      return { success: true, workflow: result };
    } catch (error) {
      logger.error("Deploy template failed:", error);
      throw error;
    }
  });

  // ========== Server Control ==========

  ipcMain.handle("n8n:start-server", async () => {
    try {
      await startWebhookServer();
      return { success: true, port: config.webhookPort };
    } catch (error) {
      logger.error("Start server failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:stop-server", async () => {
    try {
      await stopWebhookServer();
      return { success: true };
    } catch (error) {
      logger.error("Stop server failed:", error);
      throw error;
    }
  });

  ipcMain.handle("n8n:get-server-status", async () => {
    return {
      success: true,
      running: webhookServer !== null,
      port: config.webhookPort,
      host: config.webhookHost,
      endpointCount: webhookEndpoints.size,
    };
  });

  // ========== Event Subscription ==========

  ipcMain.handle("n8n:subscribe-events", async (_event, eventTypes: string[]) => {
    // This would typically set up event forwarding to the renderer
    // Events are already being emitted, this just registers interest
    return { success: true, subscribed: eventTypes };
  });

  logger.info("N8n Integration handlers registered");
}
