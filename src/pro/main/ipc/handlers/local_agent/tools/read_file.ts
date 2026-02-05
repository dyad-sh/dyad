import fs from "node:fs";
import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";

const readFile = fs.promises.readFile;

const readFileSchema = z
  .object({
    path: z.string().describe("The file path to read"),
    start_line_one_indexed: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "The one-indexed line number to start reading from (inclusive).",
      ),
    end_line_one_indexed_inclusive: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The one-indexed line number to end reading at (inclusive)."),
  })
  .refine(
    (data) => {
      if (
        data.start_line_one_indexed != null &&
        data.end_line_one_indexed_inclusive != null
      ) {
        return (
          data.start_line_one_indexed <= data.end_line_one_indexed_inclusive
        );
      }
      return true;
    },
    {
      message:
        "start_line_one_indexed must be <= end_line_one_indexed_inclusive",
    },
  );

export const readFileTool: ToolDefinition<z.infer<typeof readFileSchema>> = {
  name: "read_file",
  description: `Read the content of a file from the codebase.
  
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.`,
  inputSchema: readFileSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    const start = args.start_line_one_indexed;
    const end = args.end_line_one_indexed_inclusive;
    if (start != null && end != null) {
      return `Read ${args.path} (lines ${start}-${end})`;
    } else if (start != null) {
      return `Read ${args.path} (from line ${start})`;
    } else if (end != null) {
      return `Read ${args.path} (to line ${end})`;
    }
    return `Read ${args.path}`;
  },

  buildXml: (args, _isComplete) => {
    if (!args.path) return undefined;
    const attrs = [`path="${escapeXmlAttr(args.path)}"`];
    if (args.start_line_one_indexed != null) {
      attrs.push(
        `start_line="${escapeXmlAttr(String(args.start_line_one_indexed))}"`,
      );
    }
    if (args.end_line_one_indexed_inclusive != null) {
      attrs.push(
        `end_line="${escapeXmlAttr(String(args.end_line_one_indexed_inclusive))}"`,
      );
    }
    return `<dyad-read ${attrs.join(" ")}></dyad-read>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const fullFilePath = safeJoin(ctx.appPath, args.path);

    if (!fs.existsSync(fullFilePath)) {
      throw new Error(`File does not exist: ${args.path}`);
    }

    const content = await readFile(fullFilePath, "utf8");
    if (!content) return "";

    const start = args.start_line_one_indexed;
    const end = args.end_line_one_indexed_inclusive;

    if (start == null && end == null) {
      return content;
    }

    const hasTrailingNewline = content.endsWith("\n");
    const lines = (hasTrailingNewline ? content.slice(0, -1) : content).split(
      "\n",
    );
    const startIdx = Math.max(0, (start ?? 1) - 1);
    const endIdx = Math.min(lines.length, end ?? lines.length);
    const result = lines.slice(startIdx, endIdx).join("\n");
    return endIdx >= lines.length && hasTrailingNewline
      ? result + "\n"
      : result;
  },
};
