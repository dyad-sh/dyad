import {
  appRunKey,
  type AppRunIntentEvent,
  type AppRunProducerEvent,
} from "@/app_run/transport";
import { appRunDefinition, requireApp } from "@/app_run/definition";
import { MainAppRuntimeOutput } from "./main_app_runtime_output";
import type { AppRunInvocationRef } from "@/app_run/state";
import { appRuntimeService } from "./app_runtime_service";
import { remoteMachineHost } from "./distributed_machine_host";
import { DyadError } from "@/errors/dyad_error";

class AppRunActorService {
  actor(appId: number) {
    return remoteMachineHost.ensure(appRunDefinition, appRunKey(appId));
  }

  sendProducer(appId: number, event: AppRunProducerEvent): void {
    if (event.invocationRef.entityKey !== appId) return;
    remoteMachineHost.peek(appRunDefinition.id, appRunKey(appId))?.send(event);
  }

  async getRunState(appId: number) {
    await requireApp(appId);
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

  async dispatchStart(
    appId: number,
    input: {
      operationId: string;
      startedAt: number;
      expectedRevision?: number;
    },
  ): Promise<void> {
    await requireApp(appId);
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
    await requireApp(appId);
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
    await requireApp(appId);
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
    await requireApp(options.appId);
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

  async disposeApp(appId: number): Promise<void> {
    await remoteMachineHost.disposeKey(
      appRunDefinition.id,
      appRunKey(appId),
      "entity-deletion",
    );
  }

  dispose(): Promise<void> {
    return remoteMachineHost.dispose();
  }

  private async dispatchAndWait(
    appId: number,
    operationId: string,
    event: AppRunIntentEvent,
  ): Promise<void> {
    const actor = this.actor(appId);
    const outcome = await actor.enqueue(event).settled;
    if (outcome.kind === "failed") throw outcome.error;
    if (outcome.kind === "disposed") {
      throw new Error("App run actor was disposed");
    }
    if (outcome.kind === "ignored") {
      throw new Error(`App run request ignored: ${outcome.reason}`);
    }

    const readSettlement = () => {
      const settlement = actor.getSnapshot().lastSettlement;
      return settlement?.operationId === operationId ? settlement : null;
    };
    const initialSettlement = readSettlement();
    const settlement =
      initialSettlement ??
      (await new Promise<NonNullable<ReturnType<typeof readSettlement>>>(
        (resolve) => {
          const unsubscribe = actor.subscribe(() => {
            const current = readSettlement();
            if (!current) return;
            unsubscribe();
            resolve(current);
          });
          const current = readSettlement();
          if (current) {
            unsubscribe();
            resolve(current);
          }
        },
      ));
    if (settlement.outcome === "failed") {
      const runState = actor.getSnapshot().runState;
      if (runState.type === "errored" && runState.error.kind) {
        throw new DyadError(runState.error.message, runState.error.kind);
      }
      throw new Error(
        runState.type === "errored"
          ? runState.error.message
          : "App runtime operation failed",
      );
    }
  }
}

export const appRunActorService = new AppRunActorService();
