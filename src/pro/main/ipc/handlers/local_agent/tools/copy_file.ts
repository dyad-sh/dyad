import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { gitAdd } from "@/ipc/utils/git_utils";

const logger = log.scope("copy_file");

const ALLOWED_TEMP_DIR = path.join(os.tmpdir(), "dyad-attachments");

const copyFileSchema = z.object({
  from: z
    .string()
    .describe(
      "The source file path (can be a temp attachment path or a path relative to the app root)",
    ),
  to: z.string().describe("The destination file path relative to the app root"),
  description: z
    .string()
    .optional()
    .describe("Brief description of why the file is being copied"),
});

export const copyFileTool: ToolDefinition<z.infer<typeof copyFileSchema>> = {
  name: "copy_file",
  description:
    "Copy a file from one location to another. Can copy uploaded attachment files (from temp paths) into the codebase, or copy files within the codebase.",
  inputSchema: copyFileSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Copy ${args.from} to ${args.to}`,

  buildXml: (args, _isComplete) => {
    if (!args.from || !args.to) return undefined;
    return `<dyad-copy from="${escapeXmlAttr(args.from)}" to="${escapeXmlAttr(args.to)}" description="${escapeXmlAttr(args.description ?? "")}"></dyad-copy>`;
  },

  execute: async (args, ctx: AgentContext) => {
    // Resolve the source path: allow both temp attachment paths and app-relative paths
    let fromFullPath: string;
    if (path.isAbsolute(args.from)) {
      // Security: only allow absolute paths within the temp attachments directory
      const resolvedFrom = path.resolve(args.from);
      const resolvedTempDir = path.resolve(ALLOWED_TEMP_DIR);
      if (
        !resolvedFrom.startsWith(resolvedTempDir + path.sep) &&
        resolvedFrom !== resolvedTempDir
      ) {
        throw new Error(
          `Absolute source paths are only allowed within the temp attachments directory: ${ALLOWED_TEMP_DIR}`,
        );
      }
      fromFullPath = resolvedFrom;
    } else {
      fromFullPath = safeJoin(ctx.appPath, args.from);
    }

    const toFullPath = safeJoin(ctx.appPath, args.to);

    if (!fs.existsSync(fromFullPath)) {
      throw new Error(`Source file does not exist: ${args.from}`);
    }

    // Ensure destination directory exists
    const dirPath = path.dirname(toFullPath);
    fs.mkdirSync(dirPath, { recursive: true });

    // Copy the file
    fs.copyFileSync(fromFullPath, toFullPath);
    logger.log(`Successfully copied file: ${fromFullPath} -> ${toFullPath}`);

    // Add to git
    await gitAdd({ path: ctx.appPath, filepath: args.to });

    return `Successfully copied ${args.from} to ${args.to}`;
  },
};
