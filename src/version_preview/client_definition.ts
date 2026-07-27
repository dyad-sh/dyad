import type { RemoteClientDefinition } from "@/distributed_machines/remote_client";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import { CLOSED_STATE } from "./state";
import {
  VERSION_PREVIEW_MACHINE_ID,
  VersionPreviewIntentEventSchema,
  VersionPreviewKeySchema,
  VersionPreviewRemoteSnapshotSchema,
  projectVersionPreviewRemoteSnapshot,
  type VersionPreviewActorState,
  type VersionPreviewIntentEvent,
  type VersionPreviewKey,
  type VersionPreviewRemoteSnapshot,
} from "./transport";

const unavailableState: VersionPreviewActorState = {
  state: CLOSED_STATE,
  activeInvocationRef: null,
  lastSettlement: null,
};

export const versionPreviewClientDefinition = {
  id: VERSION_PREVIEW_MACHINE_ID,
  host: "main",
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: VersionPreviewKeySchema,
    encodeKey: (key) => key,
    eventCodec: VersionPreviewIntentEventSchema,
    snapshotCodec: VersionPreviewRemoteSnapshotSchema,
    keyToString: (key) => String(key.appId),
    unavailableSnapshot: (key) =>
      projectVersionPreviewRemoteSnapshot(key.appId, 0, unavailableState),
  },
} satisfies RemoteClientDefinition<
  VersionPreviewKey,
  VersionPreviewRemoteSnapshot,
  VersionPreviewIntentEvent,
  import("./transition").PreviewIgnoreReason | "stale-operation"
>;
