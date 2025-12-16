/**
 * IPC handlers for agent tool consent management
 */

import { ipcMain } from "electron";
import {
  getAllAgentToolConsents,
  setAgentToolConsent,
  resolveAgentToolConsent,
  AGENT_TOOLS,
  type Consent,
  type AgentToolName,
} from "./agent_tool_consent";

export function registerAgentToolHandlers() {
  // Get all tool consents
  ipcMain.handle("agent-tool:get-consents", async () => {
    return getAllAgentToolConsents();
  });

  // Get list of available tools
  ipcMain.handle("agent-tool:get-tools", async () => {
    return AGENT_TOOLS;
  });

  // Set consent for a single tool
  ipcMain.handle(
    "agent-tool:set-consent",
    async (
      _event,
      params: { toolName: AgentToolName; consent: Consent },
    ) => {
      await setAgentToolConsent(params.toolName, params.consent);
      return { success: true };
    },
  );

  // Handle consent response from renderer
  ipcMain.on(
    "agent-tool:consent-response",
    (
      _event,
      params: {
        requestId: string;
        decision: "accept-once" | "accept-always" | "decline";
      },
    ) => {
      resolveAgentToolConsent(params.requestId, params.decision);
    },
  );
}

