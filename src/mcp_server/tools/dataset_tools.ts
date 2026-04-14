/**
 * MCP Tools — Dataset Studio
 * Create, manage, and publish datasets via JoyCreate's Dataset Studio.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerDatasetTools(server: McpServer) {
  server.registerTool(
    "joycreate_dataset_create",
    {
      description: "Create a new dataset in JoyCreate Dataset Studio. Can generate synthetic data using AI or import from existing sources.",
      inputSchema: {
        name: z.string().describe("Dataset name"),
        description: z.string().describe("What this dataset contains and its intended use"),
        type: z.enum(["text", "image", "audio", "tabular", "multimodal", "instruction", "preference"]).describe("Dataset type"),
        generate: z.boolean().optional().describe("Use AI to generate synthetic data (default false)"),
        generation_prompt: z.string().optional().describe("Prompt for AI data generation (required if generate=true)"),
        num_samples: z.number().optional().describe("Number of samples to generate (default 100)"),
        schema: z.record(z.any()).optional().describe("JSON schema for tabular/structured datasets"),
        tags: z.array(z.string()).optional().describe("Tags for categorization"),
      },
    },
    async (params) => {
      try {
        const { createDataset } = require("@/ipc/handlers/dataset_studio_handlers");
        const result = await createDataset?.(params) ?? { error: "Dataset Studio not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_dataset_list",
    {
      description: "List datasets in JoyCreate Dataset Studio.",
      inputSchema: {
        search: z.string().optional().describe("Search by name or description"),
        type: z.string().optional().describe("Filter by dataset type"),
        limit: z.number().optional().describe("Max results (default 20)"),
      },
    },
    async (params) => {
      try {
        const { listDatasets } = require("@/ipc/handlers/dataset_studio_handlers");
        const result = await listDatasets?.(params) ?? { datasets: [], count: 0 };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_dataset_generate_synthetic",
    {
      description: "Generate synthetic training data using AI. Useful for fine-tuning, evaluation sets, or augmentation.",
      inputSchema: {
        task: z.string().describe("Description of the task the data should train for"),
        format: z.enum(["instruction", "preference", "qa", "completion", "classification"]).describe("Training data format"),
        num_samples: z.number().describe("Number of samples to generate"),
        examples: z.array(z.record(z.any())).optional().describe("Few-shot examples to guide generation"),
        output_format: z.enum(["jsonl", "csv", "parquet"]).optional().describe("Output file format"),
      },
    },
    async (params) => {
      try {
        const { generateSyntheticData } = require("@/ipc/handlers/data_generation_handlers");
        const result = await generateSyntheticData?.(params) ?? { error: "Data generation not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_dataset_publish",
    {
      description: "Publish a dataset to Joy Marketplace. Packages it with metadata, IPFS upload, and creates a marketplace listing.",
      inputSchema: {
        dataset_id: z.string().describe("Dataset ID to publish"),
        price_usd: z.number().optional().describe("Listing price in USD (0 for free)"),
        license: z.string().optional().describe("License type (e.g. MIT, CC-BY-4.0, proprietary)"),
        royalty_percent: z.number().optional().describe("Royalty % on resales (default 10)"),
      },
    },
    async (params) => {
      try {
        const { publishDataset } = require("@/ipc/handlers/dataset_studio_handlers");
        const result = await publishDataset?.(params) ?? { error: "Dataset publish not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
