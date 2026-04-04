/**
 * MCP Tools — Workflows (n8n)
 *
 * List, execute, and toggle n8n workflows from JoyCreate.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listWorkflows,
  activateWorkflow,
  deactivateWorkflow,
  executeWorkflow,
} from "@/ipc/handlers/n8n_handlers";

export function registerWorkflowTools(server: McpServer) {
  // ── List workflows ───────────────────────────────────────────────
  server.registerTool(
    "joycreate_list_workflows",
    {
      description:
        "List n8n automation workflows registered in JoyCreate. Returns workflow IDs, names, and active state.",
      inputSchema: {},
    },
    async () => {
      const result = await listWorkflows();
      const workflows = result.data.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(workflows, null, 2) }],
      };
    },
  );

  // ── Execute workflow ─────────────────────────────────────────────
  server.registerTool(
    "joycreate_execute_workflow",
    {
      description:
        "Execute (trigger) an n8n workflow by ID. Optionally pass input data that the workflow receives.",
      inputSchema: {
        workflowId: z.string().describe("The workflow ID to execute"),
        data: z
          .record(z.unknown())
          .optional()
          .describe("Optional input data to pass to the workflow"),
      },
    },
    async ({ workflowId, data }) => {
      const result = await executeWorkflow(workflowId, data);
      if (!result) {
        return {
          content: [
            { type: "text" as const, text: `Workflow ${workflowId} execution returned no result.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { executionId: result.id, status: result.status, finished: result.finished },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── Toggle workflow active/inactive ──────────────────────────────
  server.registerTool(
    "joycreate_toggle_workflow",
    {
      description:
        "Activate or deactivate an n8n workflow. Active workflows respond to their configured triggers automatically.",
      inputSchema: {
        workflowId: z.string().describe("The workflow ID"),
        active: z.boolean().describe("true to activate, false to deactivate"),
      },
    },
    async ({ workflowId, active }) => {
      const result = active
        ? await activateWorkflow(workflowId)
        : await deactivateWorkflow(workflowId);

      if (!result) {
        return {
          content: [
            { type: "text" as const, text: `Workflow ${workflowId} not found.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Workflow "${result.name}" is now ${result.active ? "active" : "inactive"}.`,
          },
        ],
      };
    },
  );
}
