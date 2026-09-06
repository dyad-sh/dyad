import type { QueryClient } from "@tanstack/react-query";
import type {
  QueryInvalidationBatch,
  QueryInvalidationEvent,
  QueryInvalidationScope,
  WindowSessionId,
} from "./types";
import { queryInvalidationScopeKey } from "./types";
import { queryKeysForInvalidationScope } from "./query_keys";

export class RendererQueryInvalidationConsumer {
  private lastEpoch = 0;

  constructor(
    private readonly queryClient: Pick<
      QueryClient,
      "invalidateQueries" | "removeQueries"
    >,
    private readonly sessionId: WindowSessionId,
  ) {}

  consume(batch: QueryInvalidationBatch): void {
    for (const invalidation of batch.invalidations) {
      if (invalidation.epoch <= this.lastEpoch) continue;
      if (invalidation.epoch !== this.lastEpoch + 1 && this.lastEpoch !== 0) {
        this.invalidateScopes(batch.recoveryScopes);
      }
      this.consumeEvent(invalidation);
    }
  }

  recover(
    currentEpoch: number,
    invalidations: readonly QueryInvalidationEvent[],
    recoveryScopes: readonly QueryInvalidationScope[],
  ): void {
    if (recoveryScopes.length > 0) {
      this.invalidateScopes(recoveryScopes);
      this.lastEpoch = currentEpoch;
      return;
    }
    this.consume({ invalidations: [...invalidations], recoveryScopes: [] });
    this.lastEpoch = Math.max(this.lastEpoch, currentEpoch);
  }

  epoch(): number {
    return this.lastEpoch;
  }

  private consumeEvent(invalidation: QueryInvalidationEvent): void {
    this.lastEpoch = invalidation.epoch;
    if (invalidation.originWindowSessionId !== this.sessionId) {
      this.invalidateScopes(invalidation.scopes);
      return;
    }
    const handledScopeKeys = new Set(
      (invalidation.originHandledScopes ?? []).map(queryInvalidationScopeKey),
    );
    this.invalidateScopes(
      invalidation.scopes.filter(
        (scope) => !handledScopeKeys.has(queryInvalidationScopeKey(scope)),
      ),
    );
  }

  private invalidateScopes(scopes: readonly QueryInvalidationScope[]): void {
    const unique = new Map<string, QueryInvalidationScope>();
    for (const scope of scopes) {
      unique.set(queryInvalidationScopeKey(scope), scope);
    }
    for (const scope of unique.values()) {
      const queryKeys = queryKeysForInvalidationScope(scope);
      if (scope.family === "app-name") {
        // The app-name check and folder-preview hooks turn off every React
        // Query refetch trigger (refetchOnMount/focus/reconnect) so reopening a
        // dialog never spams the IPC. `invalidateQueries` would only mark those
        // entries stale, which `refetchOnMount: false` then serves verbatim on
        // the next dialog open even when the collision set has changed.
        // Removing the entries instead forces a fresh fetch the next time a
        // dialog mounts, while preserving the no-refetch-on-stale intent for
        // the common case where no lifecycle change actually occurred.
        for (const queryKey of queryKeys) {
          void this.queryClient.removeQueries({ queryKey });
        }
      } else {
        for (const queryKey of queryKeys) {
          void this.queryClient.invalidateQueries({ queryKey });
        }
      }
    }
  }
}
