/**
 * OpenClaw-N8n Bridge
 * 
 * Connects OpenClaw Personal AI Assistant with n8n workflow automation.
 * OpenClaw can trigger workflows, receive webhook events, and use n8n
 * as an automation backend for complex multi-step tasks.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE! - Automation supremacy!
 */

import { EventEmitter } from "events";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";

const logger = log.scope("openclaw_n8n");

// =============================================================================
// TYPES
// =============================================================================

export interface N8nConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  status: "connected" | "disconnected" | "error";
  lastChecked?: Date;
  version?: string;
}

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: "waiting" | "running" | "success" | "error";
  startedAt: string;
  stoppedAt?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface OpenClawN8nConfig {
  /** Default n8n connection */
  defaultConnectionId?: string;
  
  /** n8n base URL */
  baseUrl: string;
  
  /** API key for n8n */
  apiKey?: string;
  
  /** Local webhook port for receiving n8n events */
  webhookPort: number;
  
  /** Enable automatic workflow execution on OpenClaw events */
  autoTrigger: boolean;
  
  /** Map OpenClaw channels to n8n workflows */
  channelWorkflowMap: Record<string, string>;
  
  /** Map OpenClaw events to n8n workflows */
  eventWorkflowMap: Record<string, string>;
  
  /** Retry failed workflow executions */
  retryOnFailure: boolean;
  
  /** Max retry attempts */
  maxRetries: number;
}

export interface WorkflowTriggerRequest {
  workflowId: string;
  connectionId?: string;
  data?: Record<string, unknown>;
  waitForCompletion?: boolean;
  timeout?: number;
}

