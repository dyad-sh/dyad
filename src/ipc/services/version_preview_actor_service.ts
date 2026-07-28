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
import { versionPreviewPresentationService } from "./version_preview_presentation_service";
import { versionPreviewWindowInterestService } from "./version_preview_window_interest";

type Host = Pick<
  typeof remoteMachineHost,
  "ensure" | "peek" | "disposeKey" | "disposeMachine"
>;

export class VersionPreviewActorService {
  constructor(
    private readonly host: Host = remoteMachineHost,
    private readonly windowInterests = versionPreviewWindowInterestService,
    private readonly presentation = versionPreviewPresentationService,
  ) {}

  acquireWindowInterest(appId: number, webContentsId: number): boolean {
    return this.windowInterests.acquire(appId, webContentsId);
  }

  restoreWindowInterest(appId: number, webContentsId: number): boolean {
    return this.windowInterests.acquireIfUnowned(appId, webContentsId);
  }

  releaseWindowInterest({
    appId,
    webContentsId,
    windowSessionId,
    operationId,
    exit,
  }: {
    appId: number;
    webContentsId: number;
    windowSessionId: string | undefined;
    operationId: string;
    exit: { type: "close" } | { type: "switch-app"; nextAppId: number | null };
  }): boolean {
    let actor = this.actor(appId);
    if (this.windowInterests.isLastOwner(appId, webContentsId)) {
      // Create/hydrate the actor before relinquishing the final interest.
      // Subscription admission can otherwise create persisted preview state
      // immediately after a release that observed no actor.
      actor = this.host.ensure(
        versionPreviewDefinition,
        versionPreviewKey(appId),
      );
      // Reserve routing before relinquishing the final interest. A capacity
      // rejection must leave the pane's ownership intact so the user can retry.
      this.presentation.recordInitiator(operationId, windowSessionId);
    }
    if (
      this.windowInterests.release(appId, webContentsId) !==
      "last-owner-released"
    ) {
      return false;
    }
    const state = actor?.getSnapshot().state;
    if (
      !actor ||
      !state ||
      state.type === "closed" ||
      state.type === "returning" ||
      state.type === "switching-branch"
    ) {
      return false;
    }
    actor.send(
      exit.type === "close"
        ? { type: "CLOSE", operationId }
        : {
            type: "APP_CHANGED",
            nextAppId: exit.nextAppId,
            operationId,
          },
    );
    return true;
  }

  beginAppDeletion(appId: number): void {
    versionPreviewService.beginAppDeletion(appId);
  }

  endAppDeletion(appId: number): void {
    versionPreviewService.endAppDeletion(appId);
  }

  async prepareAppDeletion(appId: number): Promise<void> {
    const actor = this.actor(appId);
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
      this.windowInterests.clearApp(appId);
    }
  }

  async disposeAllApps(): Promise<void> {
    try {
      await this.host.disposeMachine(versionPreviewDefinition.id);
    } finally {
      versionPreviewPersistence.removeAll();
      this.windowInterests.clearAll();
    }
  }

  private actor(appId: number) {
    return this.host.peek(
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
  }
}

export const versionPreviewActorService = new VersionPreviewActorService();
