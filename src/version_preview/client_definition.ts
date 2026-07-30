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
import { versionPreviewRemoteIntentContract } from "./remote_intent_contract";

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
  remoteIntent: {
    keyCodec: VersionPreviewKeySchema,
    encodeKey: (key: VersionPreviewKey) => key,
    keyToString: (key: VersionPreviewKey) => String(key.appId),
    rendererIntentCodec: VersionPreviewIntentEventSchema,
    snapshotCodec: VersionPreviewRemoteSnapshotSchema,
    operationOutcome: versionPreviewRemoteIntentContract.operationOutcome,
    intents: versionPreviewRemoteIntentContract.intents,
  },
} satisfies RemoteClientDefinition<
  VersionPreviewKey,
  VersionPreviewRemoteSnapshot,
  VersionPreviewIntentEvent,
  import("./transition").PreviewIgnoreReason | "stale-operation"
>;
