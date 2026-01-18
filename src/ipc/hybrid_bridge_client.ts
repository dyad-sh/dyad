/**
 * Hybrid Bridge Client
 * Renderer-side client for seamless local/cloud integration
 */

import type { IpcRenderer } from "electron";
import type {
  HybridBridgeConfig,
  ServiceEndpoint,
  ServiceBridge,
  SyncState,
  SyncBatch,
  HybridBridgeStatus,
  StartBridgeResult,
  StopBridgeResult,
  BridgeRequest,
  BridgeResponse,
  HybridBridgeEvent,
  ConnectionHealth,
} from "@/types/hybrid_bridge_types";

type EventCallback = (event: HybridBridgeEvent) => void;

class HybridBridgeClient {
  private static instance: HybridBridgeClient;
  private ipcRenderer: IpcRenderer;
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private connected = false;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
    this.setupEventListener();
  }

  static getInstance(): HybridBridgeClient {
    if (!HybridBridgeClient.instance) {
      HybridBridgeClient.instance = new HybridBridgeClient();
    }
    return HybridBridgeClient.instance;
  }

  private setupEventListener(): void {
    // Listen for bridge events from main process
    this.ipcRenderer.on("hybrid-bridge:event", (bridgeEvent: HybridBridgeEvent) => {
      this.notifyListeners(bridgeEvent);
      
      // Update connection state
      if (bridgeEvent.type === "connection:changed") {
        this.connected = bridgeEvent.state === "connected";
      }
    });
  }

  private notifyListeners(event: HybridBridgeEvent): void {
    // Notify all listeners
    const allListeners = this.eventListeners.get("*");
    if (allListeners) {
      allListeners.forEach(cb => cb(event));
    }

    // Notify type-specific listeners
    const typeListeners = this.eventListeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach(cb => cb(event));
    }
  }

  // ============================================================================
  // Event Subscription
  // ============================================================================

  /**
   * Subscribe to bridge events
   * @param eventType Event type to listen for, or "*" for all events
   * @param callback Callback function
   * @returns Unsubscribe function
   */
  on(eventType: HybridBridgeEvent["type"] | "*", callback: EventCallback): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);

    return () => {
      this.eventListeners.get(eventType)?.delete(callback);
    };
  }

  /**
   * Subscribe to an event once
   */
  once(eventType: HybridBridgeEvent["type"] | "*", callback: EventCallback): void {
    const unsubscribe = this.on(eventType, (event) => {
      unsubscribe();
      callback(event);
    });
  }

  // ============================================================================
  // Bridge Management
  // ============================================================================

  /**
   * Start the hybrid bridge with optional configuration
   */
  async start(config?: Partial<HybridBridgeConfig>): Promise<StartBridgeResult> {
    const result = await this.ipcRenderer.invoke("hybrid-bridge:start", config);
    this.connected = result.success;
    return result;
  }

  /**
   * Stop the hybrid bridge
   */
  async stop(): Promise<StopBridgeResult> {
    const result = await this.ipcRenderer.invoke("hybrid-bridge:stop");
    this.connected = false;
    return result;
  }

  /**
   * Get current bridge status
   */
  async getStatus(): Promise<HybridBridgeStatus> {
    return this.ipcRenderer.invoke("hybrid-bridge:status");
  }

  /**
   * Check if bridge is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Update bridge configuration
   */
  async updateConfig(config: Partial<HybridBridgeConfig>): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("hybrid-bridge:config:update", config);
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<HybridBridgeConfig> {
    return this.ipcRenderer.invoke("hybrid-bridge:config:get");
  }

  // ============================================================================
  // Service Management
  // ============================================================================

  /**
   * Add a new service endpoint
   */
  async addService(endpoint: ServiceEndpoint): Promise<ServiceBridge> {
    return this.ipcRenderer.invoke("hybrid-bridge:service:add", endpoint);
  }

  /**
   * Remove a service endpoint
   */
  async removeService(serviceId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("hybrid-bridge:service:remove", serviceId);
  }

  /**
   * Reconnect to a service
   */
  async reconnectService(serviceId: string): Promise<boolean> {
    return this.ipcRenderer.invoke("hybrid-bridge:service:reconnect", serviceId);
  }

  /**
   * List all connected services
   */
  async listServices(): Promise<ServiceBridge[]> {
    return this.ipcRenderer.invoke("hybrid-bridge:service:list");
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  /**
   * Manually trigger a sync cycle
   */
  async triggerSync(): Promise<SyncBatch> {
    return this.ipcRenderer.invoke("hybrid-bridge:sync:run");
  }

  /**
   * Get current sync state
   */
  async getSyncState(): Promise<SyncState> {
    return this.ipcRenderer.invoke("hybrid-bridge:sync:state");
  }

  /**
   * Clear sync errors
   */
  async clearSyncErrors(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("hybrid-bridge:sync:clear-errors");
  }

  // ============================================================================
  // Request Execution
  // ============================================================================

  /**
   * Execute a request through the bridge
   * Automatically routes to local or cloud based on configuration
   */
  async request<T = any>(
    service: string,
    operation: string,
    data?: any,
    options?: BridgeRequest["options"]
  ): Promise<BridgeResponse & { data?: T }> {
    const request: BridgeRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      service,
      operation,
      data,
      options,
      timestamp: new Date().toISOString(),
    };

    return this.ipcRenderer.invoke("hybrid-bridge:request", request);
  }

  /**
   * Execute a request preferring local execution
   */
  async localRequest<T = any>(
    service: string,
    operation: string,
    data?: any
  ): Promise<BridgeResponse & { data?: T }> {
    return this.request(service, operation, data, { routePreference: "local" });
  }

  /**
   * Execute a request preferring cloud execution
   */
  async cloudRequest<T = any>(
    service: string,
    operation: string,
    data?: any
  ): Promise<BridgeResponse & { data?: T }> {
    return this.request(service, operation, data, { routePreference: "cloud" });
  }

  // ============================================================================
  // n8n Control
  // ============================================================================

  /**
   * Restart n8n process
   */
  async restartN8n(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("hybrid-bridge:n8n:restart");
  }

  /**
   * Check n8n health
   */
  async checkN8nHealth(): Promise<{ healthy: boolean; health: ConnectionHealth }> {
    return this.ipcRenderer.invoke("hybrid-bridge:n8n:health");
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Wait for bridge to be connected
   */
  async waitForConnection(timeoutMs = 30000): Promise<boolean> {
    if (this.connected) return true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);

      const unsubscribe = this.on("connection:changed", (event) => {
        if (event.type === "connection:changed" && event.state === "connected") {
          clearTimeout(timeout);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  /**
   * Auto-start bridge with retry
   */
  async autoStart(
    config?: Partial<HybridBridgeConfig>,
    maxRetries = 3
  ): Promise<StartBridgeResult> {
    let lastResult: StartBridgeResult | null = null;
    
    for (let i = 0; i < maxRetries; i++) {
      lastResult = await this.start(config);
      if (lastResult.success) {
        return lastResult;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }

    return lastResult || {
      success: false,
      n8nStarted: false,
      servicesConnected: [],
      servicesFailed: [],
      error: "Max retries exceeded",
    };
  }
}

export const hybridBridgeClient = HybridBridgeClient.getInstance();
