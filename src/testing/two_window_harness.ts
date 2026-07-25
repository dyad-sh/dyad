import { randomUUID } from "node:crypto";
import type { QueryKey } from "@tanstack/react-query";
import {
  adoptThenRemoveTab,
  type TransferableTab,
} from "@/window_infrastructure/tab_transfer";
import {
  QueryInvalidationBus,
  queryInvalidationChannel,
} from "@/window_infrastructure/main/query_invalidation_bus";
import {
  WindowRegistry,
  type WindowEndpoint,
} from "@/window_infrastructure/main/window_registry";
import { HighVolumeWindowInterests } from "@/window_infrastructure/main/high_volume_interests";
import { RendererQueryInvalidationConsumer } from "@/window_infrastructure/renderer_query_invalidation";
import { EntityDisposalRegistry } from "@/state_machines/entity_disposal";
import {
  EntityDisposalBus,
  entityDisposalChannel,
} from "@/window_infrastructure/main/entity_disposal_bus";
import type {
  EntityDisposalEvent,
  QueryInvalidationBatch,
  QueryInvalidationScope,
  TabInstanceId,
  WindowInterest,
  WindowSessionId,
  VisibleEntity,
} from "@/window_infrastructure/types";

interface HarnessWindow {
  endpoint: HarnessEndpoint;
  sessionId: WindowSessionId;
  consumer: RendererQueryInvalidationConsumer;
  invalidatedKeys: QueryKey[];
  mainFrame: {
    url: string;
    processId: number;
    routingId: number;
    parent: null;
  };
  entityDisposals: EntityDisposalRegistry;
}

class HarnessEndpoint implements WindowEndpoint {
  private destroyed = false;
  private readonly destroyedListeners = new Set<() => void>();
  readonly received: Array<{ channel: string; payload: unknown }> = [];
  private readonly receiveListeners = new Set<
    (channel: string, payload: unknown) => void
  >();

  constructor(
    readonly id: number,
    private readonly onSend: (channel: string, payload: unknown) => void,
  ) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, payload: unknown): void {
    if (this.destroyed) return;
    this.received.push({ channel, payload });
    this.onSend(channel, payload);
    for (const listener of this.receiveListeners) listener(channel, payload);
  }

  once(event: "destroyed", listener: () => void): this {
    if (event === "destroyed") this.destroyedListeners.add(listener);
    return this;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const listener of this.destroyedListeners) listener();
    this.destroyedListeners.clear();
    this.receiveListeners.clear();
  }

  onReceive(listener: (channel: string, payload: unknown) => void): () => void {
    this.receiveListeners.add(listener);
    return () => this.receiveListeners.delete(listener);
  }
}

export class TwoWindowHarness {
  readonly registry = new WindowRegistry();
  readonly invalidations = new QueryInvalidationBus(this.registry, 0, 8);
  readonly mainEntityDisposals = new EntityDisposalRegistry();
  readonly entityDisposals = new EntityDisposalBus(
    this.registry,
    this.mainEntityDisposals,
  );
  readonly interests = new HighVolumeWindowInterests<string>(
    this.registry,
    "test:high-volume",
    0,
  );
  private readonly windows = new Map<WindowSessionId, HarnessWindow>();
  private nextWebContentsId = 1;

  createTrustedRendererWindow(
    sessionId = randomUUID() as WindowSessionId,
  ): WindowSessionId {
    const invalidatedKeys: QueryKey[] = [];
    const entityDisposals = new EntityDisposalRegistry();
    let consumer!: RendererQueryInvalidationConsumer;
    const endpoint = new HarnessEndpoint(
      this.nextWebContentsId++,
      (channel, payload) => {
        if (channel === queryInvalidationChannel()) {
          consumer.consume(payload as QueryInvalidationBatch);
        } else if (channel === entityDisposalChannel()) {
          const event = payload as EntityDisposalEvent;
          if (event.entity.kind === "app") {
            entityDisposals.disposeForApp(event.entity.id);
          } else {
            entityDisposals.disposeForChat(event.entity.id);
          }
        }
      },
    );
    const mainFrame = {
      url: "http://localhost:5173/chat",
      processId: endpoint.id,
      routingId: 1,
      parent: null,
    } as const;
    consumer = new RendererQueryInvalidationConsumer(
      {
        invalidateQueries: (filters) => {
          invalidatedKeys.push(filters?.queryKey ?? []);
          return Promise.resolve();
        },
      },
      sessionId,
    );
    this.registry.register(endpoint, sessionId);
    this.windows.set(sessionId, {
      endpoint,
      sessionId,
      consumer,
      invalidatedKeys,
      mainFrame,
      entityDisposals,
    });
    return sessionId;
  }

