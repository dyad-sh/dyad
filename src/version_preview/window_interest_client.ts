import type {
  RemoteMachineClient,
  RemoteSubscriptionLease,
} from "@/distributed_machines/remote_client";
import type { PreparedRequestScope } from "@/distributed_machines/prepared_request";
import { dispatchRemoteAdmissionOnly } from "@/distributed_machines/request_actor";
import { versionPreviewClientDefinition } from "./client_definition";
import { versionPreviewKey, type VersionPreviewIntentEvent } from "./transport";
import {
  createVersionPreviewRequestActor,
  observeVersionPreviewAdmission,
} from "./request_actor";
import type { VersionPreviewCancellationReason } from "./operations";

interface OwnedInterest {
  readonly lease: RemoteSubscriptionLease;
  admitted: boolean;
}

export class VersionPreviewReleaseCancelledError extends Error {
  constructor(readonly reason: VersionPreviewCancellationReason) {
    super(`Version preview release was cancelled: ${reason}`);
    this.name = "VersionPreviewReleaseCancelledError";
  }
}

/**
 * One explicit framework subscription lease owns each app's pane interest for
 * this renderer window. Bootstrap, reconnect, and release all reuse the same
 * generation-bearing lease; stale releases therefore cannot retire a
 * replacement generation.
 */
export class VersionPreviewWindowInterestClient {
  private readonly interests = new Map<number, OwnedInterest>();
  private readonly tails = new Map<number, Promise<void>>();
  private readonly selectionEpochs = new Map<number, number>();
  private disposed = false;

  constructor(
    private readonly remote: RemoteMachineClient,
    private readonly scope: PreparedRequestScope,
  ) {}

  acquire(appId: number): Promise<{ acquired: boolean }> {
    return this.acquireWithIntent(appId, "ACQUIRE_WINDOW_INTEREST");
  }

  restoreIfOrphaned(appId: number): Promise<{ acquired: boolean }> {
    return this.acquireWithIntent(appId, "RESTORE_WINDOW_INTEREST");
  }

  release(
    appId: number,
    operationId: string,
    exit: { type: "close" } | { type: "switch-app"; nextAppId: number | null },
  ): Promise<{ cleanupStarted: boolean }> {
    this.selectionEpochs.set(appId, this.selectionEpoch(appId) + 1);
    return this.enqueue(appId, async () => {
      const actor = this.actor(appId);
      const view = actor.getView();
      const request = createVersionPreviewRequestActor(
        this.remote,
        this.scope,
        appId,
      ).request({
        intent:
          exit.type === "close"
            ? { type: "CLOSE", operationId }
            : {
                type: "APP_CHANGED",
                nextAppId: exit.nextAppId,
                operationId,
              },
        observed:
          view.snapshot.kind === "available"
            ? view.snapshot.observedRevision
            : undefined,
      });
      await observeVersionPreviewAdmission(request, () => undefined);
      const settlement = await request.settled;
      if (settlement.kind === "not-admitted") {
        throw new Error(
          `Version preview release was refused: ${settlement.refusal ?? settlement.reason}`,
        );
      }
      if (settlement.kind === "detached") {
        throw new Error("Version preview release detached before settlement");
      }
      const owned = this.interests.get(appId);
      if (owned) {
        this.interests.delete(appId);
        owned.lease.release();
      }
      if (settlement.outcome.kind === "failed") {
        throw new Error(settlement.outcome.error.message);
      }
      if (settlement.outcome.kind === "cancelled") {
        throw new VersionPreviewReleaseCancelledError(
          settlement.outcome.reason,
        );
      }
      return {
        cleanupStarted: settlement.outcome.cleanupStarted === true,
      };
    });
  }

  selectionEpoch(appId: number): number {
    return this.selectionEpochs.get(appId) ?? 0;
  }

  isSelectionEpochCurrent(appId: number, epoch: number): boolean {
    return this.selectionEpoch(appId) === epoch;
  }

  inspectLeaseCount(): number {
    return this.interests.size;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const releases: Promise<void>[] = [];
    for (const [appId, interest] of this.interests) {
      if (!interest.admitted) {
        this.interests.delete(appId);
        interest.lease.release();
        continue;
      }
      const operationId = `version-preview:dispose:${appId}:${globalThis.crypto.randomUUID()}`;
      releases.push(
        this.enqueue(appId, async () => {
          if (this.interests.get(appId) !== interest) return;
          const receipt = await dispatchRemoteAdmissionOnly(this.actor(appId), {
            type: "RELEASE_WINDOW_INTEREST",
            operationId,
          });
          if (receipt.kind === "rejected") {
            throw new Error(
              `Window interest release was refused: ${receipt.reason}`,
            );
          }
          if (this.interests.get(appId) === interest) {
            this.interests.delete(appId);
            interest.lease.release();
          }
        }).catch(() => {
          if (this.interests.get(appId) === interest) {
            this.interests.delete(appId);
            interest.lease.release();
          }
        }),
      );
    }
    await Promise.all(releases);
  }

  private acquireWithIntent(
    appId: number,
    type: "ACQUIRE_WINDOW_INTEREST" | "RESTORE_WINDOW_INTEREST",
  ): Promise<{ acquired: boolean }> {
    return this.enqueue(appId, async () => {
      if (this.disposed) throw new Error("Window interest client is disposed");
      let owned = this.interests.get(appId);
      const fresh = !owned;
      if (!owned) {
        owned = { lease: this.actor(appId).retain(), admitted: false };
        this.interests.set(appId, owned);
      }
      try {
        if (fresh) await owned.lease.ready;
        else await owned.lease.refresh();
        if (this.disposed || this.interests.get(appId) !== owned) {
          if (this.interests.get(appId) === owned) {
            this.interests.delete(appId);
            owned.lease.release();
          }
          throw new Error("Window interest client is disposed");
        }
        if (owned.admitted) return { acquired: false };
        const intent: VersionPreviewIntentEvent = {
          type,
          operationId: `version-preview:interest:${globalThis.crypto.randomUUID()}`,
        };
        const receipt = await dispatchRemoteAdmissionOnly(
          this.actor(appId),
          intent,
        );
        if (receipt.kind === "rejected") {
          throw new Error(`Window interest was refused: ${receipt.reason}`);
        }
        if (
          receipt.kind === "ignored" &&
          receipt.reason === "interest-owned-by-another-window"
        ) {
          this.interests.delete(appId);
          owned.lease.release();
          return { acquired: false };
        }
        owned.admitted = true;
        return {
          acquired:
            receipt.kind === "applied" ||
            receipt.reason === "interest-already-owned",
        };
      } catch (error) {
        if (fresh && this.interests.get(appId) === owned) {
          this.interests.delete(appId);
          owned.lease.release();
        }
        throw error;
      }
    });
  }

  private actor(appId: number) {
    return this.remote.actor(
      versionPreviewClientDefinition,
      versionPreviewKey(appId),
    );
  }

  private enqueue<Result>(
    appId: number,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.tails.get(appId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(appId, tail);
    void tail.finally(() => {
      if (this.tails.get(appId) === tail) this.tails.delete(appId);
    });
    return result;
  }
}
