/**
 * Hybrid Bridge Types
 * Types for seamless local/cloud integration through n8n
 * Enables best of both worlds: cloud API tools + full local data creation
 */

// ============================================================================
// Connection & Health Types
// ============================================================================

export type ConnectionState = 
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ConnectionHealth {
  state: ConnectionState;
  lastCheck: string;
  latencyMs?: number;
  errorCount: number;
  lastError?: string;
  uptime?: number; // seconds since connected
  reconnectAttempts: number;
}

export interface ServiceEndpoint {
  id: string;
  name: string;
  type: "local" | "cloud" | "hybrid";
  url: string;
  healthEndpoint?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// ============================================================================
// Hybrid Bridge Configuration
// ============================================================================

export interface HybridBridgeConfig {
  // n8n Configuration
  n8n: {
    enabled: boolean;
    autoStart: boolean;
    autoRestart: boolean;
    healthCheckInterval: number; // ms
    maxRestartAttempts: number;
    restartDelayMs: number;
    port: number;
    host: string;
  };
  
  // Sync Configuration
  sync: {
    enabled: boolean;
    mode: SyncMode;
    conflictResolution: ConflictResolution;
    batchSize: number;
    intervalMs: number;
    retryPolicy: RetryPolicy;
  };
  
  // Service Endpoints
  services: ServiceEndpoint[];
  
  // Data Routing
  routing: DataRouting;
}

export type SyncMode = 
  | "local-first"      // Always use local, sync to cloud async
  | "cloud-first"      // Prefer cloud, cache locally
  | "hybrid"           // Smart routing based on availability
  | "offline-only"     // Never sync to cloud
  | "realtime";        // Bidirectional realtime sync

export type ConflictResolution =
  | "local-wins"
  | "cloud-wins"
  | "newest-wins"
  | "manual"
  | "merge";

export interface DataRouting {
  // Define where different data types should go
  rules: DataRoutingRule[];
  defaultRoute: "local" | "cloud" | "both";
}

export interface DataRoutingRule {
  dataType: string;
  pattern?: string;
  route: "local" | "cloud" | "both";
  syncStrategy?: SyncMode;
  priority?: number;
}

// ============================================================================
// Sync Types
// ============================================================================

export interface SyncState {
  lastSync: string;
  pendingLocal: number;    // Items waiting to sync to cloud
  pendingCloud: number;    // Items waiting to sync to local
  inProgress: boolean;
  conflicts: SyncConflict[];
  errors: SyncError[];
}

export interface SyncConflict {
  id: string;
  dataType: string;
  localVersion: any;
  cloudVersion: any;
  localTimestamp: string;
  cloudTimestamp: string;
  resolution?: ConflictResolution;
  resolved: boolean;
}

export interface SyncError {
  id: string;
  timestamp: string;
  operation: "push" | "pull" | "merge";
  dataType: string;
  dataId: string;
  error: string;
  retryCount: number;
  resolved: boolean;
}

export interface SyncOperation {
  id: string;
  type: "push" | "pull" | "delete" | "merge";
  dataType: string;
  dataId: string;
  data?: any;
  timestamp: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  retries: number;
  error?: string;
}

export interface SyncBatch {
  id: string;
  operations: SyncOperation[];
  startedAt?: string;
  completedAt?: string;
  status: "pending" | "in-progress" | "completed" | "partial" | "failed";
  successCount: number;
  failureCount: number;
}

// ============================================================================
// Service Bridge Types
// ============================================================================

export interface ServiceBridge {
  id: string;
  name: string;
  description: string;
  type: ServiceBridgeType;
  config: ServiceBridgeConfig;
  status: ConnectionHealth;
  capabilities: string[];
}

export type ServiceBridgeType =
  | "ai-provider"        // OpenAI, Anthropic, etc.
  | "storage"            // S3, IPFS, etc.
  | "database"           // Supabase, Firebase, etc.
  | "deployment"         // Vercel, Netlify, etc.
  | "messaging"          // Slack, Discord, etc.
  | "analytics"          // PostHog, Mixpanel, etc.
  | "payment"            // Stripe, etc.
  | "custom";

export interface ServiceBridgeConfig {
  // Connection
  endpoint: ServiceEndpoint;
  
