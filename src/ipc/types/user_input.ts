import { z } from "zod";
import {
  createClient,
  createEventClient,
  defineContract,
  defineEvent,
} from "../contracts/core";

const ConsentDecisionSchema = z.enum([
  "accept-once",
  "accept-always",
  "decline",
]);
const DescriptorBaseSchema = z.object({
  requestId: z.string(),
  chatId: z.number(),
  deadlineAt: z.number(),
  followUpPrompt: z.string().optional(),
});
export const UserInputDescriptorSchema = z.discriminatedUnion("kind", [
  DescriptorBaseSchema.extend({
    kind: z.literal("mcp-consent"),
    serverId: z.number(),
    serverName: z.string(),
    toolName: z.string(),
    toolDescription: z.string().nullable().optional(),
    inputPreview: z.string().nullable().optional(),
    classifier: z.enum(["none", "racing"]),
  }),
  DescriptorBaseSchema.extend({
    kind: z.literal("agent-consent"),
    toolName: z.string(),
    toolDescription: z.string().nullable().optional(),
    inputPreview: z.string().nullable().optional(),
    metadata: z.unknown().optional(),
    classifier: z.literal("none"),
  }),
  DescriptorBaseSchema.extend({
    kind: z.literal("questionnaire"),
    questions: z.array(z.unknown()),
    classifier: z.literal("none"),
  }),
  DescriptorBaseSchema.extend({
    kind: z.literal("integration"),
    provider: z.enum(["supabase", "neon"]).optional(),
    classifier: z.literal("none"),
    followUpPrompt: z.string(),
  }),
]);

export const UserInputResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mcp-consent"), decision: ConsentDecisionSchema }),
  z.object({
    kind: z.literal("agent-consent"),
    decision: ConsentDecisionSchema,
  }),
  z.object({
    kind: z.literal("questionnaire"),
    answers: z.record(z.string(), z.string()).nullable(),
  }),
  z.object({
    kind: z.literal("integration"),
    provider: z.enum(["supabase", "neon"]).nullable(),
    completed: z.boolean(),
  }),
]);

const PendingSnapshotSchema = z.object({
  status: z.enum(["awaiting", "armed", "due"]),
  descriptor: UserInputDescriptorSchema,
  deadlineAt: z.number(),
  classifier: z.enum(["none", "racing", "review"]).optional(),
  followUpPrompt: z.string().optional(),
});
const OutcomeSchema = z.enum([
  "human",
  "classifier-approved",
  "timed-out",
  "swept",
  "superseded",
  "dispatched",
]);

export const userInputContracts = {
  respond: defineContract({
    channel: "user-input:respond",
    input: z.object({
      requestId: z.string(),
      response: UserInputResponseSchema,
    }),
    output: z.void(),
  }),
  getPending: defineContract({
    channel: "user-input:get-pending",
    input: z.void(),
    output: z.array(PendingSnapshotSchema),
  }),
} as const;

export const userInputEvents = {
  requested: defineEvent({
    channel: "user-input:requested",
    payload: UserInputDescriptorSchema,
  }),
  classified: defineEvent({
    channel: "user-input:classified",
    payload: z.object({ requestId: z.string(), reason: z.string().optional() }),
  }),
  settled: defineEvent({
    channel: "user-input:settled",
    payload: z.object({ requestId: z.string(), outcome: OutcomeSchema }),
  }),
  followUpDue: defineEvent({
    channel: "user-input:follow-up-due",
    payload: z.object({
      requestId: z.string(),
      chatId: z.number(),
      prompt: z.string(),
    }),
  }),
} as const;

export const userInputClient = createClient(userInputContracts);
export const userInputEventClient = createEventClient(userInputEvents);

export type UserInputDescriptorPayload = z.infer<
  typeof UserInputDescriptorSchema
>;
export type UserInputResponsePayload = z.infer<typeof UserInputResponseSchema>;
export type PendingUserInputPayload = z.infer<typeof PendingSnapshotSchema>;
