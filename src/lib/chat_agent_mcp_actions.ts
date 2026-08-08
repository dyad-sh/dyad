import type { McpServer, McpTool, McpWorkflow } from "@/ipc/types";

export type ChatAgentMcpWorkflowAction = {
  kind: "workflow";
  serverId: number;
  serverName: string;
  workflowId: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
};

export type ChatAgentMcpToolAction = {
  kind: "tool";
  serverId: number;
  serverName: string;
  toolName: string;
  description?: string | null;
};

export type ChatAgentMcpAction =
  | ChatAgentMcpWorkflowAction
  | ChatAgentMcpToolAction;

export function getChatAgentMcpActionKey(action: ChatAgentMcpAction) {
  return action.kind === "workflow"
    ? `workflow:${action.serverId}:${action.workflowId}`
    : `tool:${action.serverId}:${action.toolName}`;
}

export function getChatAgentMcpWorkflowKey(
  serverId: number,
  workflowId: string,
) {
  return `${serverId}:${workflowId}`;
}

export function getChatAgentMcpToolKey(serverId: number, toolName: string) {
  return `${serverId}:${toolName}`;
}

export function getChatAgentMcpActionSelectionKeys(
  actions: ChatAgentMcpAction[],
) {
  return {
    toolKeys: actions
      .filter(
        (action): action is ChatAgentMcpToolAction => action.kind === "tool",
      )
      .map((action) =>
        getChatAgentMcpToolKey(action.serverId, action.toolName),
      ),
    workflowKeys: actions
      .filter(
        (action): action is ChatAgentMcpWorkflowAction =>
          action.kind === "workflow",
      )
      .map((action) =>
        getChatAgentMcpWorkflowKey(action.serverId, action.workflowId),
      ),
  };
}

export function collectChatAgentMcpActions({
  servers,
  toolsByServer,
  workflowsByServer,
  selectedServerIds,
  selectedToolKeys,
  selectedWorkflowKeys,
}: {
  servers: McpServer[];
  toolsByServer: Record<number, McpTool[]>;
  workflowsByServer: Record<number, McpWorkflow[]>;
  selectedServerIds?: number[];
  selectedToolKeys?: string[];
  selectedWorkflowKeys?: string[];
}): {
  workflows: ChatAgentMcpWorkflowAction[];
  tools: ChatAgentMcpToolAction[];
} {
  const enabledServerIds = new Set(selectedServerIds ?? []);
  const enabledToolKeys = new Set(selectedToolKeys ?? []);
  const enabledWorkflowKeys = new Set(selectedWorkflowKeys ?? []);
  const activeServers = servers.filter(
    (server) => server.enabled && enabledServerIds.has(server.id),
  );

  const workflows = activeServers.flatMap((server) =>
    (workflowsByServer[server.id] ?? [])
      .filter((workflow) =>
        enabledWorkflowKeys.has(
          getChatAgentMcpWorkflowKey(server.id, workflow.id),
        ),
      )
      .map((workflow) => ({
        kind: "workflow" as const,
        serverId: server.id,
        serverName: server.name,
        workflowId: workflow.id,
        name: workflow.name,
        description: workflow.description,
        active: workflow.active,
      })),
  );

  const tools = activeServers.flatMap((server) =>
    (toolsByServer[server.id] ?? [])
      .filter((tool) =>
        enabledToolKeys.has(getChatAgentMcpToolKey(server.id, tool.name)),
      )
      .map((tool) => ({
        kind: "tool" as const,
        serverId: server.id,
        serverName: server.name,
        toolName: tool.name,
        description: tool.description,
      })),
  );

  return { workflows, tools };
}

function describeAction(action: ChatAgentMcpAction) {
  if (action.kind === "workflow") {
    return [
      `- Workflow: ${action.name}`,
      `  MCP server: ${action.serverName} (id: ${action.serverId})`,
      `  Workflow ID: ${action.workflowId}`,
      action.description ? `  Description: ${action.description}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `- Tool: ${action.toolName}`,
    `  MCP server: ${action.serverName} (id: ${action.serverId})`,
    action.description ? `  Description: ${action.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildChatAgentMcpActionMessage(
  action: ChatAgentMcpAction,
  userContext: string,
): string {
  return buildChatAgentMcpActionsMessage([action], userContext);
}

export function buildChatAgentMcpActionsMessage(
  actions: ChatAgentMcpAction[],
  userContext: string,
) {
  const context = userContext.trim();
  const request =
    context ||
    "Run this now. If required input is missing, ask only for the missing fields before executing.";
  const workflows = actions.filter((action) => action.kind === "workflow");
  const tools = actions.filter((action) => action.kind === "tool");

  return [
    "MCP_TOOL_MENU_SELECTION",
    "Execute the selected MCP workflow/tool directly when the user request matches it.",
    "",
    actions.map(describeAction).join("\n"),
    "",
    "Mandatory behavior:",
    "- Use the selected MCP action or actions that match the user request.",
    "- If exactly one action is selected, use that action for the request.",
    "- If multiple actions are selected and the request clearly matches one or more, execute the matching action or actions directly.",
    "- Do not ask me to copy prompts, confirm the selected tool, or restate workflow/tool details.",
    "- If required input is missing, ask only for the missing fields.",
    "- For requests like latest email, last email, unread email, or inbox status, treat the request as sufficient if the selected action can use the connected account. Do not ask which mailbox or account unless the tool schema requires it.",
    workflows.length > 0
      ? "- For selected workflows, use get_workflow_details first when available, then execute_workflow with the selected workflow ID and the best input from my request."
      : "",
    tools.length > 0
      ? "- For selected tools, run the selected tool directly using the best input from my request."
      : "",
    "- After execution, return the execution ID, status, and result summary directly.",
    "",
    `User request: ${request}`,
  ]
    .filter(Boolean)
    .join("\n");
}
