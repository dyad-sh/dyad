import type { AppRuntimeOutput } from "@/ipc/types/app_runtime";
import type { AppOutput } from "@/ipc/types/misc";
import { appOutputInterests } from "@/window_infrastructure/main/production_high_volume";
import type { AppRunProducerEvent } from "@/app_run/transport";
import type { AppRunInvocationRef, RunUrl } from "@/app_run/state";

const PROXY_PREFIX = "[dyad-proxy-server]started=[";

export interface AppRunProducerSink {
  send(event: AppRunProducerEvent): void;
}

/**
 * Output producer captured when an app-runtime command is created.
 *
 * Lifecycle facts enter the owning actor synchronously before the same output
 * is fanned out to interested renderer windows. The captured invocation is
 * used even if a legacy output payload omits it.
 */
export class MainAppRuntimeOutput implements AppRuntimeOutput {
  constructor(
    private readonly appId: number,
    private readonly invocationRef: AppRunInvocationRef,
    private readonly producer: AppRunProducerSink,
  ) {}

  send(output: AppOutput): void {
    this.admitLifecycle(output);
    const interest = { kind: "app-output" as const, appId: this.appId };
    if (output.type === "app-exit") {
      appOutputInterests.terminalFlush(interest, this.bind(output));
      return;
    }
    appOutputInterests.sendImmediate(interest, this.bind(output), "app:output");
  }

  enqueue(output: AppOutput): void {
    this.admitLifecycle(output);
    appOutputInterests.enqueue(
      { kind: "app-output", appId: this.appId },
      this.bind(output),
    );
  }

  flush(): void {
    appOutputInterests.flushAll();
  }

  private bind(output: AppOutput): AppOutput {
    return {
      ...output,
      appId: this.appId,
      invocationRef: this.invocationRef,
    };
  }

  private admitLifecycle(output: AppOutput): void {
    const invocationRef = this.invocationRef;
    if (output.type === "app-exit") {
      this.producer.send({
        type: "PROCESS_EXITED",
        invocationRef,
        exitCode: output.exitCode ?? null,
        timestamp: output.timestamp ?? Date.now(),
      });
      return;
    }
    if (
      output.type === "agent-lifecycle-started" &&
      output.lifecycleOperation
    ) {
      this.producer.send({
        type: "EXTERNAL_RESTART_STARTED",
        invocationRef,
        operation: output.lifecycleOperation,
        startedAt: output.timestamp ?? Date.now(),
      });
      return;
    }
    if (
      output.type === "agent-lifecycle-succeeded" ||
      output.type === "agent-lifecycle-failed"
    ) {
      this.producer.send(
        output.type === "agent-lifecycle-succeeded"
          ? {
              type: "PROCESS_SPAWNED",
              operationId: invocationRef.operationId,
              invocationRef,
            }
          : {
              type: "PROCESS_FAILED",
              operationId: invocationRef.operationId,
              invocationRef,
              error: { message: output.message },
              runtimeMayBeLive: output.lifecycleRuntimeMayBeLive === true,
            },
      );
      return;
    }
    if (output.message.includes(PROXY_PREFIX)) {
      const url = parseProxyReady(output.message);
      if (url) {
        this.producer.send({ type: "PROXY_READY", invocationRef, url });
      }
    }
    if (
      output.message.includes("hmr update") &&
      output.message.includes("[vite]")
    ) {
      this.producer.send({ type: "HMR_DETECTED", invocationRef });
    }
  }
}

function parseProxyReady(message: string): RunUrl | undefined {
  const appUrl = message.match(/\[dyad-proxy-server\]started=\[(.*?)\]/)?.[1];
  const originalUrl = message.match(/original=\[(.*?)\]/)?.[1];
  const mode = message.match(/mode=\[(.*?)\]/)?.[1];
  if (
    !appUrl ||
    !originalUrl ||
    (mode !== "host" && mode !== "docker" && mode !== "cloud")
  ) {
    return undefined;
  }
  return { appUrl, originalUrl, mode };
}
