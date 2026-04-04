/**
 * Joy Assistant IPC Client
 *
 * Renderer-side client for the AI platform assistant.
 * Follows the same streaming-callback pattern as help bot in IpcClient.
 */

import type { IpcRenderer } from "electron";
import type {
  AssistantAction,
  AssistantChatRequest,
  AssistantMessage,
  AssistantMode,
  AssistantPageContext,
  AssistantSuggestion,
} from "@/types/joy_assistant_types";

interface AssistantStreamCallbacks {
  onDelta: (delta: string) => void;
  onActions: (actions: AssistantAction[]) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

class JoyAssistantClient {
  private static instance: JoyAssistantClient;
  private ipcRenderer: IpcRenderer;
  private activeStreams: Map<string, AssistantStreamCallbacks> = new Map();

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
    this.setupListeners();
  }

  static getInstance(): JoyAssistantClient {
    if (!JoyAssistantClient.instance) {
      JoyAssistantClient.instance = new JoyAssistantClient();
    }
    return JoyAssistantClient.instance;
  }

  private setupListeners() {
    this.ipcRenderer.on("joy-assistant:response:chunk", (data) => {
      if (
        data &&
        typeof data === "object" &&
        "sessionId" in data
      ) {
        const d = data as Record<string, unknown>;
        const sessionId = d.sessionId as string;
        const callbacks = this.activeStreams.get(sessionId);
        if (!callbacks) return;
        if (d.delta) callbacks.onDelta(d.delta as string);
        if (Array.isArray(d.actions) && d.actions.length) {
          callbacks.onActions(d.actions as AssistantAction[]);
        }
      }
    });

    this.ipcRenderer.on("joy-assistant:response:end", (data) => {
      if (
        data &&
        typeof data === "object" &&
        "sessionId" in data
      ) {
        const sessionId = (data as Record<string, unknown>).sessionId as string;
        const callbacks = this.activeStreams.get(sessionId);
        if (callbacks) callbacks.onEnd();
        this.activeStreams.delete(sessionId);
      }
    });

    this.ipcRenderer.on("joy-assistant:response:error", (data) => {
      if (
        data &&
        typeof data === "object" &&
        "sessionId" in data &&
        "error" in data
      ) {
        const d = data as Record<string, unknown>;
        const sessionId = d.sessionId as string;
        const error = d.error as string;
        const callbacks = this.activeStreams.get(sessionId);
        if (callbacks) callbacks.onError(error);
        this.activeStreams.delete(sessionId);
      }
    });
  }

  // ── Streaming chat ──────────────────────────────────────────────────────

  chat(
    params: AssistantChatRequest,
    callbacks: AssistantStreamCallbacks,
  ): void {
    this.activeStreams.set(params.sessionId, callbacks);
    this.ipcRenderer
      .invoke("joy-assistant:chat", params)
      .catch((err) => {
        this.activeStreams.delete(params.sessionId);
        callbacks.onError(String(err));
      });
  }

  cancel(sessionId: string): void {
    this.ipcRenderer.invoke("joy-assistant:cancel", sessionId).catch(() => {});
    this.activeStreams.delete(sessionId);
  }

  // ── Request/response calls ──────────────────────────────────────────────

  async getSuggestions(
    pageContext: AssistantPageContext,
  ): Promise<AssistantSuggestion[]> {
    return this.ipcRenderer.invoke("joy-assistant:suggestions", {
      pageContext,
    });
  }

  async getHistory(sessionId: string): Promise<AssistantMessage[]> {
    return this.ipcRenderer.invoke("joy-assistant:history", sessionId);
  }

  async clearHistory(sessionId: string): Promise<void> {
    await this.ipcRenderer.invoke("joy-assistant:clear", sessionId);
  }

  async setMode(sessionId: string, mode: AssistantMode): Promise<void> {
    await this.ipcRenderer.invoke("joy-assistant:set-mode", sessionId, mode);
  }

  async executeAction(
    sessionId: string,
    action: AssistantAction,
  ): Promise<{ approved: boolean; action: AssistantAction }> {
    return this.ipcRenderer.invoke(
      "joy-assistant:execute-action",
      sessionId,
      action,
    );
  }
}

export { JoyAssistantClient };
export type { AssistantStreamCallbacks };