export interface WorkflowTriggerResponse {
  executionId: string;
  status: "triggered" | "completed" | "failed";
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface OpenClawN8nEvent {
  type: "message" | "agent" | "channel" | "memory" | "custom";
  channel?: string;
  agentId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// =============================================================================
// OPENCLAW N8N BRIDGE
// =============================================================================

export class OpenClawN8nBridge extends EventEmitter {
  private static instance: OpenClawN8nBridge;
  
  private config: OpenClawN8nConfig = {
    baseUrl: "http://localhost:5678",
    webhookPort: 5679,
    autoTrigger: true,
    channelWorkflowMap: {},
    eventWorkflowMap: {},
    retryOnFailure: true,
    maxRetries: 3,
  };
  
  private connections: Map<string, N8nConnection> = new Map();
  private activeExecutions: Map<string, N8nExecution> = new Map();
  private executionHistory: N8nExecution[] = [];
  private initialized = false;
  
  // Webhook registry - maps OpenClaw events to n8n workflows
  private webhookRegistry: Map<string, {
    eventPattern: string;
    workflowId: string;
    connectionId: string;
    transform?: (data: unknown) => unknown;
  }> = new Map();
  
  private constructor() {
    super();
  }
  
  static getInstance(): OpenClawN8nBridge {
    if (!OpenClawN8nBridge.instance) {
      OpenClawN8nBridge.instance = new OpenClawN8nBridge();
    }
    return OpenClawN8nBridge.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(config?: Partial<OpenClawN8nConfig>): Promise<void> {
    if (this.initialized) return;
    
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    logger.info("🦞 Initializing OpenClaw-N8n bridge...");
    
    // Setup default connection if baseUrl provided
    if (this.config.baseUrl) {
      await this.addConnection({
        id: "default",
        name: "Default N8n",
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
      });
    }
    
    // Setup event workflow mappings
    this.setupEventMappings();
    
    this.initialized = true;
    
    logger.info("🦞 OpenClaw-N8n bridge initialized", {
      connections: this.connections.size,
      webhooks: this.webhookRegistry.size,
    });
    
    this.emit("initialized");
  }
  
  private setupEventMappings(): void {
    // Map channel workflows
    for (const [channel, workflowId] of Object.entries(this.config.channelWorkflowMap)) {
      this.registerWebhook({
        eventPattern: `channel:${channel}:*`,
        workflowId,
        connectionId: this.config.defaultConnectionId || "default",
      });
    }
    
    // Map event workflows
    for (const [event, workflowId] of Object.entries(this.config.eventWorkflowMap)) {
      this.registerWebhook({
        eventPattern: event,
        workflowId,
        connectionId: this.config.defaultConnectionId || "default",
      });
    }
  }
  
  async shutdown(): Promise<void> {
    this.initialized = false;
    this.connections.clear();
    this.webhookRegistry.clear();
    this.emit("shutdown");
    logger.info("🦞 OpenClaw-N8n bridge shut down");
  }
  
  // ===========================================================================
  // CONNECTION MANAGEMENT
  // ===========================================================================
  
  async addConnection(connection: Omit<N8nConnection, "status">): Promise<N8nConnection> {
    const fullConnection: N8nConnection = {
      ...connection,
      status: "disconnected",
    };
    
    // Test connection
    const isValid = await this.testConnection(fullConnection);
    
    fullConnection.status = isValid ? "connected" : "error";
    fullConnection.lastChecked = new Date();
    
    this.connections.set(connection.id, fullConnection);
    
    this.emit("connection:added", fullConnection);
    
    return fullConnection;
  }
  
  async removeConnection(connectionId: string): Promise<void> {
    this.connections.delete(connectionId);
    this.emit("connection:removed", { connectionId });
  }
  
  async testConnection(connection: N8nConnection): Promise<boolean> {
    try {
      const response = await fetch(`${connection.baseUrl}/api/v1/workflows`, {
        method: "GET",
        headers: this.getHeaders(connection),
        signal: AbortSignal.timeout(5000),
      });
      
      return response.ok;
    } catch (error) {
      logger.error(`N8n connection test failed for ${connection.id}:`, error);
      return false;
    }
  }
  
  async refreshConnectionStatus(connectionId: string): Promise<N8nConnection | null> {
    const connection = this.connections.get(connectionId);
    if (!connection) return null;
    
    const isValid = await this.testConnection(connection);
    
    connection.status = isValid ? "connected" : "error";
    connection.lastChecked = new Date();
    
    this.connections.set(connectionId, connection);
    
    return connection;
  }
  
  getConnection(connectionId: string): N8nConnection | undefined {
    return this.connections.get(connectionId);
  }
  
  getAllConnections(): N8nConnection[] {
    return Array.from(this.connections.values());
  }
  
  private getHeaders(connection: N8nConnection): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (connection.apiKey) {
      headers["X-N8N-API-KEY"] = connection.apiKey;
    }
    
    return headers;
  }
  
  // ===========================================================================
  // WORKFLOW MANAGEMENT
  // ===========================================================================
  
  async listWorkflows(connectionId?: string): Promise<N8nWorkflowSummary[]> {
    const connId = connectionId || this.config.defaultConnectionId || "default";
    const connection = this.connections.get(connId);
    
    if (!connection) {
      throw new Error(`Connection not found: ${connId}`);
    }
    
    const response = await fetch(`${connection.baseUrl}/api/v1/workflows`, {
      method: "GET",
      headers: this.getHeaders(connection),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to list workflows: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return (data.data || data || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      tags: w.tags?.map((t: any) => t.name || t),
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }));
  }
  
  async getWorkflow(workflowId: string, connectionId?: string): Promise<any> {
    const connId = connectionId || this.config.defaultConnectionId || "default";
    const connection = this.connections.get(connId);
    
    if (!connection) {
      throw new Error(`Connection not found: ${connId}`);
    }
    
    const response = await fetch(`${connection.baseUrl}/api/v1/workflows/${workflowId}`, {
      method: "GET",
      headers: this.getHeaders(connection),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get workflow: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  // ===========================================================================
  // WORKFLOW EXECUTION
  // ===========================================================================
  
  /**
   * Trigger a workflow execution
   */
  async triggerWorkflow(request: WorkflowTriggerRequest): Promise<WorkflowTriggerResponse> {
    const connId = request.connectionId || this.config.defaultConnectionId || "default";
    const connection = this.connections.get(connId);
    
    if (!connection) {
      throw new Error(`Connection not found: ${connId}`);
    }
    
    const startTime = Date.now();
    const executionId = uuidv4();
    
    this.emit("workflow:triggering", {
      executionId,
      workflowId: request.workflowId,
    });
    
    try {
      // Trigger workflow via n8n API
      const response = await fetch(
        `${connection.baseUrl}/api/v1/workflows/${request.workflowId}/activate`,
        {
          method: "POST",
          headers: this.getHeaders(connection),
          body: JSON.stringify({ data: request.data }),
        }
      );
      
      // Alternative: Use webhook trigger if available
      if (!response.ok) {
        // Try webhook endpoint
        const webhookResponse = await this.triggerViaWebhook(
          connection,
          request.workflowId,
          request.data
        );
        
        if (webhookResponse) {
          return webhookResponse;
        }
        
        throw new Error(`Failed to trigger workflow: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Track execution
      const execution: N8nExecution = {
        id: result.id || executionId,
        workflowId: request.workflowId,
        status: "running",
        startedAt: new Date().toISOString(),
        data: request.data,
      };
      
      this.activeExecutions.set(execution.id, execution);
      
      // Wait for completion if requested
      if (request.waitForCompletion) {
        return this.waitForExecution(
          execution.id,
          connId,
          request.timeout || 60000
        );
      }
      
      return {
        executionId: execution.id,
        status: "triggered",
        duration: Date.now() - startTime,
      };
      
    } catch (error) {
      // Retry logic
      if (this.config.retryOnFailure) {
        return this.retryWorkflowTrigger(request, 0);
      }
      
      this.emit("workflow:failed", {
        executionId,
        workflowId: request.workflowId,
        error,
      });
      
      return {
        executionId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
  
  private async triggerViaWebhook(
    connection: N8nConnection,
    workflowId: string,
    data?: Record<string, unknown>
  ): Promise<WorkflowTriggerResponse | null> {
    try {
      // Try common webhook paths
      const webhookPaths = [
        `/webhook/${workflowId}`,
        `/webhook-test/${workflowId}`,
        `/webhook/joycreate/${workflowId}`,
      ];
      
      for (const path of webhookPaths) {
        const response = await fetch(`${connection.baseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data || {}),
        });
        
        if (response.ok) {
          const result = await response.json().catch(() => ({}));
          
          return {
            executionId: result.executionId || uuidv4(),
            status: "completed",
            result,
          };
        }
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  private async waitForExecution(
    executionId: string,
    connectionId: string,
    timeout: number
  ): Promise<WorkflowTriggerResponse> {
    const startTime = Date.now();
    const connection = this.connections.get(connectionId)!;
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(
          `${connection.baseUrl}/api/v1/executions/${executionId}`,
          {
            method: "GET",
            headers: this.getHeaders(connection),
          }
        );
        
        if (response.ok) {
          const execution = await response.json();
          
          if (execution.status === "success" || execution.finished) {
            return {
              executionId,
              status: "completed",
              result: execution.data,
              duration: Date.now() - startTime,
            };
          }
          
          if (execution.status === "error") {
            return {
              executionId,
              status: "failed",
              error: execution.error,
              duration: Date.now() - startTime,
            };
          }
        }
      } catch {
        // Continue polling
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return {
      executionId,
      status: "failed",
      error: "Execution timeout",
      duration: timeout,
    };
  }
  
  private async retryWorkflowTrigger(
    request: WorkflowTriggerRequest,
    attempt: number
  ): Promise<WorkflowTriggerResponse> {
    if (attempt >= this.config.maxRetries) {
      return {
        executionId: uuidv4(),
        status: "failed",
        error: `Failed after ${this.config.maxRetries} retries`,
      };
    }
    
    // Exponential backoff
    await new Promise(resolve => 
      setTimeout(resolve, Math.pow(2, attempt) * 1000)
    );
    
    try {
      return await this.triggerWorkflow({
        ...request,
        waitForCompletion: false, // Don't wait on retries
      });
    } catch {
      return this.retryWorkflowTrigger(request, attempt + 1);
    }
  }
  
  // ===========================================================================
  // WEBHOOK REGISTRY
  // ===========================================================================
  
  /**
   * Register an event-to-workflow mapping
   */
  registerWebhook(config: {
    eventPattern: string;
    workflowId: string;
    connectionId: string;
    transform?: (data: unknown) => unknown;
  }): string {
    const id = uuidv4();
    
    this.webhookRegistry.set(id, config);
    
    this.emit("webhook:registered", {
      id,
      ...config,
    });
    
    return id;
  }
  
  unregisterWebhook(webhookId: string): void {
    this.webhookRegistry.delete(webhookId);
    this.emit("webhook:unregistered", { webhookId });
  }
  
  /**
   * Handle an OpenClaw event - trigger matching workflows
   */
  async handleOpenClawEvent(event: OpenClawN8nEvent): Promise<void> {
    if (!this.config.autoTrigger) return;
    
    const eventKey = this.buildEventKey(event);
    
    logger.debug("Processing OpenClaw event:", eventKey);
    
    // Find matching webhooks
    for (const [id, config] of this.webhookRegistry) {
      if (this.matchesPattern(eventKey, config.eventPattern)) {
        try {
          const data = config.transform 
            ? config.transform(event.data) 
            : event.data;
          
          await this.triggerWorkflow({
            workflowId: config.workflowId,
            connectionId: config.connectionId,
            data: {
              event: event.type,
              channel: event.channel,
              agentId: event.agentId,
              timestamp: event.timestamp,
              payload: data,
            },
          });
          
          this.emit("event:triggered", {
            webhookId: id,
            event: eventKey,
            workflowId: config.workflowId,
          });
          
        } catch (error) {
          logger.error(`Failed to trigger workflow for event ${eventKey}:`, error);
          this.emit("event:failed", {
            webhookId: id,
            event: eventKey,
            error,
          });
        }
      }
    }
  }
  
  private buildEventKey(event: OpenClawN8nEvent): string {
    let key: string = event.type;
    
    if (event.channel) {
      key = `channel:${event.channel}:${event.type}`;
    } else if (event.agentId) {
      key = `agent:${event.agentId}:${event.type}`;
    }
    
    return key;
  }
  
  private matchesPattern(eventKey: string, pattern: string): boolean {
    // Convert pattern to regex
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
    );
    return regex.test(eventKey);
  }
  
  // ===========================================================================
  // OPENCLAW INTEGRATION METHODS
  // ===========================================================================
  
  /**
   * Trigger n8n workflow when message received on OpenClaw channel
   */
  async onChannelMessage(
    channel: string,
    message: string,
    sender: string,
    metadata?: Record<string, unknown>
  ): Promise<WorkflowTriggerResponse | null> {
    const workflowId = this.config.channelWorkflowMap[channel];
    
    if (!workflowId) {
      logger.debug(`No workflow mapped for channel: ${channel}`);
      return null;
    }
    
    return this.triggerWorkflow({
      workflowId,
      data: {
        channel,
        message,
        sender,
        metadata,
        timestamp: Date.now(),
      },
    });
  }
  
  /**
   * Trigger n8n workflow when agent completes a task
   */
  async onAgentComplete(
    agentId: string,
    taskType: string,
    result: unknown
  ): Promise<WorkflowTriggerResponse | null> {
    const workflowId = this.config.eventWorkflowMap[`agent:${taskType}`] ||
      this.config.eventWorkflowMap["agent:*"];
    
    if (!workflowId) {
      return null;
    }
    
    return this.triggerWorkflow({
      workflowId,
      data: {
        agentId,
        taskType,
        result,
        timestamp: Date.now(),
      },
    });
  }
  
  /**
   * Send message to OpenClaw channel via n8n workflow
   */
  async sendViaWorkflow(
    channel: string,
    message: string,
    workflowId: string
  ): Promise<WorkflowTriggerResponse> {
    return this.triggerWorkflow({
      workflowId,
      data: {
        action: "send",
        channel,
        message,
        timestamp: Date.now(),
      },
      waitForCompletion: true,
    });
  }
  
  // ===========================================================================
  // EXECUTION HISTORY
  // ===========================================================================
  
  getActiveExecutions(): N8nExecution[] {
    return Array.from(this.activeExecutions.values());
  }
  
  getExecutionHistory(limit = 100): N8nExecution[] {
    return this.executionHistory.slice(-limit);
  }
  
  // ===========================================================================
  // GETTERS
  // ===========================================================================
  
  getConfig(): OpenClawN8nConfig {
    return { ...this.config };
  }
  
  updateConfig(config: Partial<OpenClawN8nConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Re-setup event mappings if changed
    if (config.channelWorkflowMap || config.eventWorkflowMap) {
      this.setupEventMappings();
    }
    
    this.emit("config:updated", this.config);
  }
  
  getStatus() {
    return {
      initialized: this.initialized,
      connections: this.getAllConnections(),
      activeExecutions: this.activeExecutions.size,
      webhookCount: this.webhookRegistry.size,
      config: this.config,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

let instance: OpenClawN8nBridge | null = null;

export function getOpenClawN8nBridge(): OpenClawN8nBridge {
  if (!instance) {
    instance = OpenClawN8nBridge.getInstance();
  }
  return instance;
}

export default OpenClawN8nBridge;
