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

export class PlanHandoffRemoteManager {
  private readonly client: RemoteMachineClient;
  private readonly listeners = new Map<number, Set<() => void>>();
  private readonly localFailures = new Map<number, string>();
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
    return failure
      ? {
          ...snapshot,
          phase: "failed",
          failure,
        }
      : snapshot;
  };

  subscribeKey = (sourceChatId: number, listener: () => void): (() => void) => {
    const actor = this.actor(sourceChatId);
    const listeners = this.listeners.get(sourceChatId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sourceChatId, listeners);
    const unsubscribe = actor.subscribe(listener);
    void actor.resync().catch((error) => {
      console.error("[plan-handoff] Remote bootstrap failed", error);
      this.setLocalFailure(sourceChatId, error);
    });
    return () => {
      unsubscribe();
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sourceChatId);
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
      return handoffId;
    } catch (error) {
      this.setLocalFailure(input.sourceChatId, error);
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

  private setLocalFailure(sourceChatId: number, error: unknown): void {
    this.localFailures.set(
      sourceChatId,
      error instanceof Error ? error.message : String(error),
    );
    this.notify(sourceChatId);
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
