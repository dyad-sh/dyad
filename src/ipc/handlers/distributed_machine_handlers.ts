import type { RemoteMachineTransport } from "@/distributed_machines/remote_transport";
import {
  remoteMachineTransport,
  type RemoteTransportEndpoint,
} from "../services/distributed_machine_host";
import { distributedMachineContracts } from "../types/distributed_machines";
import { createTypedHandler } from "./base";

export function registerDistributedMachineHandlers(
  transport: RemoteMachineTransport = remoteMachineTransport,
): void {
  createTypedHandler(
    distributedMachineContracts.subscribe,
    async (event, { rendererConnectionId, ...input }) =>
      transport.subscribe(
        event.sender as RemoteTransportEndpoint,
        input,
        rendererConnectionId,
      ),
  );
  createTypedHandler(
    distributedMachineContracts.dispatch,
    async (event, { rendererConnectionId, ...input }) =>
      transport.dispatch(
        event.sender as RemoteTransportEndpoint,
        input,
        rendererConnectionId,
      ),
  );
  createTypedHandler(
    distributedMachineContracts.unsubscribe,
    async (event, { rendererConnectionId, ...input }) => {
      await transport.unsubscribe(
        event.sender as RemoteTransportEndpoint,
        input,
        rendererConnectionId,
      );
    },
  );
}
