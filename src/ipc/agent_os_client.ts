/**
 * Agent OS — Tier 1 IPC Client (renderer-side)
 *
 * Singleton; access via `AgentOsClient.getInstance()`.
 * One method per IPC channel registered in `src/ipc/handlers/agent_os_handlers.ts`.
 */

import type { IpcRenderer } from "electron";
import type {
  OsActivityRow,
  OsActivitySource,
  OsActivityStatus,
  OsCommandRow,
  OsCommandScope,
  OsIntentRow,
  OsIntentStatus,
} from "@/db/agent_os_schema";

// ── Re-exported types for convenience ───────────────────────────────────────

export interface RegisterCommandInput {
  id: string;
  title: string;
  description?: string;
  scope?: OsCommandScope;
  capability?: string;
  keywords?: string[];
  ipcChannel?: string;
  handlerKey?: string;
  requiresInput?: boolean;
  inputSchemaJson?: Record<string, unknown> | null;
  enabled?: boolean;
  icon?: string;
}

export interface CommandFilters {
  scope?: OsCommandScope;
  enabledOnly?: boolean;
}

export interface FireIntentInput {
  query: string;
  scope?: OsCommandScope;
  input?: Record<string, unknown> | null;
  requestedBy?: string;
  matchedCommandId?: string;
}

export interface IntentFilters {
  status?: OsIntentStatus;
  limit?: number;
}

export interface StartActivityInput {
  source: OsActivitySource;
  sourceRef?: string;
  title: string;
  subtitle?: string;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateActivityInput {
  progress?: number;
  subtitle?: string;
  metadata?: Record<string, unknown> | null;
  status?: OsActivityStatus;
  errorMessage?: string;
}

export interface ActivityFilters {
  status?: OsActivityStatus | OsActivityStatus[];
  source?: OsActivitySource;
  limit?: number;
}

export type DispatchOutcome =
  | { kind: "completed"; intent: OsIntentRow; result: unknown }
  | { kind: "ipc-forward"; intent: OsIntentRow; channel: string };

type ElectronWindow = Window & {
  electron?: { ipcRenderer?: IpcRenderer };
};

class AgentOsClientImpl {
  private static instance: AgentOsClientImpl | undefined;
  private readonly ipcRenderer: IpcRenderer;

  private constructor() {
    const w = window as unknown as ElectronWindow;
    const renderer = w.electron?.ipcRenderer;
    if (!renderer) {
      throw new Error(
        "AgentOsClient: window.electron.ipcRenderer is not available",
      );
    }
    this.ipcRenderer = renderer;
  }

  static getInstance(): AgentOsClientImpl {
    if (!AgentOsClientImpl.instance) {
      AgentOsClientImpl.instance = new AgentOsClientImpl();
    }
    return AgentOsClientImpl.instance;
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  registerCommand(input: RegisterCommandInput): Promise<OsCommandRow> {
    return this.ipcRenderer.invoke("os:command:register", input);
  }

  unregisterCommand(id: string): Promise<{ ok: true }> {
    return this.ipcRenderer.invoke("os:command:unregister", { id });
  }

  listCommands(filters: CommandFilters = {}): Promise<OsCommandRow[]> {
    return this.ipcRenderer.invoke("os:command:list", filters);
  }

  getCommand(id: string): Promise<OsCommandRow | null> {
    return this.ipcRenderer.invoke("os:command:get", { id });
  }

  searchCommands(
    query: string,
    scope?: OsCommandScope,
  ): Promise<OsCommandRow[]> {
    return this.ipcRenderer.invoke("os:command:search", { query, scope });
  }

  // ── Intents ───────────────────────────────────────────────────────────────

  fireIntent(input: FireIntentInput): Promise<OsIntentRow> {
    return this.ipcRenderer.invoke("os:intent:fire", input);
  }

  dispatchIntent(intentId: string): Promise<DispatchOutcome> {
    return this.ipcRenderer.invoke("os:intent:dispatch", { intentId });
  }

  listIntents(filters: IntentFilters = {}): Promise<OsIntentRow[]> {
    return this.ipcRenderer.invoke("os:intent:list", filters);
  }

  getIntent(id: string): Promise<OsIntentRow | null> {
    return this.ipcRenderer.invoke("os:intent:get", { id });
  }

  cancelIntent(id: string): Promise<OsIntentRow> {
    return this.ipcRenderer.invoke("os:intent:cancel", { id });
  }

  completeIntent(params: {
    id: string;
    result?: Record<string, unknown> | null;
    errorMessage?: string;
  }): Promise<OsIntentRow> {
    return this.ipcRenderer.invoke("os:intent:complete", params);
  }

  // ── Activities ────────────────────────────────────────────────────────────

  startActivity(input: StartActivityInput): Promise<OsActivityRow> {
    return this.ipcRenderer.invoke("os:activity:start", input);
  }

  updateActivity(params: {
    id: string;
    patch: UpdateActivityInput;
  }): Promise<OsActivityRow> {
    return this.ipcRenderer.invoke("os:activity:update", params);
  }

  listActivities(filters: ActivityFilters = {}): Promise<OsActivityRow[]> {
    return this.ipcRenderer.invoke("os:activity:list", filters);
  }

  getActivity(id: string): Promise<OsActivityRow | null> {
    return this.ipcRenderer.invoke("os:activity:get", { id });
  }
}

export const AgentOsClient = AgentOsClientImpl;
