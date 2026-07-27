import {
  appRunKey,
  type AppRunIntentEvent,
  type AppRunProducerEvent,
} from "@/app_run/transport";
import { appRunDefinition, requireExistingApp } from "@/app_run/definition";
import { MainAppRuntimeOutput } from "./main_app_runtime_output";
import type { AppRunInvocationRef } from "@/app_run/state";
import { appRuntimeService } from "./app_runtime_service";
import { remoteMachineHost } from "./distributed_machine_actor_host";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

type AppRunActorHost = Pick<
  typeof remoteMachineHost,
  "ensure" | "peek" | "disposeKey" | "disposeMachine" | "dispose"
>;

export class AppRunActorService {
  private readonly settlementRejectors = new Map<
    number,
    Set<(error: DyadError) => void>
  >();

  constructor(private readonly host: AppRunActorHost = remoteMachineHost) {}

  actor(appId: number) {
    return this.host.ensure(appRunDefinition, appRunKey(appId));
  }

  sendProducer(appId: number, event: AppRunProducerEvent): void {
    if (event.invocationRef.entityKey !== appId) return;
    this.host.peek(appRunDefinition.id, appRunKey(appId))?.send(event);
  }

  async getRunState(appId: number) {
    await requireExistingApp(appId);
    return this.actor(appId).getSnapshot().runState;
  }

  outputFor(
    appId: number,
    invocationRef: AppRunInvocationRef,
  ): MainAppRuntimeOutput {
    return new MainAppRuntimeOutput(appId, invocationRef, {
      send: (event) => this.sendProducer(appId, event),
    });
  }

  async outputForCurrentRun(
    appId: number,
    fallbackInvocationRef?: AppRunInvocationRef,
  ): Promise<MainAppRuntimeOutput> {
    await requireExistingApp(appId);
    const state = this.actor(appId).getSnapshot().runState;
    const invocationRef =
      state.type === "idle"
        ? (fallbackInvocationRef ??
          appRuntimeService.createExternalLifecycleRef(appId))
        : state.invocationRef;
    return this.outputFor(appId, invocationRef);
  }

  async dispatchStart(
    appId: number,
    input: {
      operationId: string;
      startedAt: number;
      expectedRevision?: number;
    },
  ): Promise<void> {
    await requireExistingApp(appId);
    await this.dispatchAndWait(appId, input.operationId, {
      type: "START",
      operationId: input.operationId,
      startedAt: input.startedAt,
      expectedRevision: input.expectedRevision ?? 0,
    });
  }

  async dispatchRestart(
    appId: number,
    input: {
      operationId: string;
      startedAt: number;
      removeNodeModules: boolean;
      recreateSandbox: boolean;
      expectedRevision?: number;
    },
  ): Promise<void> {
    await requireExistingApp(appId);
    const common = {
      type: "RESTART" as const,
      operationId: input.operationId,
      startedAt: input.startedAt,
      expectedRevision: input.expectedRevision ?? 0,
    };
    await this.dispatchAndWait(appId, input.operationId, {
      ...common,
      operation: "restart",
      options: {
        removeNodeModules: input.removeNodeModules,
        recreateSandbox: input.recreateSandbox,
      },
    });
  }

  async dispatchStop(
    appId: number,
    input: {
      operationId: string;
      startedAt: number;
      activeInvocationRef: AppRunInvocationRef;
    },
  ): Promise<void> {
    await requireExistingApp(appId);
    await this.dispatchAndWait(appId, input.operationId, {
      type: "STOP_REQUESTED",
      operationId: input.operationId,
      startedAt: input.startedAt,
      activeInvocationRef: input.activeInvocationRef,
    });
  }

