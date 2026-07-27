import log from "electron-log";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  getGitUncommittedFiles,
  gitAddAll,
  gitCommit,
  hasStagedChanges,
} from "@/ipc/utils/git_utils";
import { readSettings } from "@/main/settings";
import {
  deployAffectedSupabaseFunctions,
  type SupabaseDeployProgress,
} from "@/supabase_admin/supabase_utils";
import { escapeXmlAttr, escapeXmlContent } from "../../../../shared/xmlEscape";
import type { AgentContext } from "../tools/dyad/types";

const logger = log.scope("pi-file-operations");

export interface PiSupabaseDeployResult {
  xmlParts: string[];
  warningMessages: string[];
}

function renderSupabaseDeployStatus(progress: SupabaseDeployProgress): string {
  const state =
    progress.phase === "failed"
      ? "aborted"
      : progress.phase === "finished"
        ? "finished"
        : "in-progress";
  const title =
    progress.phase === "finished"
      ? `Supabase functions deployed: ${progress.completed}/${progress.total} complete`
      : progress.phase === "failed"
        ? `Supabase functions failed to deploy: ${progress.completed}/${progress.total} complete`
        : `Deploying Supabase functions: ${progress.completed}/${progress.total} complete (${progress.active} active, ${progress.queued} queued)`;
  const content = [
    `${progress.succeeded} succeeded`,
    `${progress.failed} failed`,
    `${progress.active} active`,
    `${progress.queued} queued`,
  ];
  if (progress.functionName) content.push(`Latest: ${progress.functionName}`);
  return `<dyad-status title="${escapeXmlAttr(title)}" state="${state}">\n${escapeXmlContent(content.join("\n"))}\n</dyad-status>`;
}

export async function deployPiSupabaseFunctions(
  ctx: Pick<
    AgentContext,
    | "appPath"
    | "supabaseProjectId"
    | "supabaseOrganizationSlug"
    | "isSharedModulesChanged"
    | "sharedServerModulePaths"
    | "pendingFunctionDeploys"
    | "abortSignal"
  >,
): Promise<PiSupabaseDeployResult> {
  if (
    !ctx.supabaseProjectId ||
    (!ctx.isSharedModulesChanged && ctx.pendingFunctionDeploys.length === 0)
  ) {
    return { xmlParts: [], warningMessages: [] };
  }

  const xmlParts: string[] = [];
  const warningMessages: string[] = [];
  try {
    const settings = readSettings();
    const deployErrors = await deployAffectedSupabaseFunctions({
      appPath: ctx.appPath,
      supabaseProjectId: ctx.supabaseProjectId,
      supabaseOrganizationSlug: ctx.supabaseOrganizationSlug ?? null,
      skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? false,
      sharedModulesChanged: ctx.isSharedModulesChanged,
      changedSharedModulePaths: ctx.sharedServerModulePaths,
      pendingFunctionDeploys: ctx.pendingFunctionDeploys,
      signal: ctx.abortSignal,
      onProgress: (progress) => {
        if (progress.phase === "finished" || progress.phase === "failed") {
          xmlParts.push(renderSupabaseDeployStatus(progress));
        }
      },
    });
    if (deployErrors.length > 0) {
      const warning = `Some Supabase functions failed to deploy: ${deployErrors.join(", ")}`;
      warningMessages.push(warning);
      xmlParts.push(
        `<dyad-output type="warning" message="Supabase function deploy warning">${escapeXmlContent(warning)}</dyad-output>`,
      );
    }
  } catch (error) {
    if (ctx.abortSignal?.aborted) {
      throw new DyadError(
        "Supabase function deployment was cancelled",
        DyadErrorKind.UserCancelled,
      );
    }
    const warning = `Failed to redeploy Supabase functions: ${error}`;
    warningMessages.push(warning);
    xmlParts.push(
      `<dyad-output type="error" message="Failed to deploy Supabase functions">${escapeXmlContent(warning)}</dyad-output>`,
    );
  }
  return { xmlParts, warningMessages };
}

export async function commitPiTurnChanges(
  appPath: string,
  chatSummary?: string,
): Promise<string | undefined> {
  try {
    const uncommittedFiles = await getGitUncommittedFiles({ path: appPath });
    if (uncommittedFiles.length === 0) return undefined;

    await gitAddAll({ path: appPath });
    if (!(await hasStagedChanges({ path: appPath }))) return undefined;
    try {
      return await gitCommit({
        path: appPath,
        message: chatSummary
          ? `[dyad] ${chatSummary}`
          : `[dyad] (${uncommittedFiles.length} files changed)`,
      });
    } catch (error) {
      if (!(await hasStagedChanges({ path: appPath }))) return undefined;
      throw error;
    }
  } catch (error) {
    logger.error("Failed to commit pi turn changes", error);
    throw new DyadError(
      `Failed to commit changes: ${error}`,
      DyadErrorKind.External,
    );
  }
}
