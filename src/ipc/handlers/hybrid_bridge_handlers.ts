/**
 * Hybrid Bridge Handlers
 * Manages seamless local/cloud integration through n8n
 * Auto-reconnect, health monitoring, and service bridging
 */

import { ipcMain, BrowserWindow } from "electron";
import { spawn, ChildProcess, exec } from "child_process";
import path from "node:path";
import fs from "fs-extra";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";
import {
  startN8n as n8nStart,
  stopN8n as n8nStop,
  isN8nRunning,
  configureN8nDatabase,
} from "./n8n_handlers";

import type {
  HybridBridgeConfig,
  ConnectionState,
  ConnectionHealth,
  ServiceEndpoint,
  ServiceBridge,
  SyncState,
  SyncOperation,
  SyncBatch,
  SyncConflict,
  SyncError,
  HybridBridgeEvent,
  HybridBridgeStatus,
  StartBridgeResult,
  StopBridgeResult,
  WorkflowBridge,
  BridgeRequest,
  BridgeResponse,
} from "@/types/hybrid_bridge_types";

const logger = log.scope("hybrid_bridge");

// ============================================================================
// State Management
// ============================================================================

let bridgeConfig: HybridBridgeConfig = getDefaultConfig();
let connectionHealth: ConnectionHealth = getInitialHealth();
let services: Map<string, ServiceBridge> = new Map();
let syncState: SyncState = getInitialSyncState();
let workflowBridges: Map<string, WorkflowBridge> = new Map();
let healthCheckInterval: NodeJS.Timeout | null = null;
let syncInterval: NodeJS.Timeout | null = null;
let restartAttempts = 0;
let mainWindow: BrowserWindow | null = null;

function getDefaultConfig(): HybridBridgeConfig {
  return {
    n8n: {
      enabled: true,
      autoStart: true,
      autoRestart: true,
      healthCheckInterval: 5000, // 5 seconds
      maxRestartAttempts: 5,
      restartDelayMs: 3000,
      port: 5678,
      host: "localhost",
    },
    sync: {
      enabled: true,
      mode: "local-first",
      conflictResolution: "newest-wins",
      batchSize: 50,
      intervalMs: 30000, // 30 seconds
      retryPolicy: {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
    },
    services: [],
    routing: {
      rules: [],
      defaultRoute: "local",
    },
  };
}

function getInitialHealth(): ConnectionHealth {
  return {
    state: "disconnected",
    lastCheck: new Date().toISOString(),
    errorCount: 0,
    reconnectAttempts: 0,
  };
}

function getInitialSyncState(): SyncState {
  return {
    lastSync: new Date().toISOString(),
    pendingLocal: 0,
    pendingCloud: 0,
    inProgress: false,
    conflicts: [],
    errors: [],
  };
}

// ============================================================================
// Event Emission
// ============================================================================

function emitEvent(event: HybridBridgeEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("hybrid-bridge:event", event);
  }
  logger.debug("Bridge event:", event.type);
}

function updateConnectionState(state: ConnectionState, service?: string): void {
  connectionHealth.state = state;
  connectionHealth.lastCheck = new Date().toISOString();
  emitEvent({ type: "connection:changed", state, service });
}

// ============================================================================
// n8n Process Management with Auto-Reconnect
// ============================================================================

