/**
 * MCP Tools — Video Studio
 * Generate, process, and export video via JoyCreate's Video Studio & Media Pipeline.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerVideoTools(server: McpServer) {
  server.registerTool(
    "joycreate_video_generate",
    {
      description: "Generate a video clip using JoyCreate Video Studio. Supports text-to-video, image-to-video, and AI video synthesis.",
      inputSchema: {
        prompt: z.string().describe("Text description of the video to generate"),
        duration_seconds: z.number().optional().describe("Target duration in seconds (default 5)"),
        fps: z.number().optional().describe("Frames per second (default 24)"),
        resolution: z.enum(["480p", "720p", "1080p"]).optional().describe("Output resolution"),
        model: z.string().optional().describe("Model to use for generation"),
        reference_image: z.string().optional().describe("Path to reference image for img2video"),
      },
    },
    async (params) => {
      try {
        const { generateVideo } = require("@/ipc/handlers/video_studio_handlers");
        const result = await generateVideo?.(params) ?? { error: "Video generation not available in this environment" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_video_process",
    {
      description: "Process an existing video — trim, merge, add captions, extract frames, or transcode.",
      inputSchema: {
        input_path: z.string().describe("Path to the input video file"),
        operation: z.enum(["trim", "merge", "captions", "extract_frames", "transcode"]).describe("Operation to perform"),
        params: z.record(z.any()).optional().describe("Operation-specific parameters (e.g. {start: 0, end: 10} for trim)"),
        output_path: z.string().optional().describe("Output file path"),
      },
    },
    async (params) => {
      try {
        const { processVideo } = require("@/ipc/handlers/video_studio_handlers");
        const result = await processVideo?.(params) ?? { error: "Video processing not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );

  server.registerTool(
    "joycreate_media_pipeline",
    {
      description: "Run a media processing pipeline — batch process images/videos, convert formats, apply filters.",
      inputSchema: {
        input_paths: z.array(z.string()).describe("Input file paths"),
        pipeline: z.array(z.object({
          step: z.string().describe("Pipeline step name"),
          params: z.record(z.any()).optional(),
        })).describe("Ordered list of pipeline steps"),
        output_dir: z.string().optional().describe("Output directory"),
      },
    },
    async (params) => {
      try {
        const { runMediaPipeline } = require("@/ipc/handlers/media_pipeline_handlers");
        const result = await runMediaPipeline?.(params) ?? { error: "Media pipeline not available" };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    }
  );
}
