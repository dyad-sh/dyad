import { z } from "zod";

export const appDetailsSearchSchema = z.object({
  appId: z.number().optional(),
  provider: z.enum(["neon", "supabase"]).optional(),
});
