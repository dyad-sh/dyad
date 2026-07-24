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
export const UserInputQuestionSchema = z
  .object({
    id: z.string(),
    type: z.enum(["text", "radio", "checkbox"]),
    question: z.string(),
    options: z.array(z.string()).min(1).optional(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
  })
  .refine(
    (question) =>
      question.type === "text" ||
      (question.options && question.options.length >= 1),
    {
      message: "options are required for radio and checkbox questions",
      path: ["options"],
    },
  );
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
    questions: z.array(UserInputQuestionSchema),
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
  z.object({ kind: z.literal("follow-up-dispatched") }),
]);

const PendingSnapshotSchema = z.object({
  status: z.enum(["awaiting", "armed", "due", "accepted"]),
  descriptor: UserInputDescriptorSchema,
  deadlineAt: z.number(),
  classifier: z.enum(["none", "racing", "review"]).optional(),
  classifierReason: z.string().optional(),
  followUpPrompt: z.string().optional(),
});
const OutcomeSchema = z.enum([
  "human",
  "classifier-approved",
  "timed-out",
  "swept",
  "superseded",
  "acknowledged",
  "rejected",
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
  acceptFollowUp: defineContract({
    channel: "user-input:accept-follow-up",
    input: z.object({
      requestId: z.string(),
      chatId: z.number(),
      prompt: z.string(),
    }),
    output: z.void(),
  }),
  beginFollowUpExecution: defineContract({
    channel: "user-input:begin-follow-up-execution",
    input: z.object({ requestId: z.string() }),
    output: z.void(),
  }),
  retryFollowUp: defineContract({
    channel: "user-input:retry-follow-up",
    input: z.object({ requestId: z.string(), error: z.string() }),
    output: z.void(),
  }),
  rejectFollowUp: defineContract({
    channel: "user-input:reject-follow-up",
    input: z.object({ requestId: z.string(), reason: z.string() }),
    output: z.void(),
  }),
} as const;

export const userInputEvents = {
  requested: defineEvent({
    channel: "user-input:requested",
    payload: UserInputDescriptorSchema,
  }),
  armed: defineEvent({
    channel: "user-input:armed",
    payload: z.object({
      requestId: z.string(),
      followUpPrompt: z.string(),
    }),
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
export type UserInputQuestionPayload = z.infer<typeof UserInputQuestionSchema>;
