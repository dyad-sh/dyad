import { appRunDefinition } from "@/app_run/definition";
import { chatStreamDefinition } from "@/chat_stream/definition";
import { planHandoffDefinition } from "@/plan_handoff/definition";
import { createRemoteMachineManifest } from "@/distributed_machines/remote_manifest";
import {
  RemoteMachineTransport,
  type RemoteTransportEndpoint,
} from "@/distributed_machines/remote_transport";
import { systemClock } from "@/state_machines/clock";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { remoteMachineHost } from "./distributed_machine_actor_host";
import { githubOpsDefinition } from "./github_ops_definition";
import { imageGenerationDefinition } from "./image_generation_definition";
import { versionPreviewDefinition } from "./version_preview_definition";

export { remoteMachineHost };

export const remoteMachineManifest = createRemoteMachineManifest([
  appRunDefinition,
  chatStreamDefinition,
  githubOpsDefinition,
  imageGenerationDefinition,
  planHandoffDefinition,
  versionPreviewDefinition,
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
