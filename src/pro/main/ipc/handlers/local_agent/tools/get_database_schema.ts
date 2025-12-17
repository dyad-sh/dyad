import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { getSupabaseContext } from "../../../../../../supabase_admin/supabase_context";

const getDatabaseSchemaSchema = z.object({});

export const getDatabaseSchemaTool: ToolDefinition<
  z.infer<typeof getDatabaseSchemaSchema>
> = {
  name: "get_database_schema",
  description: "Fetch the database schema from Supabase",
  inputSchema: getDatabaseSchemaSchema,
  defaultConsent: "always",
  execute: async (_args, ctx: AgentContext) => {
    if (!ctx.supabaseProjectId) {
      throw new Error("Supabase is not connected to this app");
    }

    const allowed = await ctx.requireConsent({
      toolName: "get_database_schema",
      toolDescription: "Fetch database schema",
      inputPreview: "Get Supabase schema",
    });
    if (!allowed) {
      throw new Error("User denied permission for get_database_schema");
    }

    ctx.onXmlChunk(`<dyad-database-schema></dyad-database-schema>`);

    const schema = await getSupabaseContext({
      supabaseProjectId: ctx.supabaseProjectId,
    });

    return schema || "";
  },
};
