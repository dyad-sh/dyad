import { RemoteMachineClient } from "@/distributed_machines/remote_client";
import type { RemoteMachineClientConnection } from "@/distributed_machines/remote_client";
import { IpcRemoteMachineConnection } from "@/distributed_machines/ipc_connection";
import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import {
  planHandoffClientDefinition,
  planHandoffKey,
  type PlanHandoffIntent,
  type PlanHandoffRemoteSnapshot,
} from "./transport";

export type PlanHandoffRemoteConnection = RemoteMachineClientConnection & {
  start?: () => () => void;
};

interface LocalFailure {
  readonly message: string;
  readonly source: "bootstrap" | "accept";
  base?: PlanHandoffRemoteSnapshot;
  projected?: PlanHandoffRemoteSnapshot;
}

export class PlanHandoffRemoteManager {
  private readonly client: RemoteMachineClient;
  private readonly listeners = new Map<number, Set<() => void>>();
  private readonly localFailures = new Map<number, LocalFailure>();
  private stopConnection?: () => void;
  private disposed = false;

  constructor(
    private readonly ids: IdSource = uuidIdSource,
    private readonly connection: PlanHandoffRemoteConnection = new IpcRemoteMachineConnection(),
  ) {
    this.client = new RemoteMachineClient(connection, ids);
  }

  start(): void {
    if (this.disposed || this.stopConnection) return;
    this.stopConnection = this.connection.start?.() ?? (() => undefined);
    this.client.start();
  }

  stop(): void {
    this.client.stop();
    this.stopConnection?.();
    this.stopConnection = undefined;
  }

  getSnapshot = (sourceChatId: number): PlanHandoffRemoteSnapshot => {
    const snapshot = this.actor(sourceChatId).getSnapshot();
    const failure = this.localFailures.get(sourceChatId);
    if (!failure) return snapshot;
    if (failure.base === snapshot && failure.projected) {
      return failure.projected;
    }
    failure.base = snapshot;
    failure.projected = {
      ...snapshot,
      phase: "failed",
      failure: failure.message,
    };
    return failure.projected;
  };

  subscribeKey = (sourceChatId: number, listener: () => void): (() => void) => {
    this.start();
    const actor = this.actor(sourceChatId);
    const listeners = this.listeners.get(sourceChatId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sourceChatId, listeners);
    const unsubscribe = actor.subscribe(() => {
      if (actor.getStatus() === "ready") {
        this.clearLocalFailure(sourceChatId, "bootstrap", false);
      }
      listener();
    });
    void actor
      .resync()
      .then(() => this.clearLocalFailure(sourceChatId, "bootstrap"))
      .catch((error) => {
        console.error("[plan-handoff] Remote bootstrap failed", error);
        this.setLocalFailure(sourceChatId, error, "bootstrap");
      });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sourceChatId);
      // Give StrictMode effect replay and immediate remounts a chance to
      // retain the actor before releasing the old local reference. The remote
      // client then keeps its single main-side subscription alive.
      queueMicrotask(unsubscribe);
    };
  };

  async accept(
    input: Omit<
      PlanHandoffIntent,
      "schemaVersion" | "handoffId" | "planId" | "planVersion" | "planHash"
    > & {
      planHash: string;
    },
  ): Promise<string> {
    this.start();
    this.localFailures.delete(input.sourceChatId);
    this.notify(input.sourceChatId);
    const handoffId = this.ids.next("plan-handoff");
    const intent: PlanHandoffIntent = {
      ...input,
      schemaVersion: 1,
      handoffId,
      planId: `chat-${input.sourceChatId}`,
      planVersion: input.planHash,
    };
    const actor = this.actor(input.sourceChatId);
    const release = actor.subscribe(() => undefined);
    try {
      await actor.resync();
      const receipt = await actor.dispatch({ type: "ACCEPT", intent });
      if (receipt.kind === "rejected") {
        throw new Error(`Plan handoff rejected: ${receipt.reason}`);
      }
      if (receipt.kind === "ignored") {
        throw new Error(`Plan handoff ignored: ${receipt.reason}`);
      }
      return handoffId;
    } catch (error) {
      try {
        await actor.resync();
        if (actor.getSnapshot().handoffId === handoffId) {
          return handoffId;
        }
      } catch {
        // Preserve the original acceptance error below.
      }
      this.setLocalFailure(input.sourceChatId, error, "accept");
      throw error;
    } finally {
      release();
    }
  }

  disposeKey = (sourceChatId: number): void => {
    void sourceChatId;
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.client.dispose();
    this.listeners.clear();
    this.localFailures.clear();
  }

  private setLocalFailure(
    sourceChatId: number,
    error: unknown,
    source: LocalFailure["source"],
  ): void {
    this.localFailures.set(sourceChatId, {
      message: error instanceof Error ? error.message : String(error),
      source,
    });
    this.notify(sourceChatId);
  }

  private clearLocalFailure(
    sourceChatId: number,
    source?: LocalFailure["source"],
    notify = true,
  ): void {
    const failure = this.localFailures.get(sourceChatId);
    if (!failure || (source && failure.source !== source)) return;
    this.localFailures.delete(sourceChatId);
    if (notify) this.notify(sourceChatId);
  }

  private notify(sourceChatId: number): void {
    for (const listener of this.listeners.get(sourceChatId) ?? []) listener();
  }

  private actor(sourceChatId: number) {
    return this.client.actor(
      planHandoffClientDefinition,
      planHandoffKey(sourceChatId),
    );
  }
}
