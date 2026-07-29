import { z } from "zod";

export const REMOTE_MACHINE_PROTOCOL_VERSION = 1;
export const DEFAULT_REMOTE_OPERATION_OUTCOME_ENVELOPE_BYTES = 64 * 1_024;

/**
 * Conservatively bounds an already-cloned IPC value before domain codecs walk
 * it. Main uses the exact v8 serialized size; this renderer-safe traversal
 * charges container overhead and stops as soon as the machine budget is spent.
 */
export function isWithinStructuredCloneBudget(
  value: unknown,
  maxBytes: number,
): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return false;
  let remaining = maxBytes;
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  const charge = (bytes: number): boolean => {
    remaining -= bytes;
    return remaining >= 0;
  };
  const chargeString = (text: string, overhead = 0): boolean => {
    if (!charge(overhead)) return false;
    for (let index = 0; index < text.length; index += 1) {
      const codeUnit = text.charCodeAt(index);
      let bytes = codeUnit <= 0x7f ? 1 : codeUnit <= 0x7ff ? 2 : 3;
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < text.length) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes = 4;
          index += 1;
        }
      }
      if (!charge(bytes)) return false;
    }
    return true;
  };

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || current === undefined) {
      if (!charge(1)) return false;
      continue;
    }
    switch (typeof current) {
      case "boolean":
        if (!charge(4)) return false;
        continue;
      case "number":
        if (!charge(8)) return false;
        continue;
      case "bigint":
        return false;
      case "string":
        if (!chargeString(current, 4)) return false;
        continue;
      case "function":
      case "symbol":
        return false;
      case "object":
        break;
    }

    if (seen.has(current)) continue;
    seen.add(current);
    if (!charge(16)) return false;
    if (current instanceof ArrayBuffer) {
      if (!charge(current.byteLength)) return false;
      continue;
    }
    if (ArrayBuffer.isView(current)) {
      if (!charge(current.byteLength)) return false;
      continue;
    }
    if (current instanceof Date) {
      if (!charge(8)) return false;
      continue;
    }
    if (current instanceof Map) {
      for (const [key, nested] of current) {
        if (!charge(8)) return false;
        pending.push(key, nested);
      }
      continue;
    }
    if (current instanceof Set) {
      for (const nested of current) {
        if (!charge(4)) return false;
        pending.push(nested);
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(current);
    if (
      !Array.isArray(current) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return false;
    }
    for (const key of Object.keys(current)) {
      if (!chargeString(key, 4)) return false;
      pending.push((current as Record<string, unknown>)[key]);
    }
  }
  return true;
}

const protocolVersionSchema = z.number().int().nonnegative();
const machineIdSchema = z.string().min(1).max(128);
const messageIdSchema = z.string().min(1).max(256);
const actorInstanceIdSchema = z.string().min(1).max(256);
const revisionSchema = z.number().int().nonnegative();
const actorRuntimeMetadataSchema = z.object({
  actorInstanceId: actorInstanceIdSchema,
  snapshotRevision: revisionSchema,
  transactionSequence: revisionSchema,
});

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
    actor: actorRuntimeMetadataSchema,
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
