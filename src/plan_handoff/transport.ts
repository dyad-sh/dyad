import { z } from "zod";
import type { RemoteClientDefinition } from "@/distributed_machines/remote_client";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";

export const PLAN_HANDOFF_MACHINE_ID = "plan_handoff" as const;

export const PlanHandoffKeySchema = z
  .object({ sourceChatId: z.number().int().positive() })
  .strict();
export type PlanHandoffKey = z.infer<typeof PlanHandoffKeySchema>;

const keyCache = new Map<number, PlanHandoffKey>();
export function planHandoffKey(sourceChatId: number): PlanHandoffKey {
  let key = keyCache.get(sourceChatId);
  if (!key) {
    key = Object.freeze({ sourceChatId });
    keyCache.set(sourceChatId, key);
  }
  return key;
}

export const PlanDocumentSchema = z
  .object({
    title: z.string(),
    summary: z.string().optional(),
    content: z.string(),
  })
  .strict();

export function serializePlanDocument(
  input: z.input<typeof PlanDocumentSchema>,
): string {
  const plan = PlanDocumentSchema.parse(input);
  return JSON.stringify({
    title: plan.title,
    ...(plan.summary === undefined ? {} : { summary: plan.summary }),
    content: plan.content,
  });
}

export const PlanHandoffIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    handoffId: z.string().min(1).max(256),
    sourceChatId: z.number().int().positive(),
    appId: z.number().int().positive(),
    acceptInNewChat: z.boolean(),
    planId: z.string().min(1),
    planVersion: z.string().min(1),
    planHash: z.string().min(1),
    plan: PlanDocumentSchema,
    originWindowSessionId: z.string().min(1).optional(),
  })
  .strict();
export type PlanHandoffIntent = z.infer<typeof PlanHandoffIntentSchema>;

export function serializePlanHandoffPlan(
  plan: PlanHandoffIntent["plan"],
): string {
  return JSON.stringify([plan.title, plan.summary ?? null, plan.content]);
}

export const PlanHandoffIntentEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ACCEPT"),
      intent: PlanHandoffIntentSchema,
    })
    .strict(),
]);
export type PlanHandoffIntentEvent = z.infer<
  typeof PlanHandoffIntentEventSchema
>;

const PlanHandoffPhaseSchema = z.enum([
  "idle",
  "accepted",
  "persisting",
  "preparing-chat",
  "awaiting-stream-idle",
  "submitting",
  "started",
  "failed",
  "cancelled",
]);
export type PlanHandoffPhase = z.infer<typeof PlanHandoffPhaseSchema>;

export const PlanHandoffRemoteSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceChatId: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    handoffId: z.string().nullable(),
    targetChatId: z.number().int().positive().nullable(),
    planId: z.string().nullable(),
    phase: PlanHandoffPhaseSchema,
    failure: z.string().nullable(),
  })
  .strict();
export type PlanHandoffRemoteSnapshot = z.infer<
  typeof PlanHandoffRemoteSnapshotSchema
>;

export function unavailablePlanHandoffSnapshot(
  sourceChatId: number,
): PlanHandoffRemoteSnapshot {
  return {
    schemaVersion: 1,
    sourceChatId,
    revision: 0,
    handoffId: null,
    targetChatId: null,
    planId: null,
    phase: "idle",
    failure: null,
  };
}

export const planHandoffClientDefinition = {
  id: PLAN_HANDOFF_MACHINE_ID,
  host: "main",
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: PlanHandoffKeySchema,
    encodeKey: (key) => key,
    eventCodec: PlanHandoffIntentEventSchema,
    snapshotCodec: PlanHandoffRemoteSnapshotSchema,
    keyToString: (key) => String(key.sourceChatId),
    unavailableSnapshot: (key) =>
      unavailablePlanHandoffSnapshot(key.sourceChatId),
  },
} satisfies RemoteClientDefinition<
  PlanHandoffKey,
  PlanHandoffRemoteSnapshot,
  PlanHandoffIntentEvent,
  "no-handoff" | "stale-handoff" | "already-running"
>;
