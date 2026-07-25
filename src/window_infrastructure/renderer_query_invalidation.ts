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
    private readonly queryClient: Pick<QueryClient, "invalidateQueries">,
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
    if (invalidation.originWindowSessionId === this.sessionId) return;
    this.invalidateScopes(invalidation.scopes);
  }

  private invalidateScopes(scopes: readonly QueryInvalidationScope[]): void {
    const unique = new Map<string, QueryInvalidationScope>();
    for (const scope of scopes) {
      unique.set(queryInvalidationScopeKey(scope), scope);
    }
    for (const scope of unique.values()) {
      for (const queryKey of queryKeysForInvalidationScope(scope)) {
        void this.queryClient.invalidateQueries({ queryKey });
      }
    }
  }
}
