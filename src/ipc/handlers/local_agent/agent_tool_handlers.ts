/**
 * IPC handlers for agent tool consent management
 */

import {
  getAllAgentToolConsents,
  setAgentToolConsent,
  resolveAgentToolConsent,
  AGENT_TOOLS,
  type Consent,
  type AgentToolName,
} from "./agent_tool_consent";
import { createLoggedHandler } from "../safe_handle";
import log from "electron-log";

const logger = log.scope("agent_tool_handlers");
const handle = createLoggedHandler(logger);
export function registerAgentToolHandlers() {
  // Get list of available tools
  handle("agent-tool:get-tools", async () => {
    return AGENT_TOOLS;
  });

  // Get all tool consents
  handle("agent-tool:get-consents", async () => {
    return getAllAgentToolConsents();
  });

  // Set consent for a single tool
  handle(
    "agent-tool:set-consent",
    async (_event, params: { toolName: AgentToolName; consent: Consent }) => {
      await setAgentToolConsent(params.toolName, params.consent);
      return { success: true };
    },
  );

  // Handle consent response from renderer
  handle(
    "agent-tool:consent-response",
    async (
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
