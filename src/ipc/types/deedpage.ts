import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// deed.page Schemas
// =============================================================================

export const DeedPageSiteSchema = z.object({
  slug: z.string(),
  url: z.string(),
});

export type DeedPageSite = z.infer<typeof DeedPageSiteSchema>;

export const DeedPageAppParamsSchema = z.object({
  appId: z.number(),
});

export const PublishToDeedPageParamsSchema = z.object({
  appId: z.number(),
  /** Only used for the app's first publish. Later publishes reuse the saved site. */
  slug: z.string().optional(),
});

export type PublishToDeedPageParams = z.infer<
  typeof PublishToDeedPageParamsSchema
>;

export const PublishToDeedPageResultSchema = z.object({
  slug: z.string(),
  url: z.string(),
  version: z.string(),
});

export type PublishToDeedPageResult = z.infer<
  typeof PublishToDeedPageResultSchema
>;

// =============================================================================
// deed.page Contracts
// =============================================================================

export const deedPageContracts = {
  getSite: defineContract({
    channel: "deedpage:get-site",
    input: DeedPageAppParamsSchema,
    output: DeedPageSiteSchema.nullable(),
  }),

  publish: defineContract({
    channel: "deedpage:publish",
    input: PublishToDeedPageParamsSchema,
    output: PublishToDeedPageResultSchema,
  }),

  disconnect: defineContract({
    channel: "deedpage:disconnect",
    input: DeedPageAppParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// deed.page Client
// =============================================================================

export const deedPageClient = createClient(deedPageContracts);
