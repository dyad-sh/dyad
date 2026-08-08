import { describe, expect, it } from "vitest";
import type { McpServer } from "@/ipc/types";
import {
  buildChatAgentMcpActionMessage,
  buildChatAgentMcpActionsMessage,
  collectChatAgentMcpActions,
  getChatAgentMcpActionSelectionKeys,
} from "./chat_agent_mcp_actions";

function server(id: number, name: string, enabled = true): McpServer {
  return {
    id,
    name,
    transport: "http",
    command: null,
    args: null,
    envJson: null,
    headersJson: null,
    url: `https://example.test/${id}`,
    enabled,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("chat_agent_mcp_actions", () => {
  it("collects only enabled Chat Agent MCP workflow and tool toggles", () => {
    const actions = collectChatAgentMcpActions({
      servers: [server(1, "n8n"), server(2, "disabled-server", false)],
      selectedServerIds: [1, 2],
      selectedWorkflowKeys: ["1:workflow:with:colon", "2:hidden"],
      selectedToolKeys: ["1:execute_workflow", "2:search_workflows"],
      workflowsByServer: {
        1: [
          {
            id: "workflow:with:colon",
            name: "Publish Lead",
            active: true,
          },
          {
            id: "not-selected",
            name: "Ignored",
          },
        ],
        2: [
          {
            id: "hidden",
            name: "Hidden",
          },
        ],
      },
      toolsByServer: {
        1: [
          {
            name: "execute_workflow",
            description: "Execute a workflow",
          },
          {
            name: "search_workflows",
          },
        ],
        2: [
          {
            name: "search_workflows",
          },
        ],
      },
    });

    expect(actions.workflows).toEqual([
      expect.objectContaining({
        serverName: "n8n",
        workflowId: "workflow:with:colon",
        name: "Publish Lead",
      }),
    ]);
    expect(actions.tools).toEqual([
      expect.objectContaining({
        serverName: "n8n",
        toolName: "execute_workflow",
      }),
    ]);
  });

  it("builds an executable workflow request for the Chat Agent", () => {
    const message = buildChatAgentMcpActionMessage(
      {
        kind: "workflow",
        serverId: 1,
        serverName: "n8n",
        workflowId: "wf-123",
        name: "Create invoice",
        description: "Creates an invoice from customer details.",
      },
      "Customer is Ace, total is 42.",
    );

    expect(message).toContain("Workflow ID: wf-123");
    expect(message).toContain("use get_workflow_details");
    expect(message).toContain("execute_workflow");
    expect(message).toContain("MCP_TOOL_MENU_SELECTION");
    expect(message).toContain("Do not ask me to copy prompts");
    expect(message).toContain("ask only for the missing fields");
    expect(message).toContain("execution ID, status, and result summary");
    expect(message).toContain("Customer is Ace, total is 42.");
  });

  it("builds a direct tool execution request without confirmation language", () => {
    const message = buildChatAgentMcpActionMessage(
      {
        kind: "tool",
        serverId: 1,
        serverName: "n8n",
        toolName: "search_workflows",
        description: "Search workflows.",
      },
      "Find billing workflows.",
    );

    expect(message).toContain("MCP_TOOL_MENU_SELECTION");
    expect(message).toContain(
      "Execute the selected MCP workflow/tool directly",
    );
    expect(message).toContain("Do not ask me to copy prompts");
    expect(message).toContain("Find billing workflows.");
  });

  it("builds a multi-selected MCP request that waits for the user request", () => {
    const actions = [
      {
        kind: "tool",
        serverId: 1,
        serverName: "gmail",
        toolName: "get_last_email",
      } as const,
      {
        kind: "workflow",
        serverId: 2,
        serverName: "n8n",
        workflowId: "wf-456",
        name: "Create ticket",
      } as const,
    ];
    const message = buildChatAgentMcpActionsMessage(
      actions,
      "get my last email",
    );

    expect(message).toContain("Tool: get_last_email");
    expect(message).toContain("Workflow: Create ticket");
    expect(message).toContain("If multiple actions are selected");
    expect(message).toContain("latest email");
    expect(message).toContain("User request: get my last email");
    expect(getChatAgentMcpActionSelectionKeys(actions)).toEqual({
      toolKeys: ["1:get_last_email"],
      workflowKeys: ["2:wf-456"],
    });
  });
});
