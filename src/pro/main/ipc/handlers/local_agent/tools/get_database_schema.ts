import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { getSupabaseContext } from "../../../../../../supabase_admin/supabase_context";

const getDatabaseSchemaSchema = z.object({});

const XML_TAG = "<dyad-database-schema></dyad-database-schema>";

export const getDatabaseSchemaTool: ToolDefinition<
  z.infer<typeof getDatabaseSchemaSchema>
> = {
  name: "get_database_schema",
  description: "Fetch the database schema from Supabase",
  inputSchema: getDatabaseSchemaSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => !!ctx.supabaseProjectId,

  getConsentPreview: () => "Get Supabase schema",

  buildXml: (_args, _isComplete) => {
    // This tool has no inputs, so always return the same XML
    return XML_TAG;
  },

  execute: async (_args, ctx: AgentContext) => {
    if (!ctx.supabaseProjectId) {
      throw new Error("Supabase is not connected to this app");
    }

    const schema = await getSupabaseContext({
      supabaseProjectId: ctx.supabaseProjectId,
      organizationSlug: ctx.supabaseOrganizationSlug ?? null,
    });

    return schema || "";
  },
};
