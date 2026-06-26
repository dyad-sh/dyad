import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const FreeModelQuotaStatusSchema = z.object({
  messagesUsed: z.number(),
  messagesLimit: z.number(),
  messagesRemaining: z.number(),
  isQuotaExceeded: z.boolean(),
  resetTime: z.number().nullable(),
});

export type FreeModelQuotaStatus = z.infer<typeof FreeModelQuotaStatusSchema>;

export const freeModelQuotaContracts = {
  getFreeModelQuotaStatus: defineContract({
    channel: "free-model-quota:get-status",
    input: z.void(),
    output: FreeModelQuotaStatusSchema,
  }),
} as const;

export const freeModelQuotaClient = createClient(freeModelQuotaContracts);

export type GetFreeModelQuotaStatusOutput = z.infer<
  (typeof freeModelQuotaContracts)["getFreeModelQuotaStatus"]["output"]
>;
