import { z } from "zod";

export const REMOTE_MACHINE_PROTOCOL_VERSION = 1;

const protocolVersionSchema = z.number().int().nonnegative();
const machineIdSchema = z.string().min(1).max(128);
const messageIdSchema = z.string().min(1).max(256);
const actorInstanceIdSchema = z.string().min(1).max(256);
const revisionSchema = z.number().int().nonnegative();

export const MachineIdentitySchema = z.object({
  protocolVersion: protocolVersionSchema,
  machineId: machineIdSchema,
});

export const MachineAddressSchema = MachineIdentitySchema.extend({
  encodedKey: z.unknown(),
});

export const MachineDispatchEnvelopeSchema = MachineAddressSchema.extend({
  expectedActorInstanceId: actorInstanceIdSchema.optional(),
  messageId: messageIdSchema,
  causationId: z.string().min(1).max(256).optional(),
  correlationId: z.string().min(1).max(256).optional(),
  expectedRevision: revisionSchema.optional(),
  encodedEvent: z.unknown(),
});

export const MachineSnapshotEnvelopeSchema = MachineAddressSchema.extend({
  actorInstanceId: actorInstanceIdSchema,
  revision: revisionSchema,
  encodedState: z.unknown(),
});

export const MachineDisposedEnvelopeSchema = MachineAddressSchema.extend({
  actorInstanceId: actorInstanceIdSchema,
  finalRevision: revisionSchema,
});

export const MachineOperationOutcomeEnvelopeSchema =
  MachineAddressSchema.extend({
    requestId: z.string().min(1).max(256),
    invocationRef: z.unknown(),
    outcome: z.unknown(),
  });

export const MachineProtocolMismatchSchema = z.object({
  machineId: machineIdSchema,
  expectedProtocolVersion: protocolVersionSchema,
  receivedProtocolVersion: protocolVersionSchema,
});

export const MachineRejectedReasonSchema = z.enum([
  "unknown-machine",
  "invalid-key",
  "invalid-event",
  "unauthorized",
  "stale-actor",
  "revision-conflict",
  "host-disposing",
  "protocol-version",
]);

export const MachineDispatchReceiptSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("applied"),
    actorInstanceId: actorInstanceIdSchema,
    revision: revisionSchema,
    transactionSequence: revisionSchema,
    messageId: messageIdSchema,
  }),
  z.object({
    kind: z.literal("ignored"),
    actorInstanceId: actorInstanceIdSchema,
    revision: revisionSchema,
    transactionSequence: revisionSchema,
    messageId: messageIdSchema,
    reason: z.unknown(),
  }),
  z.object({
    kind: z.literal("rejected"),
    messageId: messageIdSchema,
    reason: MachineRejectedReasonSchema,
  }),
]);

export type MachineAddress = z.infer<typeof MachineAddressSchema>;
export type MachineDispatchEnvelope = z.infer<
  typeof MachineDispatchEnvelopeSchema
>;
export type MachineSnapshotEnvelope = z.infer<
  typeof MachineSnapshotEnvelopeSchema
>;
export type MachineDisposedEnvelope = z.infer<
  typeof MachineDisposedEnvelopeSchema
>;
export type MachineOperationOutcomeEnvelope = z.infer<
  typeof MachineOperationOutcomeEnvelopeSchema
>;
export type MachineProtocolMismatch = z.infer<
  typeof MachineProtocolMismatchSchema
>;
export type MachineRejectedReason = z.infer<typeof MachineRejectedReasonSchema>;
export type MachineDispatchReceipt<Reason = unknown> =
  | {
      readonly kind: "applied";
      readonly actorInstanceId: string;
      readonly revision: number;
      readonly transactionSequence: number;
      readonly messageId: string;
    }
  | {
      readonly kind: "ignored";
      readonly actorInstanceId: string;
      readonly revision: number;
      readonly transactionSequence: number;
      readonly messageId: string;
      readonly reason: Reason;
    }
  | {
      readonly kind: "rejected";
      readonly messageId: string;
      readonly reason: MachineRejectedReason;
    };
