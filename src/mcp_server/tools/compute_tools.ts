/**
 * MCP Tools — Compute Network
 * Access decentralized compute, manage tasks, and monitor the compute network
 * via JoyCreate's Compute Network and Trustless Inference systems.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerComputeTools(server: McpServer) {
  server.registerTool(
    "joycreate_compute_status",
    {
      description: "Get the status of JoyCreate's compute network — available nodes, capacity, and current tasks.",
      inputSchema: {},
    },
    async () => {
      try {
        const { getComputeStatus } = require("@/ipc/handlers/compute_network_handlers");
        const result = await getComputeStatus?.() ?? { error: "Compute network not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_compute_submit_task",
    {
      description: "Submit a compute task to the JoyCreate decentralized compute network. Use for heavy AI workloads, training jobs, or batch inference.",
      inputSchema: {
        task_type: z.enum(["inference", "training", "embedding", "batch_inference"]).describe("Type of compute task"),
        model: z.string().describe("Model to use for the task"),
        payload: z.record(z.any()).describe("Task payload (prompt, dataset_id, etc.)"),
        priority: z.enum(["low", "normal", "high"]).optional().describe("Task priority"),
        max_cost_usd: z.number().optional().describe("Max cost in USD — task will fail if exceeded"),
      },
    },
    async (params) => {
      try {
        const { submitComputeTask } = require("@/ipc/handlers/compute_network_handlers");
        const result = await submitComputeTask?.(params) ?? { error: "Task submission not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_compute_trustless_infer",
    {
      description: "Run trustless inference — verifiable AI computation with cryptographic proof of execution. Used for high-value or auditable AI tasks.",
      inputSchema: {
        model: z.string().describe("Model ID"),
        prompt: z.string().describe("Input prompt"),
        verify: z.boolean().optional().describe("Generate verifiable proof (default true)"),
        record_ipld: z.boolean().optional().describe("Record inference receipt to IPLD/IPFS (default true)"),
      },
    },
    async (params) => {
      try {
        const { runTrustlessInference } = require("@/ipc/handlers/trustless_inference_handlers");
        const result = await runTrustlessInference?.(params) ?? { error: "Trustless inference not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_compute_smart_route",
    {
      description: "Use JoyCreate's Smart Router to automatically select the best model and compute backend for a given task (local vs cloud vs decentralized).",
      inputSchema: {
        task: z.string().describe("Task description (e.g. 'code generation', 'image captioning', 'summarization')"),
        prompt: z.string().describe("The actual prompt/input"),
        prefer_local: z.boolean().optional().describe("Prefer local models over cloud (default true)"),
        max_cost_usd: z.number().optional().describe("Max cost cap"),
      },
    },
    async (params) => {
      try {
        const { smartRoute } = require("@/ipc/handlers/smart_router_handlers");
        const result = await smartRoute?.(params) ?? { error: "Smart router not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
