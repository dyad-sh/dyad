import { appRunDefinition } from "@/app_run/definition";
import { ActorHost } from "@/distributed_machines/actor_host";
import { createRemoteMachineManifest } from "@/distributed_machines/remote_manifest";
import {
  RemoteMachineTransport,
  type RemoteTransportEndpoint,
} from "@/distributed_machines/remote_transport";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { githubOpsDefinition } from "./github_ops_definition";

export const remoteMachineHost = new ActorHost({
  placement: "main",
  clock: systemClock,
  ids: uuidIdSource,
});

export const remoteMachineManifest = createRemoteMachineManifest([
  appRunDefinition,
  githubOpsDefinition,
]);

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

export type { RemoteTransportEndpoint };
