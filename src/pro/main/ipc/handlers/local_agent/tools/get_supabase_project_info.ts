import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  canUseSupabaseTools,
  escapeXmlContent,
} from "./types";
import { getSupabaseProjectInfo } from "../../../../../../supabase_admin/supabase_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { boundToolOutput, MAX_PROJECT_INFO_CHARS } from "./tool_output_limits";

const getSupabaseProjectInfoSchema = z.object({
  includeDbFunctions: z
    .boolean()
    .optional()
    .describe(
      "When true, includes database functions in the response. Defaults to false.",
    ),
});

export const getSupabaseProjectInfoTool: ToolDefinition<
  z.infer<typeof getSupabaseProjectInfoSchema>
> = {
  name: "get_supabase_project_info",
  description:
    "Get Supabase project overview: project ID, publishable key, secret names, and table names. Use this to discover what tables exist before fetching detailed schemas. Optionally include database functions.",
  inputSchema: getSupabaseProjectInfoSchema,
  defaultConsent: "always",
  isEnabled: canUseSupabaseTools,

  getConsentPreview: () => "Get Supabase project info",

  execute: async (args, ctx: AgentContext) => {
    if (!canUseSupabaseTools(ctx)) {
      throw new DyadError(
        "Supabase is not connected to this app",
        DyadErrorKind.Precondition,
      );
    }

    ctx.onXmlStream(
      "<dyad-supabase-project-info></dyad-supabase-project-info>",
    );

    const info = await getSupabaseProjectInfo({
      supabaseProjectId: ctx.supabaseProjectId,
      organizationSlug: ctx.supabaseOrganizationSlug ?? null,
      includeDbFunctions: args.includeDbFunctions,
    });

    ctx.onXmlComplete(
      `<dyad-supabase-project-info>\n${escapeXmlContent(info)}\n</dyad-supabase-project-info>`,
    );

    // The project info can be arbitrarily large (db functions, schemas, keys).
    // It is re-sent on every step of the turn, so bound the model-facing copy.
    return boundToolOutput(info, MAX_PROJECT_INFO_CHARS);
  },
};
