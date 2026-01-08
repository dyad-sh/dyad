import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { getSupabaseProjectInfo } from "../../../../../../supabase_admin/supabase_context";

const getSupabaseProjectInfoSchema = z.object({});

export const getSupabaseProjectInfoTool: ToolDefinition<
  z.infer<typeof getSupabaseProjectInfoSchema>
> = {
  name: "get_supabase_project_info",
  description:
    "Get Supabase project overview: project ID, publishable key, secret names, and table names. Use this to discover what tables exist before fetching detailed schemas.",
  inputSchema: getSupabaseProjectInfoSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => !!ctx.supabaseProjectId,

  getConsentPreview: () => "Get Supabase project info",

  execute: async (_args, ctx: AgentContext) => {
    if (!ctx.supabaseProjectId) {
      throw new Error("Supabase is not connected to this app");
    }

    ctx.onXmlStream(
      "<dyad-supabase-project-info></dyad-supabase-project-info>",
    );

    const info = await getSupabaseProjectInfo({
      supabaseProjectId: ctx.supabaseProjectId,
      organizationSlug: ctx.supabaseOrganizationSlug ?? null,
    });

    ctx.onXmlComplete(
      `<dyad-supabase-project-info>\n${escapeXmlContent(info)}\n</dyad-supabase-project-info>`,
    );

    return info;
  },
};
