import fs from "node:fs";
import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { escapeSearchReplaceMarkers } from "@/pro/shared/search_replace_markers";
import { deploySupabaseFunction } from "@/supabase_admin/supabase_management_client";
import {
  extractFunctionNameFromPath,
  isServerFunction,
  isSharedServerModule,
} from "@/supabase_admin/supabase_utils";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import { withLock, getFileWriteKey } from "@/ipc/utils/lock_utils";
import { assertImplementerPathAllowed } from "../subagents/mutation_lease";

const logger = log.scope("search_replace");

const searchReplaceSchema = z.object({
  file_path: z
    .string()
    .describe("The path to the file you want to search and replace in."),
  old_string: z
    .string()
    .describe(
      "The text block to replace. Matching is line-based: each line in old_string must match a whole line in the file, not just a substring within a line. To edit part of a line, include the entire original line in old_string and the entire edited line in new_string. The block must be unique within the file.",
    ),
  new_string: z
    .string()
    .describe(
      "The edited text to replace the old_string (must be different from the old_string)",
    ),
});

export const searchReplaceTool: ToolDefinition<
  z.infer<typeof searchReplaceSchema>
> = {
  name: "search_replace",
  description: `Use this tool to propose a search and replace operation on an existing file.

The tool will replace ONE occurrence of old_string with new_string in the specified file. Matching is line-based: old_string must match whole file lines, not a partial fragment within a line. To edit part of a line, include the entire original line in old_string and the entire edited line in new_string.

CRITICAL REQUIREMENTS FOR USING THIS TOOL:

1. UNIQUENESS: The old_string MUST uniquely identify the specific instance you want to change. This means:
   - Include AT LEAST 3-5 lines of context BEFORE the change point
   - Include AT LEAST 3-5 lines of context AFTER the change point
   - Include all whitespace, indentation, and surrounding code exactly as it appears in the file
   - Do NOT use only a partial fragment of a line. Include the full line containing the change.

2. SINGLE INSTANCE: This tool can only change ONE instance at a time. If you need to change multiple instances:
   - Make separate calls to this tool for each instance
   - Each call must uniquely identify its specific instance using extensive context

3. VERIFICATION: Before using this tool:
   - If multiple instances exist, gather enough context to uniquely identify each one
   - Plan separate tool calls for each instance
`,
  inputSchema: searchReplaceSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `Edit ${args.file_path}`,

  buildXml: (args, isComplete) => {
    if (!args.file_path) return undefined;

    const escapedOld = escapeSearchReplaceMarkers(args.old_string ?? "");

    let xml = `<dyad-search-replace path="${escapeXmlAttr(args.file_path)}" description="">\n<<<<<<< SEARCH\n${escapeXmlContent(escapedOld)}`;

    // Add separator and replace content if new_string has started
    if (args.new_string !== undefined) {
      const escapedNew = escapeSearchReplaceMarkers(args.new_string);
      xml += `\n=======\n${escapeXmlContent(escapedNew)}`;
    }

    if (isComplete) {
      if (args.new_string === undefined) {
        xml += "\n=======\n";
      }
      xml += "\n>>>>>>> REPLACE\n</dyad-search-replace>";
    }

    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    assertImplementerPathAllowed(ctx, args.file_path);
    // Validate old_string !== new_string
    if (args.old_string === args.new_string) {
      throw new DyadError(
        "old_string and new_string must be different",
        DyadErrorKind.Validation,
      );
    }

    const operationPath = await assertMutationPathAllowed({
      appPath: ctx.appPath,
      relativePath: args.file_path,
    });
    const fullFilePath = safeJoin(ctx.appPath, operationPath);

    // Track if this is a shared module
    if (isSharedServerModule(operationPath)) {
      ctx.isSharedModulesChanged = true;
      ctx.sharedServerModulePaths.push(operationPath);
      ctx.onSharedServerModuleChange?.(operationPath);
    }

    await withLock(getFileWriteKey(fullFilePath), async () => {
      if (!fs.existsSync(fullFilePath)) {
        throw new DyadError(
          `File does not exist: ${args.file_path}`,
          DyadErrorKind.NotFound,
        );
      }

      const original = await fs.promises.readFile(fullFilePath, "utf8");

      // Construct the operations string in the expected format
      const escapedOld = escapeSearchReplaceMarkers(args.old_string);
      const escapedNew = escapeSearchReplaceMarkers(args.new_string);
      const operations = `<<<<<<< SEARCH\n${escapedOld}\n=======\n${escapedNew}\n>>>>>>> REPLACE`;

      const result = applySearchReplace(original, operations);

      if (!result.success || typeof result.content !== "string") {
        sendTelemetryEvent("local_agent:search_replace:failure", {
          filePath: operationPath,
          error: result.error ?? "unknown",
        });
        throw new Error(
          `Failed to apply search-replace: ${result.error ?? "unknown"}`,
        );
      }

      await fs.promises.writeFile(fullFilePath, result.content);
      logger.log(`Successfully applied search-replace to: ${fullFilePath}`);
      queueCloudSandboxSnapshotSync({
        appId: ctx.appId,
        changedPaths: [operationPath],
      });
      sendTelemetryEvent("local_agent:search_replace:success", {
        filePath: operationPath,
      });
    });

    // Deploy Supabase function if applicable
    if (ctx.supabaseProjectId && isServerFunction(operationPath)) {
      try {
        const functionName = extractFunctionNameFromPath(operationPath);
        if (ctx.allowDeploySideEffects === false) {
          ctx.pendingFunctionDeploys.push(functionName);
          ctx.onDeferredFunctionDeploy?.(functionName);
        } else if (!ctx.isSharedModulesChanged) {
          await deploySupabaseFunction({
            supabaseProjectId: ctx.supabaseProjectId,
            functionName,
            appPath: ctx.appPath,
            organizationSlug: ctx.supabaseOrganizationSlug ?? null,
          });
        } else {
          ctx.pendingFunctionDeploys.push(functionName);
        }
      } catch (error) {
        return `Search-replace applied, but failed to deploy Supabase function: ${error}`;
      }
    }

    return `Successfully applied edits to ${args.file_path}`;
  },
};
