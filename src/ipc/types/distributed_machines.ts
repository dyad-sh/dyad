import {
  createClient,
  createEventClient,
  defineContract,
  defineEvent,
} from "../contracts/core";
import {
  MachineAddressSchema,
  MachineDispatchEnvelopeSchema,
  MachineDispatchReceiptSchema,
  MachineDisposedEnvelopeSchema,
  MachineOperationOutcomeEnvelopeSchema,
  MachineProtocolMismatchSchema,
  MachineSnapshotEnvelopeSchema,
} from "../../distributed_machines/remote_protocol";
import { z } from "zod";

export const distributedMachineContracts = {
  subscribe: defineContract({
    channel: "distributed-machine:subscribe",
    input: MachineAddressSchema,
    output: MachineSnapshotEnvelopeSchema,
  }),
  dispatch: defineContract({
    channel: "distributed-machine:dispatch",
    input: MachineDispatchEnvelopeSchema,
    output: MachineDispatchReceiptSchema,
  }),
  unsubscribe: defineContract({
    channel: "distributed-machine:unsubscribe",
    input: MachineAddressSchema,
    output: z.void(),
  }),
} as const;

export const distributedMachineEvents = {
  snapshot: defineEvent({
    channel: "distributed-machine:snapshot",
    payload: MachineSnapshotEnvelopeSchema,
  }),
  disposed: defineEvent({
    channel: "distributed-machine:disposed",
    payload: MachineDisposedEnvelopeSchema,
  }),
  operationOutcome: defineEvent({
    channel: "distributed-machine:operation-outcome",
    payload: MachineOperationOutcomeEnvelopeSchema,
  }),
  protocolMismatch: defineEvent({
    channel: "distributed-machine:protocol-mismatch",
    payload: MachineProtocolMismatchSchema,
  }),
} as const;

export const distributedMachineClient = createClient(
  distributedMachineContracts,
);
export const distributedMachineEventClient = createEventClient(
  distributedMachineEvents,
);
