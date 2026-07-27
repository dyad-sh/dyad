import { versionPreviewKey } from "@/version_preview/transport";
import type {
  VersionPreviewActorState,
  VersionPreviewWireEvent,
} from "@/version_preview/transport";
import type { HostedActorRef } from "@/distributed_machines/definition";
import { remoteMachineHost } from "./distributed_machine_host";
import { versionPreviewDefinition } from "./version_preview_definition";
import { versionPreviewService } from "./version_preview_service";
import { versionPreviewPersistence } from "./version_preview_persistence";

type Host = Pick<
  typeof remoteMachineHost,
  "peek" | "disposeKey" | "disposeMachine"
>;

export class VersionPreviewActorService {
  constructor(private readonly host: Host = remoteMachineHost) {}

  beginAppDeletion(appId: number): void {
    versionPreviewService.beginAppDeletion(appId);
  }

  endAppDeletion(appId: number): void {
    versionPreviewService.endAppDeletion(appId);
  }

  async prepareAppDeletion(appId: number): Promise<void> {
    const actor = this.host.peek(
      versionPreviewDefinition.id,
      versionPreviewKey(appId),
    ) as
      | HostedActorRef<
          VersionPreviewActorState,
          VersionPreviewWireEvent,
          | import("@/version_preview/transition").PreviewIgnoreReason
          | "stale-operation"
        >
      | undefined;
    const state = actor?.getSnapshot().state;
    if (
      actor &&
      state &&
      state.type !== "closed" &&
      state.type !== "returning" &&
      state.type !== "switching-branch"
    ) {
      const operationId = `version-preview:delete:${appId}`;
      actor.send(
        state.type === "recovery-required"
          ? { type: "RETRY_RETURN", operationId }
          : { type: "CLOSE", operationId },
      );
    }
    await versionPreviewService.settle(appId);
  }

  async disposeApp(appId: number): Promise<void> {
    try {
      await this.host.disposeKey(
        versionPreviewDefinition.id,
        versionPreviewKey(appId),
        "entity-deletion",
      );
    } finally {
      versionPreviewPersistence.remove(appId);
    }
  }

  async disposeAllApps(): Promise<void> {
    try {
      await this.host.disposeMachine(versionPreviewDefinition.id);
    } finally {
      versionPreviewPersistence.removeAll();
    }
  }
}

export const versionPreviewActorService = new VersionPreviewActorService();
