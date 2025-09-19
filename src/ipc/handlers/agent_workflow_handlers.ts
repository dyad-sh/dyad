import { ipcMain } from "electron";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import {
  ensureAgentWorkflow,
  getAgentWorkflowById,
  setAgentAutoAdvance,
  getAgentWorkflowStateByChatId,
} from "./agent_workflow_service";

const logger = log.scope("agent-workflow-handlers");
const handle = createLoggedHandler(logger);

export function registerAgentWorkflowHandlers() {
  handle("agent:get-workflow", async (_event, { chatId }: { chatId: number }) => {
    const workflowRow = await ensureAgentWorkflow(chatId);
    const workflow = await getAgentWorkflowById(workflowRow.id);
    if (!workflow) {
      throw new Error(`Agent workflow not found for chat ${chatId}`);
    }
    return workflow;
  });

  handle(
    "agent:set-auto-advance",
    async (
      _event,
      { chatId, enabled }: { chatId: number; enabled: boolean },
    ) => {
      const workflowRow = await ensureAgentWorkflow(chatId);
      await setAgentAutoAdvance(workflowRow.id, enabled);
      const workflow = await getAgentWorkflowById(workflowRow.id);
      if (!workflow) {
        throw new Error(`Agent workflow not found for chat ${chatId}`);
      }
      return workflow;
    },
  );

  handle(
    "agent:refresh-workflow",
    async (_event, { chatId }: { chatId: number }) => {
      const workflow = await getAgentWorkflowStateByChatId(chatId);
      if (!workflow) {
        throw new Error(`Agent workflow not found for chat ${chatId}`);
      }
      return workflow;
    },
  );
}
