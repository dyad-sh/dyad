import { ActorHost } from "@/distributed_machines/actor_host";
import { createRemoteMachineManifest } from "@/distributed_machines/remote_manifest";
import {
  RemoteMachineTransport,
  type RemoteTransportEndpoint,
} from "@/distributed_machines/remote_transport";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { distributedMachineContracts } from "../types/distributed_machines";
import { createTypedHandler } from "./base";

const remoteMachineHost = new ActorHost({
  placement: "main",
  clock: systemClock,
  ids: uuidIdSource,
});

// B3 deliberately ships no production-addressable machine definitions. The
// synthetic definition used by conformance tests is injected into a test
// transport instance.
const remoteMachineManifest = createRemoteMachineManifest([]);

export const remoteMachineTransport = new RemoteMachineTransport({
  host: remoteMachineHost,
  manifest: remoteMachineManifest,
  windows: windowRegistry,
  clock: systemClock,
  onProtocolMismatch: ({ sender, machineId, expected, received }) => {
    if (!sender.windowSessionId) return;
    const endpoint = windowRegistry.endpointForSession(
      sender.windowSessionId as WindowSessionId,
    );
    if (!endpoint || endpoint.isDestroyed()) return;
    endpoint.send("distributed-machine:protocol-mismatch", {
      machineId,
      expectedProtocolVersion: expected,
      receivedProtocolVersion: received,
    });
  },
});

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
