import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

export const TempPreviewStatusSchema = z.object({
  state: z.enum(["none", "active", "expired", "revoked"]),
  canonicalUrl: z.string().url().nullable(),
  expiresAt: z.string().nullable(),
  lastPublishedAt: z.string().nullable(),
});

export type TempPreviewStatus = z.infer<typeof TempPreviewStatusSchema>;

const TempPreviewAppParamsSchema = z.object({
  appId: z.number().int().positive(),
});

export const tempPreviewContracts = {
  getStatus: defineContract({
    channel: "temp-preview:get-status",
    input: TempPreviewAppParamsSchema,
    output: TempPreviewStatusSchema,
  }),
  publish: defineContract({
    channel: "temp-preview:publish",
    input: TempPreviewAppParamsSchema,
    output: TempPreviewStatusSchema,
    invalidates: (input) => [{ family: "temp-preview", appId: input.appId }],
    originHandles: (input) => [{ family: "temp-preview", appId: input.appId }],
  }),
  revoke: defineContract({
    channel: "temp-preview:revoke",
    input: TempPreviewAppParamsSchema,
    output: TempPreviewStatusSchema,
    invalidates: (input) => [{ family: "temp-preview", appId: input.appId }],
    originHandles: (input) => [{ family: "temp-preview", appId: input.appId }],
  }),
} as const;

export const tempPreviewClient = createClient(tempPreviewContracts);
