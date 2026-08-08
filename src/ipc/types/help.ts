import { z } from "zod";
import {
  defineContract,
  defineStream,
  createClient,
  createStreamClient,
} from "../contracts/core";

// =============================================================================
// Help Schemas
// =============================================================================

export const HelpChatStartParamsSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
});

export type HelpChatStartParams = z.infer<typeof HelpChatStartParamsSchema>;

export const HelpChatChunkSchema = z.object({
  sessionId: z.string(),
  delta: z.string(),
});

export const HelpChatEndSchema = z.object({
  sessionId: z.string(),
});

export const HelpChatErrorSchema = z.object({
  sessionId: z.string(),
  error: z.string(),
});

// =============================================================================
// Help Contracts
// =============================================================================

export const helpContracts = {
  start: defineContract({
    channel: "help:chat:start",
    input: HelpChatStartParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  cancel: defineContract({
    channel: "help:chat:cancel",
    input: z.string(), // sessionId
    output: z.object({ ok: z.literal(true) }),
  }),
} as const;

// =============================================================================
// Help Stream Contract
// =============================================================================

export const helpStreamContract = defineStream({
  channel: "help:chat:start",
  input: HelpChatStartParamsSchema,
  keyField: "sessionId",
  events: {
    chunk: {
      channel: "help:chat:response:chunk",
      payload: HelpChatChunkSchema,
    },
    end: {
      channel: "help:chat:response:end",
      payload: HelpChatEndSchema,
    },
    error: {
      channel: "help:chat:response:error",
      payload: HelpChatErrorSchema,
    },
  },
});

// =============================================================================
// Help Clients
// =============================================================================

export const helpClient = createClient(helpContracts);
export const helpStreamClient = createStreamClient(helpStreamContract);
