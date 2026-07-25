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
    async (event, input) =>
      transport.subscribe(event.sender as RemoteTransportEndpoint, input),
  );
  createTypedHandler(
    distributedMachineContracts.dispatch,
    async (event, input) =>
      transport.dispatch(event.sender as RemoteTransportEndpoint, input),
  );
  createTypedHandler(
    distributedMachineContracts.unsubscribe,
    async (event, input) => {
      await transport.unsubscribe(
        event.sender as RemoteTransportEndpoint,
        input,
      );
    },
  );
}
