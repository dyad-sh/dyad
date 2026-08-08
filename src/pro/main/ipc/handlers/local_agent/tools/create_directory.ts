import fs from "node:fs";
import { z } from "zod";

import { safeJoin } from "@/ipc/utils/path_utils";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import type { AgentContext, ToolDefinition } from "./types";

const createDirectorySchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Directory path relative to the active workspace root"),
});

export const createDirectoryTool: ToolDefinition<
  z.infer<typeof createDirectorySchema>
> = {
  name: "create_directory",
  description:
    "Create a folder, including any missing parent folders, inside the active workspace",
  inputSchema: createDirectorySchema,
  defaultConsent: "always",
  modifiesState: true,
  getConsentPreview: ({ path }) => `Create workspace folder ${path}`,
  execute: async ({ path }, ctx: AgentContext) => {
    const fullPath = safeJoin(ctx.appPath, path);
    await fs.promises.mkdir(fullPath, { recursive: true });
    queueCloudSandboxSnapshotSync({
      appId: ctx.appId,
      changedPaths: [path],
    });
    return `Created directory ${path}`;
  },
};
