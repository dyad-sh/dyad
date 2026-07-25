import type {
  QueryInvalidationBatch,
  QueryInvalidationEvent,
  QueryInvalidationScope,
} from "../types";
import { queryInvalidationScopeKey } from "../types";
import {
  windowRegistry,
  type WindowEndpoint,
  type WindowRegistry,
} from "./window_registry";

const QUERY_INVALIDATION_CHANNEL = "window:query-invalidations";

export interface PublishInvalidationOptions {
  originWebContentsId?: number;
  originEndpoint?: WindowEndpoint;
}

export class QueryInvalidationBus {
  private epoch = 0;
  private readonly journal: QueryInvalidationEvent[] = [];
  private readonly recoveryScopes = new Map<string, QueryInvalidationScope>();
  private readonly pending: QueryInvalidationEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly registry: WindowRegistry,
    private readonly flushDelayMs = 0,
    private readonly journalLimit = 256,
  ) {}

  publish(
    scopes: readonly QueryInvalidationScope[],
    options: PublishInvalidationOptions = {},
  ): number {
    if (scopes.length === 0) return this.epoch;
    const originWindowSessionId = options.originEndpoint
      ? this.registry.ensureRegistered(options.originEndpoint)
      : options.originWebContentsId === undefined
        ? undefined
        : this.registry.sessionForWebContents(options.originWebContentsId);
    const event: QueryInvalidationEvent = {
      epoch: ++this.epoch,
      scopes: this.dedupeScopes(scopes),
      originWindowSessionId,
    };
    this.journal.push(event);
    if (this.journal.length > this.journalLimit) this.journal.shift();
    for (const scope of event.scopes) {
      const recoveryScope = this.compactRecoveryScope(scope);
      this.recoveryScopes.set(
        queryInvalidationScopeKey(recoveryScope),
        recoveryScope,
      );
    }
    this.pending.push(event);
    this.flushTimer ??= setTimeout(() => this.flush(), this.flushDelayMs);
    return event.epoch;
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (this.pending.length === 0) return;
    const payload: QueryInvalidationBatch = {
      invalidations: this.pending.splice(0),
      recoveryScopes: [...this.recoveryScopes.values()],
    };
    for (const endpoint of this.registry.liveEndpoints()) {
      endpoint.send(QUERY_INVALIDATION_CHANNEL, payload);
    }
  }

  synchronize(lastSeenEpoch?: number): {
    currentEpoch: number;
    invalidations: QueryInvalidationEvent[];
    recoveryScopes: QueryInvalidationScope[];
  } {
    if (lastSeenEpoch === undefined || lastSeenEpoch === this.epoch) {
      return {
        currentEpoch: this.epoch,
        invalidations: [],
        recoveryScopes: [],
      };
    }
    const firstJournalEpoch = this.journal[0]?.epoch ?? this.epoch + 1;
    if (lastSeenEpoch < firstJournalEpoch - 1 || lastSeenEpoch > this.epoch) {
      return {
        currentEpoch: this.epoch,
        invalidations: [],
        recoveryScopes: [...this.recoveryScopes.values()],
      };
    }
    return {
      currentEpoch: this.epoch,
      invalidations: this.journal.filter(
        (event) => event.epoch > lastSeenEpoch,
      ),
      recoveryScopes: [],
    };
  }

  currentEpoch(): number {
    return this.epoch;
  }

  private dedupeScopes(
    scopes: readonly QueryInvalidationScope[],
  ): QueryInvalidationScope[] {
    return [
      ...new Map(
        scopes.map((scope) => [queryInvalidationScopeKey(scope), scope]),
      ).values(),
    ];
  }

  private compactRecoveryScope(
    scope: QueryInvalidationScope,
  ): QueryInvalidationScope {
    switch (scope.family) {
      case "app":
        return { family: "apps" };
      case "chat":
        return { family: "chats" };
      case "versions":
      case "branches":
      case "problems":
        return { family: scope.family };
      default:
        return scope;
    }
  }
}

export const queryInvalidationBus = new QueryInvalidationBus(windowRegistry);

export function queryInvalidationChannel(): string {
  return QUERY_INVALIDATION_CHANNEL;
}
