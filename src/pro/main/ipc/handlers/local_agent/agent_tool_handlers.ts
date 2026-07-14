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
import { createLoggedTypedHandler } from "@/ipc/handlers/base";
import log from "electron-log";
import type {
  AgentTool,
  SetAgentToolConsentParams,
  AgentToolConsentResponseParams,
} from "@/ipc/types";
import { agentContracts } from "@/ipc/types/agent";
import { isDyadProEnabled } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import {
  buildFixFindingsPrompt,
  cancelSubagent,
  getSubagentMessages,
  listSubagents,
  recoverInterruptedSubagents,
  runAutoReviewBarrier,
  setSubagentEventTarget,
  skipReviewAutoFix,
  startReview,
} from "./subagents/subagent_manager";

const logger = log.scope("agent_tool_handlers");
const handle = createLoggedTypedHandler(logger);
export function registerAgentToolHandlers() {
  void recoverInterruptedSubagents().catch((error) =>
    logger.error("Failed to reconcile interrupted sub-agents", error),
  );
  // Get list of available tools with their consent settings
  handle(agentContracts.getTools, async (): Promise<AgentTool[]> => {
    const consents = getAllAgentToolConsents();
    return TOOL_DEFINITIONS.filter(
      (tool) => isDyadProEnabled(readSettings()) || !tool.subagentOnly,
    ).map((tool) => ({
      name: tool.name,
      description: tool.description,
      isAllowedByDefault: getDefaultConsent(tool.name) === "always",
      consent: consents[tool.name],
    }));
  });

  // Set consent for a single tool
  handle(
    agentContracts.setConsent,
    async (_event, params: SetAgentToolConsentParams) => {
      setAgentToolConsent(params.toolName as AgentToolName, params.consent);
    },
  );

  // Handle consent response from renderer
  handle(
    agentContracts.respondToConsent,
    async (_event, params: AgentToolConsentResponseParams) => {
      resolveAgentToolConsent(params.requestId, params.decision);
    },
  );

  handle(agentContracts.listSubagents, async (event, { chatId }) => {
    setSubagentEventTarget(event.sender);
    return listSubagents(chatId);
  });
  handle(
    agentContracts.getSubagentMessages,
    async (event, { chatId, threadId }) => {
      setSubagentEventTarget(event.sender);
      return getSubagentMessages(chatId, threadId);
    },
  );
  handle(agentContracts.startReview, async (event, params) => {
    setSubagentEventTarget(event.sender);
    return startReview({ ...params, invocationSource: "review_button" });
  });
  handle(agentContracts.startAutoReview, async (event, params) => {
    setSubagentEventTarget(event.sender);
    return startReview({ ...params, invocationSource: "auto_review" });
  });
  handle(agentContracts.runAutoReviewBarrier, async (event, params) => {
    setSubagentEventTarget(event.sender);
    return runAutoReviewBarrier(params);
  });
  handle(
    agentContracts.fixReviewFindings,
    async (event, { chatId, threadId }) => {
      setSubagentEventTarget(event.sender);
      return {
        prompt: await buildFixFindingsPrompt(chatId, threadId, "fix_button"),
      };
    },
  );
  handle(
    agentContracts.skipReviewAutoFix,
    async (event, { chatId, threadId }) => {
      setSubagentEventTarget(event.sender);
      await skipReviewAutoFix(chatId, threadId);
    },
  );
  handle(agentContracts.cancelSubagent, async (event, { chatId, threadId }) => {
    setSubagentEventTarget(event.sender);
    await cancelSubagent(chatId, threadId);
  });
}
