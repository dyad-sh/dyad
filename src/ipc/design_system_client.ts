/**
 * Design System Generator IPC Client
 * Renderer-side API for the Design System Generator
 */

import type { IpcRenderer } from "electron";
import type {
  DesignSystem,
  DesignSystemId,
  Component,
  ComponentId,
  DesignTokens,
  GenerateSystemParams,
  GenerateComponentParams,
  ExportOptions,
  DesignSystemEvent,
} from "../lib/design_system_generator.js";

// =============================================================================
// IPC RENDERER ACCESS
// =============================================================================

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      throw new Error("IPC Renderer not available");
    }
  }
  return ipcRenderer;
}

// =============================================================================
// CLIENT
// =============================================================================

class DesignSystemClient {
  private static instance: DesignSystemClient | null = null;
  private eventListeners: Map<string, Set<(event: DesignSystemEvent) => void>> = new Map();
  private subscriptionId: string | null = null;
  private initialized = false;

  private constructor() {
    // Set up event listener from main process
    try {
      const ipc = getIpcRenderer();
      ipc.on("design-system:event", (_evt: unknown, _subId: string, event: DesignSystemEvent) => {
        this.notifyListeners(event);
      });
    } catch {
      // IPC not available yet
    }
  }

  static getInstance(): DesignSystemClient {
    if (!DesignSystemClient.instance) {
      DesignSystemClient.instance = new DesignSystemClient();
    }
    return DesignSystemClient.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await getIpcRenderer().invoke("design-system:initialize");
    this.initialized = true;
  }

  // ---------------------------------------------------------------------------
  // SYSTEM MANAGEMENT
  // ---------------------------------------------------------------------------

  async createSystem(params: GenerateSystemParams): Promise<DesignSystem> {
    return getIpcRenderer().invoke("design-system:create", params);
  }

  async generateSystem(systemId: DesignSystemId): Promise<DesignSystem> {
    return getIpcRenderer().invoke("design-system:generate", systemId);
  }

  async getSystem(systemId: DesignSystemId): Promise<DesignSystem | null> {
    return getIpcRenderer().invoke("design-system:get", systemId);
  }

  async listSystems(): Promise<DesignSystem[]> {
    return getIpcRenderer().invoke("design-system:list");
  }

  async deleteSystem(systemId: DesignSystemId): Promise<void> {
    return getIpcRenderer().invoke("design-system:delete", systemId);
  }

  async updateTokens(systemId: DesignSystemId, tokens: Partial<DesignTokens>): Promise<DesignSystem> {
    return getIpcRenderer().invoke("design-system:update-tokens", systemId, tokens);
  }

  // ---------------------------------------------------------------------------
  // COMPONENT MANAGEMENT
  // ---------------------------------------------------------------------------

  async generateComponent(params: GenerateComponentParams): Promise<Component> {
    return getIpcRenderer().invoke("design-system:generate-component", params);
  }

  async updateComponent(
    systemId: DesignSystemId,
    componentId: ComponentId,
    updates: Partial<Component>
  ): Promise<Component> {
    return getIpcRenderer().invoke("design-system:update-component", systemId, componentId, updates);
  }

  async deleteComponent(systemId: DesignSystemId, componentId: ComponentId): Promise<void> {
    return getIpcRenderer().invoke("design-system:delete-component", systemId, componentId);
  }

  // ---------------------------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------------------------

  async exportSystem(systemId: DesignSystemId, options: ExportOptions): Promise<string> {
    return getIpcRenderer().invoke("design-system:export", systemId, options);
  }

  // ---------------------------------------------------------------------------
  // EVENT SUBSCRIPTION
  // ---------------------------------------------------------------------------

  async subscribe(callback: (event: DesignSystemEvent) => void): Promise<() => void> {
    if (!this.eventListeners.has("all")) {
      this.eventListeners.set("all", new Set());
    }
    this.eventListeners.get("all")!.add(callback);

    if (!this.subscriptionId) {
      this.subscriptionId = crypto.randomUUID();
      await getIpcRenderer().invoke("design-system:subscribe", this.subscriptionId);
    }

    return () => {
      this.eventListeners.get("all")?.delete(callback);
    };
  }

  async subscribeToSystem(
    systemId: DesignSystemId,
    callback: (event: DesignSystemEvent) => void
  ): Promise<() => void> {
    if (!this.eventListeners.has(systemId)) {
      this.eventListeners.set(systemId, new Set());
    }
    this.eventListeners.get(systemId)!.add(callback);

    if (!this.subscriptionId) {
      this.subscriptionId = crypto.randomUUID();
      await getIpcRenderer().invoke("design-system:subscribe", this.subscriptionId);
    }

    return () => {
      this.eventListeners.get(systemId)?.delete(callback);
    };
  }

  private notifyListeners(event: DesignSystemEvent): void {
    // Notify all listeners
    this.eventListeners.get("all")?.forEach((cb) => cb(event));

    // Notify system-specific listeners
    if (event.systemId) {
      this.eventListeners.get(event.systemId)?.forEach((cb) => cb(event));
    }
  }
}

export const designSystemClient = DesignSystemClient.getInstance();

// Export types for convenience
export type {
  DesignSystem,
  DesignSystemId,
  Component,
  ComponentId,
  DesignTokens,
  GenerateSystemParams,
  GenerateComponentParams,
  ExportOptions,
  DesignSystemEvent,
  ComponentType,
  StyleFramework,
  ComponentFramework,
  DesignSystemConfig,
} from "../lib/design_system_generator.js";
