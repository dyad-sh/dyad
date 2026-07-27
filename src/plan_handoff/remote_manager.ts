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

  getSnapshot = (sourceChatId: number): PlanHandoffRemoteSnapshot =>
    this.actor(sourceChatId).getSnapshot();

  subscribeKey = (sourceChatId: number, listener: () => void): (() => void) => {
    const actor = this.actor(sourceChatId);
    const unsubscribe = actor.subscribe(listener);
    void actor.resync().catch((error) => {
      console.error("[plan-handoff] Remote bootstrap failed", error);
    });
    return unsubscribe;
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
  }

  private actor(sourceChatId: number) {
    return this.client.actor(
      planHandoffClientDefinition,
      planHandoffKey(sourceChatId),
    );
  }
}
