/**
 * MCP Tools — Neural / Model Builder
 * Fine-tune, manage, and deploy local AI models via JoyCreate's Model Factory,
 * Local Model system (Ollama/LM Studio), and Model Registry.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerNeuralModelTools(server: McpServer) {
  server.registerTool(
    "joycreate_model_list_local",
    {
      description: "List locally available AI models in JoyCreate (Ollama, LM Studio, downloaded HuggingFace models).",
      inputSchema: {
        provider: z.enum(["ollama", "lmstudio", "huggingface", "all"]).optional().describe("Filter by model provider"),
        search: z.string().optional().describe("Search by model name"),
      },
    },
    async (params) => {
      try {
        const { listLocalModels } = require("@/ipc/handlers/local_model_handlers");
        const result = await listLocalModels?.(params) ?? { models: [] };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_model_download",
    {
      description: "Download an AI model from HuggingFace or Ollama registry to run locally in JoyCreate.",
      inputSchema: {
        model_id: z.string().describe("Model ID (e.g. 'mistral:7b' for Ollama, 'meta-llama/Llama-3-8B' for HuggingFace)"),
        provider: z.enum(["ollama", "huggingface"]).describe("Model provider/registry"),
        quantization: z.string().optional().describe("Quantization level (e.g. Q4_K_M, Q8_0, fp16)"),
      },
    },
    async (params) => {
      try {
        const { downloadModel } = require("@/ipc/handlers/model_download_manager_handlers");
        const result = await downloadModel?.(params) ?? { error: "Model download not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_model_finetune",
    {
      description: "Fine-tune a base model using a dataset in JoyCreate's Model Factory. Supports LoRA, QLoRA, and full fine-tuning.",
      inputSchema: {
        base_model: z.string().describe("Base model ID to fine-tune"),
        dataset_id: z.string().describe("Dataset ID (from joycreate_dataset_create)"),
        method: z.enum(["lora", "qlora", "full"]).optional().describe("Fine-tuning method (default: qlora)"),
        epochs: z.number().optional().describe("Training epochs (default: 3)"),
        learning_rate: z.number().optional().describe("Learning rate (default: 2e-4)"),
        output_name: z.string().optional().describe("Name for the fine-tuned model"),
      },
    },
    async (params) => {
      try {
        const { fineTuneModel } = require("@/ipc/handlers/model_factory_handlers");
        const result = await fineTuneModel?.(params) ?? { error: "Model fine-tuning not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_model_publish",
    {
      description: "Publish a local or fine-tuned model to Joy Marketplace. Handles IPFS packaging, metadata, and listing creation.",
      inputSchema: {
        model_id: z.string().describe("Local model ID to publish"),
        name: z.string().describe("Display name for the marketplace"),
        description: z.string().describe("Model description, capabilities, and use cases"),
        price_usd: z.number().optional().describe("Price in USD (0 for free)"),
        license: z.string().optional().describe("License (MIT, Apache-2.0, proprietary, etc.)"),
        tags: z.array(z.string()).optional().describe("Tags for discoverability"),
        royalty_percent: z.number().optional().describe("Royalty % on resales (default 10)"),
      },
    },
    async (params) => {
      try {
        const { publishModel } = require("@/ipc/handlers/model_registry_handlers");
        const result = await publishModel?.(params) ?? { error: "Model publish not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_model_infer",
    {
      description: "Run inference on a local model loaded in JoyCreate (Ollama or LM Studio).",
      inputSchema: {
        model: z.string().describe("Model name (e.g. mistral:7b, llama3:8b)"),
        prompt: z.string().describe("Input prompt"),
        system: z.string().optional().describe("System prompt"),
        temperature: z.number().optional().describe("Temperature (default 0.7)"),
        max_tokens: z.number().optional().describe("Max output tokens (default 1024)"),
      },
    },
    async (params) => {
      try {
        const { runInference } = require("@/ipc/handlers/local_model_handlers");
        const result = await runInference?.(params) ?? { error: "Inference not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
