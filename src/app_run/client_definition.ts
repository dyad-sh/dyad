import { REMOTE_MACHINE_PROTOCOL_VERSION } from "@/distributed_machines/remote_protocol";
import type { RemoteClientDefinition } from "@/distributed_machines/remote_client";
import type { AppRunIgnoreReason } from "./state";
import {
  AppRunIntentEventSchema,
  AppRunKeySchema,
  AppRunRemoteSnapshotSchema,
  projectAppRunRemoteSnapshot,
  type AppRunIntentEvent,
  type AppRunKey,
  type AppRunRemoteSnapshot,
} from "./transport";
import { appRunRemoteIntentContract } from "./remote_intent_contract";

export const appRunClientDefinition = {
  id: "app_run",
  host: "main",
  remote: {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    keyCodec: AppRunKeySchema,
    encodeKey: (key) => key,
    eventCodec: AppRunIntentEventSchema,
    snapshotCodec: AppRunRemoteSnapshotSchema,
    keyToString: (key) => String(key.appId),
    unavailableSnapshot: (key) =>
      projectAppRunRemoteSnapshot(key.appId, 0, { type: "idle" }),
  },
  remoteIntent: {
    keyCodec: AppRunKeySchema,
    encodeKey: (key: AppRunKey) => key,
    keyToString: (key: AppRunKey) => String(key.appId),
    rendererIntentCodec: AppRunIntentEventSchema,
    snapshotCodec: AppRunRemoteSnapshotSchema,
    intents: appRunRemoteIntentContract.intents,
  },
} satisfies RemoteClientDefinition<
  AppRunKey,
  AppRunRemoteSnapshot,
  AppRunIntentEvent,
  AppRunIgnoreReason
>;
