/**
 * Universal Tools IPC + Headless Tool Dispatcher
 *
 * Exposes:
 *   - tools:list-all   → returns the full live tool catalog (native + MCP +
 *                        plugin + skill + external MCP + extensions).
 *   - tools:invoke     → fire any tool by name with args (debugging /
 *                        power-user / scheduler / macro path).
 *
 * Also wires the scheduler service and tool macro store dispatcher so cron
 * fires and macro steps invoke through the same headless context as the
 * `tools:invoke` channel.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { getAllAgentTools } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import type {
  AgentContext,
  ToolDefinition,
} from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { getSchedulerService } from "@/lib/scheduler_service";

const logger = log.scope("tools_handlers");

/**
 * Build a minimal AgentContext for headless invocations (scheduler ticks,
 * macro execution, manual `tools:invoke` calls). Streaming/persistence
 * callbacks are no-ops; consent is auto-accepted because either the user
 * pre-approved when creating the schedule/macro, or the call was issued
 * directly via the IPC channel which is itself a privileged surface.
 */
function buildHeadlessContext(event?: IpcMainInvokeEvent): AgentContext {
  return {
    event: event as IpcMainInvokeEvent,
    appPath: "",
    chatId: 0,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    messageId: 0,
    isSharedModulesChanged: false,
    onXmlStream: () => {},
    onXmlComplete: () => {},
    requireConsent: async () => true,
  };
}

async function findTool(name: string): Promise<ToolDefinition | null> {
  const all = await getAllAgentTools();
  return all.find((t) => t.name === name) ?? null;
}

/**
 * Headless dispatcher used by scheduler & macros.
 */
export async function dispatchToolHeadless(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = await findTool(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Invalid args for ${toolName}: ${parsed.error.message}`);
  }
  return tool.execute(parsed.data, buildHeadlessContext());
}

export function registerToolsHandlers(): void {
  ipcMain.handle("tools:list-all", async () => {
    const tools = await getAllAgentTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      defaultConsent: t.defaultConsent,
    }));
  });

  ipcMain.handle(
    "tools:invoke",
    async (
      event,
      payload: { toolName: string; args: Record<string, unknown> },
    ) => {
      const tool = await findTool(payload.toolName);
      if (!tool) throw new Error(`Tool not found: ${payload.toolName}`);
      const parsed = tool.inputSchema.safeParse(payload.args ?? {});
      if (!parsed.success) {
        throw new Error(
          `Invalid args for ${payload.toolName}: ${parsed.error.message}`,
        );
      }
      return tool.execute(parsed.data, buildHeadlessContext(event));
    },
  );

  // Wire scheduler dispatcher so cron-fired schedules invoke real tools.
  try {
    getSchedulerService().setDispatcher(dispatchToolHeadless);
  } catch (err) {
    logger.warn(`Could not wire scheduler dispatcher: ${err}`);
  }
}
