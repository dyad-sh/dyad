import { z } from "zod";

export const SqlConsentMetadataSchema = z.object({
  sqlMutatesSchema: z.boolean().optional(),
  sqlDeletesData: z.boolean().optional(),
});

export type SqlConsentMetadata = z.infer<typeof SqlConsentMetadataSchema>;
