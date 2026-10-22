import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  canUseNeonTools,
  escapeXmlContent,
} from "./types";
import { getNeonProjectInfo } from "../../../../../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { boundToolOutput, MAX_PROJECT_INFO_CHARS } from "./tool_output_limits";

// At least one property is needed because Vertex AI rejects empty parameter schemas.
const getNeonProjectInfoSchema = z.object({
  _reserved: z
    .boolean()
    .optional()
    .describe(
      "Reserved placeholder because some model providers reject empty parameter schemas. Leave this unset.",
    ),
});

export const getNeonProjectInfoTool: ToolDefinition<
  z.infer<typeof getNeonProjectInfoSchema>
> = {
  name: "get_neon_project_info",
  description:
    "Get Neon project overview: project ID, branches, and table names. Use this to discover what tables exist before fetching detailed schemas.",
  inputSchema: getNeonProjectInfoSchema,
  defaultConsent: "always",
  isEnabled: canUseNeonTools,

  getConsentPreview: () => "Get Neon project info",

  execute: async (_args, ctx: AgentContext) => {
    if (!canUseNeonTools(ctx)) {
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

    // The project info can be arbitrarily large (schemas, branches, keys). It is
    // re-sent on every step of the turn, so bound the model-facing copy.
    return boundToolOutput(info, MAX_PROJECT_INFO_CHARS);
  },
};
