/**
 * IPC handlers for agent tool consent management
 */

import {
  getAllAgentToolConsents,
  setAgentToolConsent,
  resolveAgentToolConsent,
  TOOL_DEFINITIONS,
  getDefaultConsent,
  type AgentToolName,
} from "./tool_definitions";
import { createLoggedHandler } from "@/ipc/handlers/safe_handle";
import log from "electron-log";
import type { AgentTool } from "@/ipc/ipc_types";
import type { AgentToolConsent } from "@/ipc/ipc_types";

const logger = log.scope("agent_tool_handlers");
const handle = createLoggedHandler(logger);
export function registerAgentToolHandlers() {
  // Get list of available tools with their consent settings
  handle("agent-tool:get-tools", async (): Promise<AgentTool[]> => {
    const consents = getAllAgentToolConsents();
    return TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      isAllowedByDefault: getDefaultConsent(tool.name) === "always",
      consent: consents[tool.name],
    }));
  });

  // Set consent for a single tool
  handle(
    "agent-tool:set-consent",
    async (
      _event,
      params: { toolName: AgentToolName; consent: AgentToolConsent },
    ) => {
      setAgentToolConsent(params.toolName, params.consent);
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
