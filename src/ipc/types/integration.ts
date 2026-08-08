import { z } from "zod";
import {
  defineEvent,
  createEventClient,
  defineContract,
  createClient,
} from "../contracts/core";

export const IntegrationPromptSchema = z.object({
  chatId: z.number(),
  requestId: z.string(),
  provider: z.enum(["supabase", "neon"]).optional(),
});

export type IntegrationPromptPayload = z.infer<typeof IntegrationPromptSchema>;

export const IntegrationResponseSchema = z.object({
  requestId: z.string(),
  provider: z.enum(["supabase", "neon"]).nullable(),
  completed: z.boolean(),
});

export type IntegrationResponsePayload = z.infer<
  typeof IntegrationResponseSchema
>;

export const integrationEvents = {
  prompt: defineEvent({
    channel: "integration:prompt",
    payload: IntegrationPromptSchema,
  }),
} as const;

export const integrationContracts = {
  respond: defineContract({
    channel: "integration:response",
    input: IntegrationResponseSchema,
    output: z.void(),
  }),
} as const;

export const integrationEventClient = createEventClient(integrationEvents);

export const integrationClient = createClient(integrationContracts);
