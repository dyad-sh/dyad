/**
 * MCP Tools — Image Studio
 * Generate, list, and export images via JoyCreate's Image Studio.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function getHandler() {
  const { imageStudioHandlers } = require("@/ipc/handlers/image_studio_handlers");
  return imageStudioHandlers;
}

export function registerImageTools(server: McpServer) {
  server.registerTool(
    "joycreate_image_generate",
    {
      description: "Generate an image using JoyCreate Image Studio. Supports local diffusion models and remote APIs. Returns image path and metadata.",
      inputSchema: {
        prompt: z.string().describe("Image generation prompt"),
        negative_prompt: z.string().optional().describe("What to exclude from the image"),
        model: z.string().optional().describe("Model to use (e.g. sdxl, flux, dall-e-3). Defaults to configured default."),
        width: z.number().optional().describe("Image width in pixels (default 1024)"),
        height: z.number().optional().describe("Image height in pixels (default 1024)"),
        steps: z.number().optional().describe("Inference steps (default 20)"),
        guidance_scale: z.number().optional().describe("CFG guidance scale (default 7.5)"),
        seed: z.number().optional().describe("Random seed for reproducibility"),
        output_format: z.enum(["png", "jpg", "webp"]).optional().describe("Output format"),
      },
    },
    async (params) => {
      try {
        const { ipcMain } = require("electron");
        const result = await new Promise((resolve, reject) => {
          const id = `mcp_${Date.now()}`;
          ipcMain.emit("image-studio:generate", { id }, params);
          setTimeout(() => reject(new Error("Timeout")), 60000);
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        // Fallback: direct handler call
        const { generateImage } = require("@/ipc/handlers/image_studio_handlers");
        const result = await generateImage?.(params) ?? { error: "Image generation not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  server.registerTool(
    "joycreate_image_list",
    {
      description: "List images generated or imported in JoyCreate Image Studio.",
      inputSchema: {
        limit: z.number().optional().describe("Max results (default 20)"),
        search: z.string().optional().describe("Search by prompt or filename"),
      },
    },
    async (params) => {
      try {
        const { listImages } = require("@/ipc/handlers/image_studio_handlers");
        const result = await listImages?.(params) ?? { images: [], count: 0 };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
