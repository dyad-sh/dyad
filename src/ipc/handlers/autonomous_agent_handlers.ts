/**
 * Autonomous Agent IPC Handlers
 * Handles all IPC communication for the fully autonomous AI system
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
import {
  getAutonomousAgentSystem,
  type AutonomousAgentId,
  type MissionId,
  type ArtifactId,
  type MissionType,
  type AgentConfiguration,
  type AutonomousAgentEvent,
} from "@/lib/autonomous_agent";

// Event subscription management
const eventSubscribers = new Map<number, () => void>();

export function registerAutonomousAgentHandlers(): void {
  const system = getAutonomousAgentSystem();

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  ipcMain.handle("autonomous-agent:initialize", async () => {
    await system.initialize();
    return { success: true };
  });

  ipcMain.handle("autonomous-agent:shutdown", async () => {
    await system.shutdown();
    return { success: true };
  });

  // ===========================================================================
  // AGENT MANAGEMENT
  // ===========================================================================

  ipcMain.handle(
    "autonomous-agent:create-agent",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        name: string;
        purpose: string;
        config?: Partial<AgentConfiguration>;
        parentId?: AutonomousAgentId;
      }
    ) => {
      return system.createAgent(params);
    }
  );

  ipcMain.handle(
    "autonomous-agent:get-agent",
    async (_event: IpcMainInvokeEvent, agentId: AutonomousAgentId) => {
      return system.getAgent(agentId);
    }
  );

  ipcMain.handle("autonomous-agent:list-agents", async () => {
    return system.listAgents();
  });

  ipcMain.handle(
    "autonomous-agent:activate-agent",
    async (_event: IpcMainInvokeEvent, agentId: AutonomousAgentId) => {
      await system.activateAgent(agentId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "autonomous-agent:terminate-agent",
    async (_event: IpcMainInvokeEvent, agentId: AutonomousAgentId) => {
      await system.terminateAgent(agentId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "autonomous-agent:replicate-agent",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AutonomousAgentId,
      specialization?: string
    ) => {
      const agent = system.getAgent(agentId);
      if (!agent) throw new Error("Agent not found");
      return system.replicateAgent(agent, specialization);
    }
  );

  ipcMain.handle(
    "autonomous-agent:get-agent-stats",
    async (_event: IpcMainInvokeEvent, agentId: AutonomousAgentId) => {
      return system.getAgentStats(agentId);
    }
  );

  // ===========================================================================
  // MISSION MANAGEMENT
  // ===========================================================================

  ipcMain.handle(
    "autonomous-agent:create-mission",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        agentId: AutonomousAgentId;
        type: MissionType;
        objective: string;
        context?: string;
        constraints?: string[];
        successCriteria?: string[];
      }
    ) => {
      return system.createMission(params);
    }
  );

  ipcMain.handle(
    "autonomous-agent:get-mission",
    async (_event: IpcMainInvokeEvent, missionId: MissionId) => {
      return system.getMission(missionId);
    }
  );

  ipcMain.handle(
    "autonomous-agent:list-missions",
    async (_event: IpcMainInvokeEvent, agentId?: AutonomousAgentId) => {
      return system.listMissions(agentId);
    }
  );

  // ===========================================================================
  // ARTIFACT MANAGEMENT
  // ===========================================================================

  ipcMain.handle(
    "autonomous-agent:get-artifact",
    async (_event: IpcMainInvokeEvent, artifactId: ArtifactId) => {
      return system.getArtifact(artifactId);
    }
  );

  ipcMain.handle(
    "autonomous-agent:list-artifacts",
    async (_event: IpcMainInvokeEvent, missionId?: MissionId) => {
      return system.listArtifacts(missionId);
    }
  );

  // ===========================================================================
  // VOICE CAPABILITIES
  // ===========================================================================

  ipcMain.handle(
    "autonomous-agent:transcribe-audio",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AutonomousAgentId,
      audioPath: string
    ) => {
      return system.transcribeAudio(agentId, audioPath);
    }
  );

  ipcMain.handle(
    "autonomous-agent:synthesize-speech",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AutonomousAgentId,
      text: string
    ) => {
      return system.synthesizeSpeech(agentId, text);
    }
  );

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  ipcMain.handle(
    "autonomous-agent:get-events",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AutonomousAgentId,
      limit?: number
    ) => {
      return system.getRecentEvents(agentId, limit);
    }
  );

  ipcMain.handle("autonomous-agent:subscribe", async (event: IpcMainInvokeEvent) => {
    const webContentsId = event.sender.id;

    // Remove existing subscription
    const existingUnsubscribe = eventSubscribers.get(webContentsId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }

    // Set up event listener
    const listener = (agentEvent: AutonomousAgentEvent) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          win.webContents.send("autonomous-agent:event", agentEvent);
        }
      } catch {
        // Window closed
      }
    };

    system.on("event", listener);

    // Store cleanup function
    eventSubscribers.set(webContentsId, () => {
      system.off("event", listener);
    });

    return { success: true };
  });

  ipcMain.handle("autonomous-agent:unsubscribe", async (event: IpcMainInvokeEvent) => {
    const webContentsId = event.sender.id;
    const unsubscribe = eventSubscribers.get(webContentsId);

    if (unsubscribe) {
      unsubscribe();
      eventSubscribers.delete(webContentsId);
    }

    return { success: true };
  });

  // ===========================================================================
  // MODEL INFERENCE HANDLING
  // ===========================================================================

  // Listen for model inference requests from agents
  system.on("model:inference:request", async (request: {
    agentId: AutonomousAgentId;
    model: string;
    prompt: string;
  }) => {
    // Broadcast to all windows for external AI handling
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("autonomous-agent:inference-request", request);
      }
    }
  });

  // Handle inference response from renderer
  ipcMain.handle(
    "autonomous-agent:inference-response",
    async (
      _event: IpcMainInvokeEvent,
      requestId: string,
      response: string
    ) => {
      // This would be used to complete pending inference requests
      system.emit("model:inference:response", { requestId, response });
      return { success: true };
    }
  );
}