  createPair(): readonly [WindowSessionId, WindowSessionId] {
    return [
      this.createTrustedRendererWindow(),
      this.createTrustedRendererWindow(),
    ];
  }

  reload(sessionId: WindowSessionId): void {
    const previous = this.requireWindow(sessionId);
    const lastSeenEpoch = previous.consumer.epoch();
    previous.endpoint.destroy();
    this.createTrustedRendererWindow(sessionId);
    const replacement = this.requireWindow(sessionId);
    const synchronization = this.invalidations.synchronize(lastSeenEpoch);
    replacement.consumer.recover(
      synchronization.currentEpoch,
      synchronization.invalidations,
      synchronization.recoveryScopes,
    );
  }

  destroy(sessionId: WindowSessionId): void {
    this.requireWindow(sessionId).endpoint.destroy();
    this.windows.delete(sessionId);
  }

  dispatchInvalidation(
    originSessionId: WindowSessionId,
    scopes: readonly QueryInvalidationScope[],
  ): void {
    const origin = this.requireWindow(originSessionId);
    this.invalidations.publish(scopes, {
      originWebContentsId: origin.endpoint.id,
    });
    this.invalidations.flush();
  }

  invalidatedKeys(sessionId: WindowSessionId): readonly QueryKey[] {
    return this.requireWindow(sessionId).invalidatedKeys;
  }

  webContentsId(sessionId: WindowSessionId): number {
    return this.requireWindow(sessionId).endpoint.id;
  }

  endpoint(sessionId: WindowSessionId): WindowEndpoint {
    return this.requireWindow(sessionId).endpoint;
  }

  onReceive(
    sessionId: WindowSessionId,
    listener: (channel: string, payload: unknown) => void,
  ): () => void {
    return this.requireWindow(sessionId).endpoint.onReceive(listener);
  }

  async subscribe(
    sessionId: WindowSessionId,
    interest: WindowInterest,
    bootstrap: () => readonly string[] | Promise<readonly string[]>,
  ): Promise<void> {
    await this.interests.attach(
      this.webContentsId(sessionId),
      interest,
      bootstrap,
    );
  }

  received(sessionId: WindowSessionId, channel: string): readonly unknown[] {
    return this.requireWindow(sessionId)
      .endpoint.received.filter((entry) => entry.channel === channel)
      .map((entry) => entry.payload);
  }

  inspectSubscriptions(sessionId: WindowSessionId): readonly string[] {
    return this.interests.inspect(this.webContentsId(sessionId));
  }

  setVisibleEntities(
    sessionId: WindowSessionId,
    entities: readonly VisibleEntity[],
  ): void {
    this.registry.setVisibleEntities(sessionId, entities);
  }

  windowEntityDisposals(sessionId: WindowSessionId): EntityDisposalRegistry {
    return this.requireWindow(sessionId).entityDisposals;
  }

  deleteEntity(originSessionId: WindowSessionId, entity: VisibleEntity): void {
    this.requireWindow(originSessionId);
    this.entityDisposals.publish(entity);
  }

  trustedInvokeEvent(
    senderSessionId: WindowSessionId,
    frameSessionId: WindowSessionId = senderSessionId,
  ) {
    const sender = this.requireWindow(senderSessionId);
    const frame = this.requireWindow(frameSessionId).mainFrame;
    return {
      sender: {
        ...sender.endpoint,
        mainFrame: sender.mainFrame,
      },
      senderFrame: frame,
    };
  }

  async transferTab<TState>(
    tab: TransferableTab<TState>,
    destinationWindowSessionId: WindowSessionId,
    adopt: (
      tab: TransferableTab<TState> & {
        ownerWindowSessionId: WindowSessionId;
      },
    ) => Promise<{ accepted: boolean; reason?: string }>,
    removeSource: (tabInstanceId: TabInstanceId) => Promise<void> | void,
  ) {
    this.requireWindow(tab.ownerWindowSessionId);
    this.requireWindow(destinationWindowSessionId);
    return adoptThenRemoveTab(
      tab,
      destinationWindowSessionId,
      adopt,
      removeSource,
    );
  }

  tab(
    ownerWindowSessionId: WindowSessionId,
    state: string,
  ): TransferableTab<string> {
    return {
      tabInstanceId: randomUUID() as TabInstanceId,
      ownerWindowSessionId,
      state,
    };
  }

  private requireWindow(sessionId: WindowSessionId): HarnessWindow {
    const window = this.windows.get(sessionId);
    if (!window) throw new Error(`Unknown harness window ${sessionId}`);
    return window;
  }
}
