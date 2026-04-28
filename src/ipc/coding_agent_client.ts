/**
 * Coding Agent IPC Client
 * Renderer-side API for the AI Coding Agent
 */

import type { IpcRenderer } from "electron";
import type {
  AgentSession,
  AgentSessionId,
  AgentTask,
  AgentTaskId,
  AgentConfig,
  TaskType,
  TaskContext,
  AgentCapability,
  ApprovalRequest,
  AgentEvent,
} from "../lib/coding_agent.js";

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

class CodingAgentClient {
  private static instance: CodingAgentClient | null = null;
  private eventListeners: Map<string, Set<(event: AgentEvent) => void>> = new Map();
  private subscriptionId: string | null = null;

  private constructor() {
    // Set up event listener from main process
    try {
      const ipc = getIpcRenderer();
      ipc.on("coding-agent:event", (_evt: unknown, _subId: string, event: AgentEvent) => {
        if (!event) return;
        this.notifyListeners(event);
      });
    } catch {
      // IPC not available yet, will be set up later
    }
  }

  static getInstance(): CodingAgentClient {
    if (!CodingAgentClient.instance) {
      CodingAgentClient.instance = new CodingAgentClient();
    }
    return CodingAgentClient.instance;
  }

  // ---------------------------------------------------------------------------
  // SESSION MANAGEMENT
  // ---------------------------------------------------------------------------

  async createSession(config: Partial<AgentConfig> = {}): Promise<AgentSession> {
    return getIpcRenderer().invoke("coding-agent:create-session", config);
  }

  async endSession(sessionId: AgentSessionId): Promise<void> {
    return getIpcRenderer().invoke("coding-agent:end-session", sessionId);
  }

  async getSession(sessionId: AgentSessionId): Promise<AgentSession | null> {
    return getIpcRenderer().invoke("coding-agent:get-session", sessionId);
  }

  async listSessions(): Promise<AgentSession[]> {
    return getIpcRenderer().invoke("coding-agent:list-sessions");
  }

  // ---------------------------------------------------------------------------
  // TASK EXECUTION
  // ---------------------------------------------------------------------------

  async runTask(
    sessionId: AgentSessionId,
    type: TaskType,
    description: string,
    context?: Partial<TaskContext>
  ): Promise<AgentTask> {
    return getIpcRenderer().invoke("coding-agent:run-task", sessionId, type, description, context);
  }

  // ---------------------------------------------------------------------------
  // APPROVAL MANAGEMENT
  // ---------------------------------------------------------------------------

  async approveAction(requestId: string, approved: boolean): Promise<void> {
    return getIpcRenderer().invoke("coding-agent:approve-action", requestId, approved);
  }

  async getPendingApprovals(sessionId?: AgentSessionId): Promise<ApprovalRequest[]> {
    return getIpcRenderer().invoke("coding-agent:get-pending-approvals", sessionId);
  }

  // ---------------------------------------------------------------------------
  // CAPABILITIES
  // ---------------------------------------------------------------------------

  async getCapabilities(): Promise<AgentCapability[]> {
    return getIpcRenderer().invoke("coding-agent:get-capabilities");
  }

  // ---------------------------------------------------------------------------
  // EVENT SUBSCRIPTION
  // ---------------------------------------------------------------------------

  async subscribe(callback: (event: AgentEvent) => void): Promise<() => void> {
    // Register callback locally
    if (!this.eventListeners.has("all")) {
      this.eventListeners.set("all", new Set());
    }
    this.eventListeners.get("all")!.add(callback);

    // Subscribe to main process if not already
    if (!this.subscriptionId) {
      this.subscriptionId = crypto.randomUUID();
      await getIpcRenderer().invoke("coding-agent:subscribe", this.subscriptionId);
    }

    return () => {
      this.eventListeners.get("all")?.delete(callback);
    };
  }

  async subscribeToSession(
    sessionId: AgentSessionId,
    callback: (event: AgentEvent) => void
  ): Promise<() => void> {
    if (!this.eventListeners.has(sessionId)) {
      this.eventListeners.set(sessionId, new Set());
    }
    this.eventListeners.get(sessionId)!.add(callback);

    // Subscribe to main process if not already
    if (!this.subscriptionId) {
      this.subscriptionId = crypto.randomUUID();
      await getIpcRenderer().invoke("coding-agent:subscribe", this.subscriptionId);
    }

    return () => {
      this.eventListeners.get(sessionId)?.delete(callback);
    };
  }

  private notifyListeners(event: AgentEvent): void {
    // Notify all listeners
    this.eventListeners.get("all")?.forEach((cb) => cb(event));
    
    // Notify session-specific listeners
    if (event.sessionId) {
      this.eventListeners.get(event.sessionId)?.forEach((cb) => cb(event));
    }
  }
}

export const codingAgentClient = CodingAgentClient.getInstance();

// Export types for convenience
export type {
  AgentSession,
  AgentSessionId,
  AgentTask,
  AgentTaskId,
  AgentConfig,
  TaskType,
  TaskContext,
  AgentCapability,
  ApprovalRequest,
  AgentEvent,
} from "../lib/coding_agent.js";
