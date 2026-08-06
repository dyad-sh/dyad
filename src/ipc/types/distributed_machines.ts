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

const rendererConnectionIdSchema = z.string().uuid();
const RendererMachineAddressSchema = MachineAddressSchema.extend({
  rendererConnectionId: rendererConnectionIdSchema,
});
const RendererMachineDispatchEnvelopeSchema =
  MachineDispatchEnvelopeSchema.extend({
    rendererConnectionId: rendererConnectionIdSchema,
  });

export const distributedMachineContracts = {
  subscribe: defineContract({
    channel: "distributed-machine:subscribe",
    input: RendererMachineAddressSchema,
    output: MachineSnapshotEnvelopeSchema,
  }),
  dispatch: defineContract({
    channel: "distributed-machine:dispatch",
    input: RendererMachineDispatchEnvelopeSchema,
    output: MachineDispatchReceiptSchema,
  }),
  unsubscribe: defineContract({
    channel: "distributed-machine:unsubscribe",
    input: RendererMachineAddressSchema,
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
