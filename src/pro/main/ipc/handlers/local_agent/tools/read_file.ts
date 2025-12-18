import fs from "node:fs";
import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";

const readFile = fs.promises.readFile;

const readFileSchema = z.object({
  path: z.string().describe("The file path to read"),
});

export const readFileTool: ToolDefinition<z.infer<typeof readFileSchema>> = {
  name: "read_file",
  description: "Read the content of a file from the codebase",
  inputSchema: readFileSchema,
  defaultConsent: "always",

  buildXml: (args, _isComplete) => {
    if (!args.path) return undefined;
    return `<dyad-read path="${escapeXmlAttr(args.path)}"></dyad-read>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "read_file",
      toolDescription: "Read a file",
      inputPreview: `Read ${args.path}`,
    });
    if (!allowed) {
      throw new Error("User denied permission for read_file");
    }

    const fullFilePath = safeJoin(ctx.appPath, args.path);

    if (!fs.existsSync(fullFilePath)) {
      throw new Error(`File does not exist: ${args.path}`);
    }

    const content = await readFile(fullFilePath, "utf8");
    return content || "";
  },
};
