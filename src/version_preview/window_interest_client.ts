import { ipc } from "@/ipc/types";

type VersionInterestIpc = Pick<
  typeof ipc.version,
  "acquirePreviewWindowInterest" | "releasePreviewWindowInterest"
>;

/**
 * Serializes one renderer window's acquire/release operations per app.
 * Acquisition validates the app asynchronously in main, so a rapid navigation
 * release must wait behind it instead of racing and leaving a stale owner.
 */
export class VersionPreviewWindowInterestClient {
  private readonly tails = new Map<number, Promise<void>>();
  private readonly selectionEpochs = new Map<number, number>();

  constructor(private readonly client: VersionInterestIpc = ipc.version) {}

  acquire(appId: number): Promise<void> {
    return this.enqueue(appId, () =>
      this.client.acquirePreviewWindowInterest({ appId }),
    );
  }

  release(
    appId: number,
    operationId: string,
    exit: { type: "close" } | { type: "switch-app"; nextAppId: number | null },
  ): Promise<{ cleanupStarted: boolean }> {
    this.selectionEpochs.set(appId, this.selectionEpoch(appId) + 1);
    return this.enqueue(appId, () =>
      this.client.releasePreviewWindowInterest({
        appId,
        operationId,
        exit,
      }),
    );
  }

  selectionEpoch(appId: number): number {
    return this.selectionEpochs.get(appId) ?? 0;
  }

  isSelectionEpochCurrent(appId: number, epoch: number): boolean {
    return this.selectionEpoch(appId) === epoch;
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
