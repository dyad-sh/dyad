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
import type {
  AgentTool,
  SetAgentToolConsentParams,
  AgentToolConsentResponseParams,
} from "@/ipc/types";
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
const handle = createLoggedHandler(logger);
export function registerAgentToolHandlers() {
  void recoverInterruptedSubagents().catch((error) =>
    logger.error("Failed to reconcile interrupted sub-agents", error),
  );
  // Get list of available tools with their consent settings
  handle("agent-tool:get-tools", async (): Promise<AgentTool[]> => {
    const consents = getAllAgentToolConsents();
    const subagentTools = new Set([
      "spawn_agent",
      "list_agents",
      "wait_agents",
      "cancel_agent",
      "send_message",
      "followup_task",
    ]);
    return TOOL_DEFINITIONS.filter(
      (tool) =>
        isDyadProEnabled(readSettings()) || !subagentTools.has(tool.name),
    ).map((tool) => ({
      name: tool.name,
      description: tool.description,
      isAllowedByDefault: getDefaultConsent(tool.name) === "always",
      consent: consents[tool.name],
    }));
  });

  // Set consent for a single tool
  handle(
    "agent-tool:set-consent",
    async (_event, params: SetAgentToolConsentParams) => {
      setAgentToolConsent(params.toolName as AgentToolName, params.consent);
      return { success: true };
    },
  );

  // Handle consent response from renderer
  handle(
    "agent-tool:consent-response",
    async (_event, params: AgentToolConsentResponseParams) => {
      resolveAgentToolConsent(params.requestId, params.decision);
    },
  );

  handle("agent:list-subagents", async (event, { chatId }) => {
    setSubagentEventTarget(event.sender);
    return listSubagents(chatId);
  });
  handle("agent:get-subagent-messages", async (event, { threadId }) => {
    setSubagentEventTarget(event.sender);
    return getSubagentMessages(threadId);
  });
  handle("agent:start-review", async (event, params) => {
    setSubagentEventTarget(event.sender);
    return startReview({ ...params, invocationSource: "review_button" });
  });
  handle("agent:start-auto-review", async (event, params) => {
    setSubagentEventTarget(event.sender);
    return startReview({ ...params, invocationSource: "auto_review" });
  });
  handle("agent:run-auto-review-barrier", async (event, params) => {
    setSubagentEventTarget(event.sender);
    return runAutoReviewBarrier(params);
  });
  handle("agent:fix-review-findings", async (event, { threadId }) => {
    setSubagentEventTarget(event.sender);
    return { prompt: await buildFixFindingsPrompt(threadId) };
  });
  handle("agent:skip-review-auto-fix", async (event, { threadId }) => {
    setSubagentEventTarget(event.sender);
    await skipReviewAutoFix(threadId);
  });
  handle("agent:cancel-subagent", async (event, { threadId }) => {
    setSubagentEventTarget(event.sender);
    await cancelSubagent(threadId);
  });
}
