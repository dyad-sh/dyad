import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

export const CloudAppSchema = z.object({
  name: z.string(),
  pathname: z.string(),
  url: z.string(),
  size: z.number(),
  uploadedAt: z.string(),
});
export type CloudApp = z.infer<typeof CloudAppSchema>;

export const cloudAppsContracts = {
  backup: defineContract({
    channel: "cloud-apps:backup",
    input: z.object({ appId: z.number() }),
    output: z.object({ ok: z.boolean() }),
  }),

  list: defineContract({
    channel: "cloud-apps:list",
    input: z.void(),
    output: z.array(CloudAppSchema),
  }),

  restore: defineContract({
    channel: "cloud-apps:restore",
    input: z.object({ url: z.string(), pathname: z.string() }),
    output: z.object({ appId: z.number(), name: z.string() }),
  }),
} as const;

export const cloudAppsClient = createClient(cloudAppsContracts);
