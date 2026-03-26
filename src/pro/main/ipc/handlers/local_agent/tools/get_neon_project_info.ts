import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { getNeonProjectInfo } from "../../../../../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const getNeonProjectInfoSchema = z.object({});

export const getNeonProjectInfoTool: ToolDefinition<
  z.infer<typeof getNeonProjectInfoSchema>
> = {
  name: "get_neon_project_info",
  description:
    "Get Neon project overview: project ID, branches, and table names. Use this to discover what tables exist before fetching detailed schemas.",
  inputSchema: getNeonProjectInfoSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => !!ctx.neonProjectId,

  getConsentPreview: () => "Get Neon project info",

  execute: async (_args, ctx: AgentContext) => {
    if (!ctx.neonProjectId || !ctx.neonActiveBranchId) {
      throw new DyadError(
        "Neon is not connected to this app",
        DyadErrorKind.Precondition,
      );
    }

    ctx.onXmlStream("<dyad-neon-project-info></dyad-neon-project-info>");

    const info = await getNeonProjectInfo({
      projectId: ctx.neonProjectId,
      branchId: ctx.neonActiveBranchId,
    });

    ctx.onXmlComplete(
      `<dyad-neon-project-info>\n${escapeXmlContent(info)}\n</dyad-neon-project-info>`,
    );

    return info;
  },
};