async function checkN8nHealth(): Promise<boolean> {
  try {
    const url = `http://${bridgeConfig.n8n.host}:${bridgeConfig.n8n.port}/healthz`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const startTime = Date.now();
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (response.ok) {
      connectionHealth.latencyMs = Date.now() - startTime;
      connectionHealth.errorCount = 0;
      if (connectionHealth.state !== "connected") {
        updateConnectionState("connected");
        restartAttempts = 0;
      }
      return true;
    }
    return false;
  } catch (error) {
    connectionHealth.errorCount++;
    connectionHealth.lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function restartN8n(): Promise<void> {
  if (restartAttempts >= bridgeConfig.n8n.maxRestartAttempts) {
    logger.error("Max n8n restart attempts reached");
    updateConnectionState("error");
    emitEvent({ 
      type: "n8n:error", 
      error: `Failed to restart n8n after ${restartAttempts} attempts` 
    });
    return;
  }

  restartAttempts++;
  updateConnectionState("reconnecting");
  emitEvent({ type: "n8n:restarting", attempt: restartAttempts });
  
  logger.info(`Attempting to restart n8n (attempt ${restartAttempts}/${bridgeConfig.n8n.maxRestartAttempts})`);

  // Calculate delay with exponential backoff
  const delay = Math.min(
    bridgeConfig.n8n.restartDelayMs * Math.pow(2, restartAttempts - 1),
    30000 // Max 30 seconds
  );
  
  await new Promise(resolve => setTimeout(resolve, delay));

  try {
    // Stop existing process if any
    await n8nStop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Start fresh
    const result = await n8nStart();
    if (result.success) {
      logger.info("n8n restarted successfully");
      restartAttempts = 0;
      updateConnectionState("connected");
      emitEvent({ type: "n8n:started" });
    } else {
      throw new Error(result.error || "Failed to start n8n");
    }
  } catch (error) {
    logger.error("Failed to restart n8n:", error);
    if (bridgeConfig.n8n.autoRestart && restartAttempts < bridgeConfig.n8n.maxRestartAttempts) {
      // Schedule another restart attempt
      setTimeout(() => restartN8n(), 1000);
    }
  }
}

function startHealthMonitoring(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  healthCheckInterval = setInterval(async () => {
    const healthy = await checkN8nHealth();
    
    if (!healthy && bridgeConfig.n8n.autoRestart && connectionHealth.state !== "reconnecting") {
      logger.warn("n8n health check failed, attempting restart");
      emitEvent({ type: "n8n:stopped", reason: "Health check failed" });
      restartN8n();
    }
  }, bridgeConfig.n8n.healthCheckInterval);

  logger.info("Health monitoring started");
}

function stopHealthMonitoring(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// ============================================================================
// Service Bridge Management
// ============================================================================

async function connectService(endpoint: ServiceEndpoint): Promise<ServiceBridge> {
  const bridge: ServiceBridge = {
    id: endpoint.id,
    name: endpoint.name,
    description: `Bridge to ${endpoint.name}`,
    type: "custom",
    config: {
      endpoint,
    },
    status: {
      state: "connecting",
      lastCheck: new Date().toISOString(),
      errorCount: 0,
      reconnectAttempts: 0,
    },
    capabilities: [],
  };

  try {
    // Test connection
    const healthUrl = endpoint.healthEndpoint || endpoint.url;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), endpoint.timeout || 10000);

    const headers: Record<string, string> = { ...endpoint.headers };
    if (endpoint.apiKey) {
      headers["Authorization"] = `Bearer ${endpoint.apiKey}`;
    }

    const response = await fetch(healthUrl, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      bridge.status.state = "connected";
      emitEvent({ type: "service:connected", serviceId: bridge.id });
    } else {
      throw new Error(`Service returned ${response.status}`);
    }
  } catch (error) {
    bridge.status.state = "error";
    bridge.status.lastError = error instanceof Error ? error.message : String(error);
    bridge.status.errorCount++;
    logger.error(`Failed to connect to service ${endpoint.name}:`, error);
  }

  services.set(bridge.id, bridge);
  return bridge;
}

async function disconnectService(serviceId: string): Promise<void> {
  const service = services.get(serviceId);
  if (service) {
    service.status.state = "disconnected";
    emitEvent({ type: "service:disconnected", serviceId });
    services.delete(serviceId);
  }
}

async function reconnectService(serviceId: string): Promise<boolean> {
  const service = services.get(serviceId);
  if (!service) return false;

  const endpoint = bridgeConfig.services.find(s => s.id === serviceId);
  if (!endpoint) return false;

  await connectService(endpoint);
  return services.get(serviceId)?.status.state === "connected";
}

// ============================================================================
// Sync Operations
// ============================================================================

async function runSyncCycle(): Promise<SyncBatch> {
  if (syncState.inProgress) {
    logger.debug("Sync already in progress, skipping");
    return {
      id: `skip-${Date.now()}`,
      operations: [],
      status: "completed",
      successCount: 0,
      failureCount: 0,
    };
  }

  syncState.inProgress = true;
  const batchId = `batch-${Date.now()}`;
  emitEvent({ type: "sync:started", batchId });

  const batch: SyncBatch = {
    id: batchId,
    operations: [],
    startedAt: new Date().toISOString(),
    status: "in-progress",
    successCount: 0,
    failureCount: 0,
  };

  try {
    // Get pending operations from local queue
    const pendingOps = await getPendingSyncOperations();
    batch.operations = pendingOps;

    for (const op of pendingOps) {
      try {
        await executeSyncOperation(op);
        op.status = "completed";
        batch.successCount++;
      } catch (error) {
        op.status = "failed";
        op.error = error instanceof Error ? error.message : String(error);
        op.retries++;
        batch.failureCount++;

        if (op.retries < bridgeConfig.sync.retryPolicy.maxRetries) {
          // Re-queue for retry
          await queueSyncOperation(op);
        } else {
          // Log as sync error
          const syncError: SyncError = {
            id: `error-${Date.now()}`,
            timestamp: new Date().toISOString(),
            operation: op.type as any,
            dataType: op.dataType,
            dataId: op.dataId,
            error: op.error || "Max retries exceeded",
            retryCount: op.retries,
            resolved: false,
          };
          syncState.errors.push(syncError);
          emitEvent({ type: "sync:error", error: syncError });
        }
      }
    }

    batch.completedAt = new Date().toISOString();
    batch.status = batch.failureCount === 0 ? "completed" : "partial";
    syncState.lastSync = batch.completedAt;
  } catch (error) {
    batch.status = "failed";
    logger.error("Sync cycle failed:", error);
  } finally {
    syncState.inProgress = false;
    emitEvent({ type: "sync:completed", batchId, stats: batch });
  }

  return batch;
}

async function getPendingSyncOperations(): Promise<SyncOperation[]> {
  // TODO: Get from local sync queue (database or file)
  // For now, return empty array
  return [];
}

async function queueSyncOperation(op: SyncOperation): Promise<void> {
  // TODO: Save to local sync queue
  logger.debug("Queued sync operation:", op.id);
}

async function executeSyncOperation(op: SyncOperation): Promise<void> {
  logger.debug(`Executing sync operation: ${op.type} for ${op.dataType}/${op.dataId}`);
  
  // Route based on operation type and config
  switch (op.type) {
    case "push":
      await pushToCloud(op);
      break;
    case "pull":
      await pullFromCloud(op);
      break;
    case "delete":
      await syncDelete(op);
      break;
    case "merge":
      await mergeData(op);
      break;
  }
}

async function pushToCloud(op: SyncOperation): Promise<void> {
  // Find appropriate service bridge
  const service = Array.from(services.values()).find(
    s => s.type === "storage" || s.type === "database"
  );
  
  if (!service) {
    throw new Error("No cloud service available for push");
  }

  // Execute push via n8n workflow or direct API
  // TODO: Implement actual push logic
}

async function pullFromCloud(op: SyncOperation): Promise<void> {
  // TODO: Implement pull logic
}

async function syncDelete(op: SyncOperation): Promise<void> {
  // TODO: Implement delete sync logic
}

async function mergeData(op: SyncOperation): Promise<void> {
  // TODO: Implement merge logic with conflict resolution
}

function startSyncInterval(): void {
  if (!bridgeConfig.sync.enabled) return;

  if (syncInterval) {
    clearInterval(syncInterval);
  }

  syncInterval = setInterval(() => {
    runSyncCycle().catch(error => {
      logger.error("Sync cycle error:", error);
    });
  }, bridgeConfig.sync.intervalMs);

  logger.info("Sync interval started");
}

function stopSyncInterval(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// ============================================================================
// Bridge Request Execution
// ============================================================================

async function executeBridgeRequest(request: BridgeRequest): Promise<BridgeResponse> {
  const startTime = Date.now();
  const response: BridgeResponse = {
    id: `response-${Date.now()}`,
    requestId: request.id,
    success: false,
    source: "local",
    latencyMs: 0,
    timestamp: new Date().toISOString(),
  };

  try {
    const routePreference = request.options?.routePreference || "auto";
    let useCloud = false;
    let useLocal = false;

    // Determine routing
    switch (routePreference) {
      case "local":
        useLocal = true;
        break;
      case "cloud":
        useCloud = true;
        break;
      case "auto":
        // Check if cloud is available, fallback to local
        useCloud = connectionHealth.state === "connected";
        useLocal = !useCloud;
        break;
    }

    if (useCloud) {
      // Execute via n8n or cloud service
      const service = services.get(request.service);
      if (service && service.status.state === "connected") {
        // TODO: Execute cloud request
        response.source = "cloud";
        response.success = true;
      } else if (useLocal || routePreference === "auto") {
        // Fallback to local
        response.source = "local";
        response.success = true;
        // TODO: Execute local request
      } else {
        throw new Error("Cloud service not available");
      }
    } else {
      // Execute locally
      response.source = "local";
      response.success = true;
      // TODO: Execute local request
    }
  } catch (error) {
    response.success = false;
    response.error = {
      code: "BRIDGE_ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  response.latencyMs = Date.now() - startTime;
  return response;
}

// ============================================================================
// Main Bridge Operations
// ============================================================================

export async function startHybridBridge(
  config?: Partial<HybridBridgeConfig>,
  window?: BrowserWindow
): Promise<StartBridgeResult> {
  if (window) {
    mainWindow = window;
  }

  // Merge config
  if (config) {
    bridgeConfig = {
      ...bridgeConfig,
      ...config,
      n8n: { ...bridgeConfig.n8n, ...config.n8n },
      sync: { ...bridgeConfig.sync, ...config.sync },
    };
  }

  const result: StartBridgeResult = {
    success: false,
    n8nStarted: false,
    servicesConnected: [],
    servicesFailed: [],
  };

  try {
    updateConnectionState("connecting");

    // Start n8n if enabled
    if (bridgeConfig.n8n.enabled && bridgeConfig.n8n.autoStart) {
      logger.info("Starting n8n...");
      const n8nResult = await n8nStart();
      result.n8nStarted = n8nResult.success;
      
      if (n8nResult.success) {
        emitEvent({ type: "n8n:started" });
        startHealthMonitoring();
      } else {
        logger.error("Failed to start n8n:", n8nResult.error);
        result.servicesFailed.push({ id: "n8n", error: n8nResult.error || "Unknown error" });
      }
    }

    // Connect to configured services
    for (const endpoint of bridgeConfig.services) {
      try {
        const bridge = await connectService(endpoint);
        if (bridge.status.state === "connected") {
          result.servicesConnected.push(endpoint.id);
        } else {
          result.servicesFailed.push({ 
            id: endpoint.id, 
            error: bridge.status.lastError || "Connection failed" 
          });
        }
      } catch (error) {
        result.servicesFailed.push({
          id: endpoint.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Start sync if enabled
    if (bridgeConfig.sync.enabled) {
      startSyncInterval();
    }

    result.success = result.n8nStarted || result.servicesConnected.length > 0;
    
    if (result.success) {
      updateConnectionState("connected");
    } else {
      updateConnectionState("error");
    }

    logger.info("Hybrid bridge started:", result);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    updateConnectionState("error");
    logger.error("Failed to start hybrid bridge:", error);
  }

  return result;
}

export async function stopHybridBridge(): Promise<StopBridgeResult> {
  const result: StopBridgeResult = {
    success: true,
    n8nStopped: false,
    servicesDisconnected: [],
  };

  try {
    // Stop health monitoring
    stopHealthMonitoring();

    // Stop sync
    stopSyncInterval();

    // Disconnect all services
    for (const [serviceId] of services) {
      await disconnectService(serviceId);
      result.servicesDisconnected.push(serviceId);
    }

    // Stop n8n
    if (isN8nRunning()) {
      await n8nStop();
      result.n8nStopped = true;
      emitEvent({ type: "n8n:stopped", reason: "Manual stop" });
    }

    updateConnectionState("disconnected");
    logger.info("Hybrid bridge stopped");
  } catch (error) {
    result.success = false;
    logger.error("Error stopping hybrid bridge:", error);
  }

  return result;
}

export function getHybridBridgeStatus(): HybridBridgeStatus {
  return {
    n8n: {
      running: isN8nRunning(),
      health: { ...connectionHealth },
      workflowCount: 0, // TODO: Get from n8n
      activeWorkflows: 0,
    },
    sync: {
      state: { ...syncState },
      lastSync: syncState.lastSync,
      nextSync: syncInterval 
        ? new Date(Date.now() + bridgeConfig.sync.intervalMs).toISOString()
        : undefined,
    },
    services: Array.from(services.values()).map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      health: { ...s.status },
    })),
    bridges: Array.from(workflowBridges.values()).map(b => ({
      id: b.id,
      name: b.name,
      status: b.status,
      lastRun: b.lastRun,
    })),
  };
}

export function updateBridgeConfig(config: Partial<HybridBridgeConfig>): void {
  bridgeConfig = {
    ...bridgeConfig,
    ...config,
    n8n: { ...bridgeConfig.n8n, ...config.n8n },
    sync: { ...bridgeConfig.sync, ...config.sync },
  };
  
  // Restart health monitoring with new interval if changed
  if (config.n8n?.healthCheckInterval && healthCheckInterval) {
    startHealthMonitoring();
  }
  
  // Restart sync interval if changed
  if (config.sync?.intervalMs && syncInterval) {
    startSyncInterval();
  }
  
  logger.info("Bridge config updated");
}

export function addServiceEndpoint(endpoint: ServiceEndpoint): void {
  bridgeConfig.services.push(endpoint);
}

export function removeServiceEndpoint(endpointId: string): void {
  bridgeConfig.services = bridgeConfig.services.filter(s => s.id !== endpointId);
  disconnectService(endpointId);
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function registerHybridBridgeHandlers(): void {
  // Bridge Management
  ipcMain.handle("hybrid-bridge:start", async (_event, config?: Partial<HybridBridgeConfig>) => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    return startHybridBridge(config, window);
  });
  
  ipcMain.handle("hybrid-bridge:stop", async () => stopHybridBridge());
  ipcMain.handle("hybrid-bridge:status", async () => getHybridBridgeStatus());
  ipcMain.handle("hybrid-bridge:config:update", async (_event, config: Partial<HybridBridgeConfig>) => {
    updateBridgeConfig(config);
    return { success: true };
  });
  ipcMain.handle("hybrid-bridge:config:get", async () => bridgeConfig);

  // Service Management
  ipcMain.handle("hybrid-bridge:service:add", async (_event, endpoint: ServiceEndpoint) => {
    addServiceEndpoint(endpoint);
    return connectService(endpoint);
  });
  ipcMain.handle("hybrid-bridge:service:remove", async (_event, serviceId: string) => {
    removeServiceEndpoint(serviceId);
    return { success: true };
  });
  ipcMain.handle("hybrid-bridge:service:reconnect", async (_event, serviceId: string) => {
    return reconnectService(serviceId);
  });
  ipcMain.handle("hybrid-bridge:service:list", async () => {
    return Array.from(services.values());
  });

  // Sync Operations
  ipcMain.handle("hybrid-bridge:sync:run", async () => runSyncCycle());
  ipcMain.handle("hybrid-bridge:sync:state", async () => syncState);
  ipcMain.handle("hybrid-bridge:sync:clear-errors", async () => {
    syncState.errors = [];
    return { success: true };
  });

  // Bridge Request Execution
  ipcMain.handle("hybrid-bridge:request", async (_event, request: BridgeRequest) => {
    return executeBridgeRequest(request);
  });

  // n8n Control
  ipcMain.handle("hybrid-bridge:n8n:restart", async () => {
    restartAttempts = 0;
    await restartN8n();
    return { success: isN8nRunning() };
  });
  ipcMain.handle("hybrid-bridge:n8n:health", async () => {
    const healthy = await checkN8nHealth();
    return { healthy, health: connectionHealth };
  });

  logger.info("Hybrid bridge IPC handlers registered");
}
