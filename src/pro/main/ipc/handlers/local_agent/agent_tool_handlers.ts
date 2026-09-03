/**
 * IPC handlers for agent tool consent management
 */

import {
  getAllAgentToolConsents,
  getDefaultConsent,
  setAgentToolConsent,
  TOOL_DEFINITIONS,
  type AgentToolName,
} from "./tool_definitions";
import { createLoggedTypedHandler } from "@/ipc/handlers/base";
import log from "electron-log";
import type { AgentTool, SetAgentToolConsentParams } from "@/ipc/types";
import { agentContracts } from "@/ipc/types/agent";
import { isDyadProEnabled } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import { resolveToolDescription } from "./tools/types";
import {
  buildFixFindingsPrompt,
  cancelSubagent,
  followupSubagent,
  getSubagentActivities,
  getSubagentMessages,
  listSubagents,
  runAutoReviewBarrier,
  sendSubagentMessage,
  setSubagentEventTarget,
  skipReviewAutoFix,
  startReview,
} from "./subagents/subagent_manager";

const logger = log.scope("agent_tool_handlers");
const handle = createLoggedTypedHandler(logger);
export function registerAgentToolHandlers() {
  // Get list of available tools with their consent settings
  handle(agentContracts.getTools, async (): Promise<AgentTool[]> => {
    const consents = getAllAgentToolConsents();
    const settings = readSettings();
    const descriptionContext = {
      runTypeScriptForWholeProject:
        settings.runTypeScriptForWholeProject === true,
    };
    return TOOL_DEFINITIONS.filter(
      (tool) => isDyadProEnabled(settings) || !tool.subagentOnly,
    ).map((tool) => ({
      name: tool.name,
      description: resolveToolDescription(tool, descriptionContext),
      isAllowedByDefault:
        getDefaultConsent(tool.name as AgentToolName) === "always",
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
  handle(
    agentContracts.getSubagentActivities,
    async (event, { chatId, threadId }) => {
      setSubagentEventTarget(event.sender);
      return getSubagentActivities(chatId, threadId);
    },
  );
  handle(
    agentContracts.sendSubagentMessage,
    async (event, { chatId, threadId, message }) => {
      setSubagentEventTarget(event.sender);
      await sendSubagentMessage(chatId, threadId, message);
    },
  );
  handle(
    agentContracts.followupSubagent,
    async (event, { chatId, threadId, message }) => {
      setSubagentEventTarget(event.sender);
      return followupSubagent(chatId, threadId, message);
    },
  );
  handle(agentContracts.startReview, async (event, params) => {
    setSubagentEventTarget(event.sender);
    return startReview({ ...params, invocationSource: "review_button" });
  });
  handle(agentContracts.runAutoReviewBarrier, async (event, params) => {
    setSubagentEventTarget(event.sender);
    const controller = new AbortController();
    const abort = () => controller.abort();
    event.sender.once("destroyed", abort);
    try {
      return await runAutoReviewBarrier({
        ...params,
        callerId: event.sender.id,
        abortSignal: controller.signal,
      });
    } finally {
      event.sender.removeListener("destroyed", abort);
    }
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
    async (event, { chatId, threadId, remediationFailed }) => {
      setSubagentEventTarget(event.sender);
      await skipReviewAutoFix(chatId, threadId, remediationFailed);
    },
  );
  handle(agentContracts.cancelSubagent, async (event, { chatId, threadId }) => {
    setSubagentEventTarget(event.sender);
    await cancelSubagent(chatId, threadId);
  });
}
