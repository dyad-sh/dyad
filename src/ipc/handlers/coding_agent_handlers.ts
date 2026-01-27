/**
 * IPC Handlers for Coding Agent
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  getCodingAgent,
  type AgentSessionId,
  type AgentTaskId,
  type AgentConfig,
  type TaskType,
  type TaskContext,
  type AgentEvent,
} from "../../lib/coding_agent.js";

// Store event callbacks for cleanup
const eventCallbacks = new Map<string, (event: AgentEvent) => void>();

export function registerCodingAgentHandlers(): void {
  const agent = getCodingAgent();

  // ---------------------------------------------------------------------------
  // SESSION MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "coding-agent:create-session",
    async (_event: IpcMainInvokeEvent, config: Partial<AgentConfig>) => {
      const session = await agent.createSession(config);
      return session;
    }
  );

  ipcMain.handle(
    "coding-agent:end-session",
    async (_event: IpcMainInvokeEvent, sessionId: AgentSessionId) => {
      await agent.endSession(sessionId);
    }
  );

  ipcMain.handle(
    "coding-agent:get-session",
    async (_event: IpcMainInvokeEvent, sessionId: AgentSessionId) => {
      return agent.getSession(sessionId);
    }
  );

  ipcMain.handle("coding-agent:list-sessions", async () => {
    return agent.listSessions();
  });

  // ---------------------------------------------------------------------------
  // TASK EXECUTION
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "coding-agent:run-task",
    async (
      _event: IpcMainInvokeEvent,
      sessionId: AgentSessionId,
      type: TaskType,
      description: string,
      context?: Partial<TaskContext>
    ) => {
      const task = await agent.runTask(sessionId, type, description, context);
      return task;
    }
  );

  // ---------------------------------------------------------------------------
  // APPROVAL MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "coding-agent:approve-action",
    async (_event: IpcMainInvokeEvent, requestId: string, approved: boolean) => {
      await agent.approveAction(requestId, approved);
    }
  );

  ipcMain.handle(
    "coding-agent:get-pending-approvals",
    async (_event: IpcMainInvokeEvent, sessionId?: AgentSessionId) => {
      return agent.getPendingApprovals(sessionId);
    }
  );

  // ---------------------------------------------------------------------------
  // CAPABILITIES
  // ---------------------------------------------------------------------------

  ipcMain.handle("coding-agent:get-capabilities", async () => {
    const { DEFAULT_CAPABILITIES } = await import("../../lib/coding_agent.js");
    return DEFAULT_CAPABILITIES;
  });

  // ---------------------------------------------------------------------------
  // EVENT SUBSCRIPTION
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "coding-agent:subscribe",
    async (event: IpcMainInvokeEvent, subscriptionId: string) => {
      const callback = (agentEvent: AgentEvent) => {
        event.sender.send("coding-agent:event", subscriptionId, agentEvent);
      };

      eventCallbacks.set(subscriptionId, callback);
      agent.subscribe(callback);

      return subscriptionId;
    }
  );

  ipcMain.handle(
    "coding-agent:unsubscribe",
    async (_event: IpcMainInvokeEvent, subscriptionId: string) => {
      const callback = eventCallbacks.get(subscriptionId);
      if (callback) {
        agent.off("agent:event", callback);
        eventCallbacks.delete(subscriptionId);
      }
    }
  );
}
