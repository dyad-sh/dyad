import type { WebContents } from "electron";

import type { AppOutput } from "@/ipc/types/misc";
import type { AppRuntimeOutput } from "@/ipc/types/app_runtime";
import { safeSend } from "@/ipc/utils/safe_sender";

const APP_OUTPUT_FLUSH_INTERVAL_MS = 100;

const outputsBySender = new WeakMap<WebContents, IpcAppRuntimeOutput>();

/**
 * Temporary IPC adapter for the transport-neutral app-runtime service.
 *
 * The future main-hosted actor can provide its own output sink without
 * importing Electron or knowing which renderer initiated the command.
 */
export class IpcAppRuntimeOutput implements AppRuntimeOutput {
  private pendingOutputs: AppOutput[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly sender: WebContents) {}

  send(output: AppOutput): void {
    safeSend(this.sender, "app:output", output);
  }

  enqueue(output: AppOutput): void {
    this.pendingOutputs.push(output);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(
        () => this.flush(),
        APP_OUTPUT_FLUSH_INTERVAL_MS,
      );
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingOutputs.length === 0) {
      return;
    }
    const outputs = this.pendingOutputs;
    this.pendingOutputs = [];
    safeSend(this.sender, "app:output-batch", outputs);
  }
}

export function getIpcAppRuntimeOutput(
  sender: WebContents,
): IpcAppRuntimeOutput {
  let output = outputsBySender.get(sender);
  if (!output) {
    output = new IpcAppRuntimeOutput(sender);
    outputsBySender.set(sender, output);
  }
  return output;
}
