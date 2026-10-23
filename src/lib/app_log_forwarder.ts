import { ipc, type ConsoleEntry } from "@/ipc/types";
import { MAX_LOGS_PER_APP } from "@/lib/log_store";

export const APP_LOG_FLUSH_DELAY_MS = 100;

/**
 * Batches renderer-produced app log entries (preview console, network
 * requests, edge function logs) into one IPC call per flush.
 *
 * A preview app stuck in a render or error loop can log thousands of times
 * a second. Sending each entry as its own invoke queues that work on the
 * main process, which can saturate its event loop and freeze the whole UI.
 * Only the newest MAX_LOGS_PER_APP entries are kept between flushes; the
 * main store would discard anything older anyway.
 */
export class AppLogForwarder {
  private pending: ConsoleEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly send: (entries: ConsoleEntry[]) => Promise<void>,
    private readonly flushDelayMs = APP_LOG_FLUSH_DELAY_MS,
  ) {}

  enqueue(entries: readonly ConsoleEntry[]): void {
    if (entries.length === 0) {
      return;
    }
    this.pending.push(...entries);
    if (this.pending.length > MAX_LOGS_PER_APP) {
      this.pending.splice(0, this.pending.length - MAX_LOGS_PER_APP);
    }
    this.flushTimer ??= setTimeout(() => this.flush(), this.flushDelayMs);
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pending.length === 0) {
      return;
    }
    const entries = this.pending;
    this.pending = [];
    // Promise.resolve().then also turns a synchronous throw into a rejection.
    Promise.resolve()
      .then(() => this.send(entries))
      .catch((error) => {
        console.warn("Failed to forward app logs to main:", error);
      });
  }
}

export const appLogForwarder = new AppLogForwarder((entries) =>
  ipc.misc.addLogs({ entries }),
);
