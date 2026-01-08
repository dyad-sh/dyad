import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { getSupabaseProjectInfo } from "../../../../../../supabase_admin/supabase_context";

const getSupabaseProjectInfoSchema = z.object({});

const XML_TAG = "<dyad-supabase-project-info></dyad-supabase-project-info>";

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

  buildXml: (_args, _isComplete) => {
    return XML_TAG;
  },

  execute: async (_args, ctx: AgentContext) => {
    if (!ctx.supabaseProjectId) {
      throw new Error("Supabase is not connected to this app");
    }

    const info = await getSupabaseProjectInfo({
      supabaseProjectId: ctx.supabaseProjectId,
      organizationSlug: ctx.supabaseOrganizationSlug ?? null,
    });

    return info;
  },
};
