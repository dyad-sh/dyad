import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { getDatabaseSchema } from "../processors/file_operations";

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

    const result = await getDatabaseSchema(ctx);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.schema || "";
  },
};
