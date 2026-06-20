import fs from "node:fs";
import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  assertDyadInternalAccessAllowed,
  resolveTargetAppPath,
} from "./resolve_app_context";
import { resolveAttachmentLogicalPath } from "@/ipc/utils/media_path_utils";

const readFile = fs.promises.readFile;

const readFileSchema = z
  .object({
    path: z.string().describe("The file path to read"),
    app_name: z
      .string()
      .optional()
      .describe(
        "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to read from instead of the current app. Omit to read from the current app.",
      ),
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
  description: `Read the content of a file from the codebase or an attachment path such as attachments:notes.txt.
  
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.`,
  inputSchema: readFileSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    const location = args.app_name
      ? `${args.app_name}:${args.path}`
      : args.path;
    const start = args.start_line_one_indexed;
    const end = args.end_line_one_indexed_inclusive;
    if (start != null && end != null) {
      return `Read ${location} (lines ${start}-${end})`;
    } else if (start != null) {
      return `Read ${location} (from line ${start})`;
    } else if (end != null) {
      return `Read ${location} (to line ${end})`;
    }
    return `Read ${location}`;
  },

  buildXml: (args, _isComplete) => {
    if (!args.path) return undefined;
    const attrs = [`path="${escapeXmlAttr(args.path)}"`];
    if (args.app_name) {
      attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
    }
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
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    let fullFilePath: string;
    if (args.path.startsWith("attachments:")) {
      const attachment = await resolveAttachmentLogicalPath(
        targetAppPath,
        args.path,
      );
      if (!attachment) {
        const appContext = args.app_name ? ` (in app: ${args.app_name})` : "";
        throw new DyadError(
          `Attachment does not exist: ${args.path}${appContext}`,
          DyadErrorKind.NotFound,
        );
      }
      fullFilePath = attachment.filePath;
    } else {
      fullFilePath = safeJoin(targetAppPath, args.path);
    }

    assertDyadInternalAccessAllowed({
      targetAppPath,
      fullFilePath,
      appName: args.app_name,
    });

    if (!fs.existsSync(fullFilePath)) {
      const appContext = args.app_name ? ` (in app: ${args.app_name})` : "";
      throw new DyadError(
        `File does not exist: ${args.path}${appContext}`,
        DyadErrorKind.NotFound,
      );
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