  async executeExternalLifecycle(options: {
    appId: number;
    operation: "restart" | "rebuild";
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<void> {
    await requireExistingApp(options.appId);
    this.actor(options.appId);
    const invocationRef = appRuntimeService.createExternalLifecycleRef(
      options.appId,
    );
    await appRuntimeService.executeExternalLifecycle({
      ...options,
      invocationRef,
      output: this.outputFor(options.appId, invocationRef),
    });
  }

  /**
   * Runs the process-replacement portion of an external restart when the
   * caller already owns the app runtime lock.
   *
   * The ordinary external lifecycle path acquires that lock itself, so using
   * it from isolated database setup would deadlock. This adapter still gives
   * the replacement a fresh actor-owned invocation and publishes correlated
   * terminal producer events around the caller's already-locked work.
   */
  async executeAlreadyLockedExternalRestart<T>(
    appId: number,
    execute: (context: {
      invocationRef: AppRunInvocationRef;
      output: MainAppRuntimeOutput;
    }) => Promise<T>,
  ): Promise<T> {
    await requireExistingApp(appId);
    this.actor(appId);
    const invocationRef = appRuntimeService.createExternalLifecycleRef(appId);
    const output = this.outputFor(appId, invocationRef);
    this.sendProducer(appId, {
      type: "EXTERNAL_RESTART_STARTED",
      invocationRef,
      operation: "restart",
      startedAt: Date.now(),
    });
    try {
      const result = await execute({ invocationRef, output });
      this.sendProducer(appId, {
        type: "PROCESS_SPAWNED",
        operationId: invocationRef.operationId,
        invocationRef,
      });
      return result;
    } catch (error) {
      this.sendProducer(appId, {
        type: "PROCESS_FAILED",
        operationId: invocationRef.operationId,
        invocationRef,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async disposeApp(appId: number): Promise<void> {
    this.rejectSettlementsForApp(appId);
    await this.host.disposeKey(
      appRunDefinition.id,
      appRunKey(appId),
      "entity-deletion",
    );
  }

  disposeAllApps(): Promise<void> {
    this.rejectAllSettlements();
    return this.host.disposeMachine(appRunDefinition.id);
  }

  dispose(): Promise<void> {
    this.rejectAllSettlements();
    return this.host.dispose();
  }

  private async dispatchAndWait(
    appId: number,
    operationId: string,
    event: AppRunIntentEvent,
  ): Promise<void> {
    const actor = this.actor(appId);
    let rejectDisposal!: (error: DyadError) => void;
    const disposal = new Promise<never>((_resolve, reject) => {
      rejectDisposal = reject;
    });
    this.addSettlementRejector(appId, rejectDisposal);
    try {
      const outcome = await Promise.race([
        actor.enqueue(event).settled,
        disposal,
      ]);
      if (outcome.kind === "failed") throw outcome.error;
      if (outcome.kind === "disposed") {
        throw new DyadError(
          "App run actor was disposed",
          DyadErrorKind.Precondition,
        );
      }
      if (outcome.kind === "ignored") {
        throw new DyadError(
          `App run request ignored: ${outcome.reason}`,
          DyadErrorKind.Conflict,
        );
      }

      const readSettlement = () => {
        const settlement = actor.getSnapshot().lastSettlement;
        return settlement?.operationId === operationId ? settlement : null;
      };
      const initialSettlement = readSettlement();
      let unsubscribe: () => void = () => undefined;
      const waitForSettlement = new Promise<
        NonNullable<ReturnType<typeof readSettlement>>
      >((resolve) => {
        let settled = false;
        const finish = (
          value: NonNullable<ReturnType<typeof readSettlement>>,
        ) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          resolve(value);
        };
        unsubscribe = actor.subscribe(() => {
          const current = readSettlement();
          if (current) finish(current);
        });
        const current = readSettlement();
        if (current) finish(current);
      });
      let settlement: NonNullable<ReturnType<typeof readSettlement>>;
      try {
        settlement =
          initialSettlement ??
          (await Promise.race([waitForSettlement, disposal]));
      } finally {
        unsubscribe();
      }
      if (settlement.outcome === "failed") {
        if (settlement.error?.kind) {
          throw new DyadError(settlement.error.message, settlement.error.kind);
        }
        throw new Error(
          settlement.error?.message ?? "App runtime operation failed",
        );
      }
    } finally {
      this.removeSettlementRejector(appId, rejectDisposal);
    }
  }

  private addSettlementRejector(
    appId: number,
    reject: (error: DyadError) => void,
  ): void {
    const rejectors = this.settlementRejectors.get(appId) ?? new Set();
    rejectors.add(reject);
    this.settlementRejectors.set(appId, rejectors);
  }

  private removeSettlementRejector(
    appId: number,
    reject: (error: DyadError) => void,
  ): void {
    const rejectors = this.settlementRejectors.get(appId);
    rejectors?.delete(reject);
    if (rejectors?.size === 0) this.settlementRejectors.delete(appId);
  }

  private rejectSettlementsForApp(appId: number): void {
    const rejectors = [...(this.settlementRejectors.get(appId) ?? [])];
    for (const reject of rejectors) {
      reject(
        new DyadError("App run actor was disposed", DyadErrorKind.Precondition),
      );
    }
  }

  private rejectAllSettlements(): void {
    for (const appId of this.settlementRejectors.keys()) {
      this.rejectSettlementsForApp(appId);
    }
  }
}

export const appRunActorService = new AppRunActorService();