  // Authentication
  auth?: {
    type: "api-key" | "oauth" | "jwt" | "basic" | "none";
    credentials?: Record<string, string>;
    refreshToken?: string;
    expiresAt?: string;
  };
  
  // Rate Limiting
  rateLimit?: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
    currentUsage?: {
      minute: number;
      hour: number;
      day: number;
      lastReset: string;
    };
  };
  
  // Caching
  cache?: {
    enabled: boolean;
    ttlSeconds: number;
    maxSize: number;
    strategy: "lru" | "fifo" | "ttl";
  };
  
  // Fallback
  fallback?: {
    enabled: boolean;
    localFallback?: boolean;
    alternativeService?: string;
  };
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface BridgeRequest {
  id: string;
  service: string;
  operation: string;
  data?: any;
  options?: {
    timeout?: number;
    retries?: number;
    cache?: boolean;
    priority?: "low" | "normal" | "high";
    routePreference?: "local" | "cloud" | "auto";
  };
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface BridgeResponse {
  id: string;
  requestId: string;
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  source: "local" | "cloud" | "cache";
  latencyMs: number;
  timestamp: string;
}

// ============================================================================
// Workflow Bridge Types (n8n Integration)
// ============================================================================

export interface WorkflowBridge {
  id: string;
  name: string;
  description: string;
  
  // Trigger
  trigger: {
    type: "manual" | "schedule" | "webhook" | "event" | "data-change";
    config: any;
  };
  
  // Data Flow
  input: {
    source: "local" | "cloud" | "both";
    dataTypes: string[];
    filter?: any;
  };
  
  output: {
    destination: "local" | "cloud" | "both";
    dataType: string;
    transform?: any;
  };
  
  // n8n Workflow
  n8nWorkflowId?: string;
  n8nWorkflowActive: boolean;
  
  // Status
  status: "active" | "paused" | "error" | "draft";
  lastRun?: string;
  runCount: number;
  errorCount: number;
}

export interface WorkflowExecution {
  id: string;
  bridgeId: string;
  n8nExecutionId?: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  inputData?: any;
  outputData?: any;
  error?: string;
  logs: WorkflowLog[];
}

export interface WorkflowLog {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  node?: string;
  message: string;
  data?: any;
}

// ============================================================================
// Event Types
// ============================================================================

export type HybridBridgeEvent =
  | { type: "connection:changed"; state: ConnectionState; service?: string }
  | { type: "sync:started"; batchId: string }
  | { type: "sync:completed"; batchId: string; stats: SyncBatch }
  | { type: "sync:error"; error: SyncError }
  | { type: "sync:conflict"; conflict: SyncConflict }
  | { type: "workflow:started"; executionId: string }
  | { type: "workflow:completed"; executionId: string; result: any }
  | { type: "workflow:error"; executionId: string; error: string }
  | { type: "service:connected"; serviceId: string }
  | { type: "service:disconnected"; serviceId: string; reason?: string }
  | { type: "n8n:started" }
  | { type: "n8n:stopped"; reason?: string }
  | { type: "n8n:restarting"; attempt: number }
  | { type: "n8n:error"; error: string };

// ============================================================================
// Result Types
// ============================================================================

export interface HybridBridgeStatus {
  n8n: {
    running: boolean;
    health: ConnectionHealth;
    workflowCount: number;
    activeWorkflows: number;
  };
  
  sync: {
    state: SyncState;
    lastSync: string;
    nextSync?: string;
  };
  
  services: Array<{
    id: string;
    name: string;
    type: ServiceBridgeType;
    health: ConnectionHealth;
  }>;
  
  bridges: Array<{
    id: string;
    name: string;
    status: WorkflowBridge["status"];
    lastRun?: string;
  }>;
}

export interface StartBridgeResult {
  success: boolean;
  n8nStarted: boolean;
  servicesConnected: string[];
  servicesFailed: Array<{ id: string; error: string }>;
  error?: string;
}

export interface StopBridgeResult {
  success: boolean;
  n8nStopped: boolean;
  servicesDisconnected: string[];
}
