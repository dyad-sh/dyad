import {
  getAllAgentToolConsents,
  setAgentToolConsent,
  TOOL_DEFINITIONS,
  getDefaultConsent,
} from "@/ipc/pi/tools/dyad/tool_registry";
import { agentContracts } from "@/ipc/types";
import { createTypedHandler } from "@/ipc/handlers/base";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export function registerAgentToolHandlers() {
  createTypedHandler(agentContracts.getTools, async () => {
    const consents = getAllAgentToolConsents();
    return TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      isAllowedByDefault: getDefaultConsent(tool.name) === "always",
      consent: consents[tool.name],
    }));
  });

  createTypedHandler(
    agentContracts.setConsent,
    async (_event, { toolName, consent }) => {
      if (!TOOL_DEFINITIONS.some((tool) => tool.name === toolName)) {
        throw new DyadError(
          `Unknown agent tool: ${toolName}`,
          DyadErrorKind.Validation,
        );
      }
      setAgentToolConsent(toolName, consent);
    },
  );
}
