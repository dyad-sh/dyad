import { appRunKey, type AppRunProducerEvent } from "@/app_run/transport";
import { appRunDefinition } from "@/app_run/definition";
import { MainAppRuntimeOutput } from "./main_app_runtime_output";
import type { AppRunInvocationRef } from "@/app_run/state";
import { appRuntimeService } from "./app_runtime_service";
import { remoteMachineHost } from "./distributed_machine_host";

class AppRunActorService {
  actor(appId: number) {
    return remoteMachineHost.ensure(appRunDefinition, appRunKey(appId));
  }

  sendProducer(appId: number, event: AppRunProducerEvent): void {
    if (event.invocationRef.entityKey !== appId) return;
    this.actor(appId).send(event);
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
    await this.actor(appId).enqueue({
      type: "START",
      operationId: input.operationId,
      startedAt: input.startedAt,
      expectedRevision: input.expectedRevision ?? 0,
    }).settled;
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
    const common = {
      type: "RESTART" as const,
      operationId: input.operationId,
      startedAt: input.startedAt,
      expectedRevision: input.expectedRevision ?? 0,
    };
    await this.actor(appId).enqueue(
      input.removeNodeModules
        ? { ...common, operation: "rebuild" }
        : {
            ...common,
            operation: "restart",
            options: {
              removeNodeModules: false,
              recreateSandbox: input.recreateSandbox,
            },
          },
    ).settled;
  }

  async dispatchStop(
    appId: number,
    input: {
      operationId: string;
      startedAt: number;
      activeInvocationRef: AppRunInvocationRef;
    },
  ): Promise<void> {
    await this.actor(appId).enqueue({
      type: "STOP_REQUESTED",
      operationId: input.operationId,
      startedAt: input.startedAt,
      activeInvocationRef: input.activeInvocationRef,
    }).settled;
  }

  async executeExternalLifecycle(options: {
    appId: number;
    operation: "restart" | "rebuild";
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<void> {
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
}

export const appRunActorService = new AppRunActorService();
