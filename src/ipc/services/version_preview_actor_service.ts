import type { ActorMachineFenceHandle } from "@/distributed_machines/actor_host";
import type { HostedActorRef } from "@/distributed_machines/definition";
import type { FenceHandle } from "@/distributed_machines/keyed_admission_gate";
import { versionPreviewOperationRegistry } from "@/version_preview/operations";
import {
  versionPreviewKey,
  type VersionPreviewActorEvent,
  type VersionPreviewActorState,
} from "@/version_preview/transport";
import { remoteMachineHost } from "./distributed_machine_host";
import { versionPreviewDefinition } from "./version_preview_definition";
import { versionPreviewPersistence } from "./version_preview_persistence";
import { versionPreviewPresentationService } from "./version_preview_presentation_service";

type Host = Pick<
  typeof remoteMachineHost,
  | "ensure"
  | "peek"
  | "disposeKey"
  | "disposeMachine"
  | "beginFence"
  | "beginMachineFence"
>;

type VersionPreviewReason =
  | import("@/version_preview/transition").PreviewIgnoreReason
  | "stale-operation"
  | "interest-already-owned"
  | "interest-owned-by-another-window";

export interface VersionPreviewDeletionFence {
  readonly appId: number;
  readonly handle: FenceHandle<ReturnType<typeof versionPreviewKey>>;
  readonly actor:
    | HostedActorRef<
        VersionPreviewActorState,
        VersionPreviewActorEvent,
        VersionPreviewReason
      >
    | undefined;
}

function isDrainEvent(event: VersionPreviewActorEvent): boolean {
  return (
    event.type === "CLOSE" ||
    event.type === "APP_CHANGED" ||
    event.type === "RETRY_RETURN" ||
    event.type === "RELEASE_WINDOW_INTEREST" ||
    event.type === "WINDOW_INTEREST_DISPOSED" ||
    event.type === "RECONCILE_REQUESTED" ||
    event.type === "RECONCILED" ||
    !("operationId" in event)
  );
}

export class VersionPreviewActorService {
  constructor(private readonly host: Host = remoteMachineHost) {}

  async acquireWindowInterest(
    appId: number,
    windowSessionId: string,
  ): Promise<boolean> {
    const ticket = this.host
      .ensure(versionPreviewDefinition, versionPreviewKey(appId))
      .enqueue({
        type: "ACQUIRE_WINDOW_INTEREST",
        operationId: `version-preview:legacy-acquire:${appId}`,
        windowSessionId,
      });
    return (await ticket.settled).kind === "applied";
  }

  async restoreWindowInterest(
    appId: number,
    windowSessionId: string,
  ): Promise<boolean> {
    const result = await this.host
      .ensure(versionPreviewDefinition, versionPreviewKey(appId))
      .enqueue({
        type: "RESTORE_WINDOW_INTEREST",
        operationId: `version-preview:legacy-restore:${appId}`,
        windowSessionId,
      }).settled;
    return result.kind === "applied";
  }

  async releaseWindowInterest({
    appId,
    windowSessionId,
    operationId,
    exit,
  }: {
    appId: number;
    windowSessionId: string | undefined;
    operationId: string;
    exit: { type: "close" } | { type: "switch-app"; nextAppId: number | null };
  }): Promise<boolean> {
    if (!windowSessionId) return false;
    const actor = this.actor(appId);
    if (!actor) return false;
    versionPreviewPresentationService.recordInitiator(
      appId,
      operationId,
      windowSessionId,
      actor.getMetadata().actorInstanceId,
    );
    const result = await actor.enqueue(
      exit.type === "close"
        ? { type: "CLOSE", operationId, windowSessionId }
        : {
            type: "APP_CHANGED",
            nextAppId: exit.nextAppId,
            operationId,
            windowSessionId,
          },
    ).settled;
    return (
      result.kind === "applied" &&
      actor.getSnapshot().lastSettlement?.operationId === operationId &&
      actor.getSnapshot().lastSettlement?.cleanupStarted === true
    );
  }

  beginAppDeletion(appId: number): VersionPreviewDeletionFence {
    const key = versionPreviewKey(appId);
    return {
      appId,
      actor: this.actor(appId),
      handle: this.host.beginFence(versionPreviewDefinition, {
        key,
        allowDuringDrain: isDrainEvent,
      }),
    };
  }

  beginReset(): ActorMachineFenceHandle {
    return this.host.beginMachineFence(versionPreviewDefinition, {
      allowDuringDrain: isDrainEvent,
    });
  }

  async prepareAppDeletion(fence: VersionPreviewDeletionFence): Promise<void> {
    const state = fence.actor?.getSnapshot().state;
    if (
      fence.actor &&
      state &&
      state.type !== "closed" &&
      state.type !== "returning" &&
      state.type !== "switching-branch"
    ) {
      const operationId = `version-preview:delete:${fence.appId}`;
      await fence.actor.enqueue(
        state.type === "recovery-required"
          ? {
              type: "RETRY_RETURN",
              operationId,
              windowSessionId: "main-deletion",
            }
          : {
              type: "CLOSE",
              operationId,
              windowSessionId: "main-deletion",
            },
      ).settled;
    }
    await fence.handle.seal();
  }

  finishAppDeletion(
    fence: VersionPreviewDeletionFence,
    committed: boolean,
  ): void {
    if (committed) {
      if (!fence.handle.commit()) {
        throw new Error("Version-preview deletion fence is no longer current");
      }
      if (!fence.handle.release()) {
        throw new Error("Version-preview deletion fence could not be released");
      }
      return;
    }
    fence.handle.abort();
  }

  async disposeApp(appId: number): Promise<void> {
    versionPreviewOperationRegistry.settleKey(
      "main-remote-machine-host",
      versionPreviewDefinition.id,
      String(appId),
    );
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
    versionPreviewOperationRegistry.settleMachine(
      "main-remote-machine-host",
      versionPreviewDefinition.id,
    );
    try {
      await this.host.disposeMachine(versionPreviewDefinition.id);
    } finally {
      versionPreviewPersistence.removeAll();
      versionPreviewPresentationService.settleMachine();
    }
  }

  private actor(appId: number) {
    return this.host.peek(
      versionPreviewDefinition.id,
      versionPreviewKey(appId),
    ) as
      | HostedActorRef<
          VersionPreviewActorState,
          VersionPreviewActorEvent,
          VersionPreviewReason
        >
      | undefined;
  }
}

export const versionPreviewActorService = new VersionPreviewActorService();
