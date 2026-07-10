export type TypeScriptUtilityProcessKind = "code-explorer" | "tsc";

const RESIDENT_PROCESS_STOP_TIMEOUT_MS = 30_000;

interface QueuedOperation {
  kind: TypeScriptUtilityProcessKind;
  operation: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface ResidentProcess {
  kind: TypeScriptUtilityProcessKind;
  reusable: boolean;
  token: object;
  stop: () => Promise<void>;
  stopPromise?: Promise<void>;
}

export interface ResidentProcessRegistration {
  /** Clear the registration after the underlying process emits `exit`. */
  clear(): void;
  /** Stop the process and wait until its registration is cleared. */
  stop(): Promise<void>;
}

/**
 * Serializes the memory-heavy TypeScript utility processes.
 *
 * Code Explorer keeps a reusable process alive between requests so its index
 * cache survives. TSC processes are one-shot and non-reusable. Before an
 * operation starts, any incompatible (or already-stopping) resident process
 * is stopped and must emit `exit`; only then may the next operation fork or
 * reuse a process.
 */
export class TypeScriptUtilityProcessScheduler {
  private readonly queue: QueuedOperation[] = [];
  private operationActive = false;
  private activeKind: TypeScriptUtilityProcessKind | null = null;
  private resident: ResidentProcess | null = null;

  runExclusive<T>(
    kind: TypeScriptUtilityProcessKind,
    operation: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        kind,
        operation,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.startNext();
    });
  }

  registerResidentProcess({
    kind,
    reusable,
    token,
    stop,
  }: {
    kind: TypeScriptUtilityProcessKind;
    reusable: boolean;
    token: object;
    stop: () => Promise<void>;
  }): ResidentProcessRegistration {
    if (!this.operationActive || this.activeKind !== kind) {
      throw new Error(
        `Cannot register a ${kind} process outside its scheduled operation`,
      );
    }
    if (this.resident && this.resident.token !== token) {
      throw new Error(
        `Cannot register a ${kind} process while a ${this.resident.kind} process is resident`,
      );
    }

    const entry: ResidentProcess = { kind, reusable, token, stop };
    this.resident = entry;

    return {
      clear: () => {
        if (this.resident === entry) {
          this.resident = null;
        }
      },
      stop: () => this.stopResidentProcess(entry),
    };
  }

  private startNext(): void {
    if (this.operationActive) {
      return;
    }
    const queued = this.queue.shift();
    if (!queued) {
      return;
    }

    this.operationActive = true;
    this.activeKind = queued.kind;
    void this.execute(queued);
  }

  private async execute(queued: QueuedOperation): Promise<void> {
    try {
      const resident = this.resident;
      if (
        resident &&
        (resident.kind !== queued.kind ||
          !resident.reusable ||
          resident.stopPromise)
      ) {
        await this.stopResidentProcess(resident);
      }

      queued.resolve(await queued.operation());
    } catch (error) {
      queued.reject(error);
    } finally {
      this.operationActive = false;
      this.activeKind = null;
      this.startNext();
    }
  }

  private stopResidentProcess(entry: ResidentProcess): Promise<void> {
    if (!entry.stopPromise) {
      const stopAttempt = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              `Timed out after ${RESIDENT_PROCESS_STOP_TIMEOUT_MS}ms waiting for ${entry.kind} process to exit`,
            ),
          );
        }, RESIDENT_PROCESS_STOP_TIMEOUT_MS);

        // Defer the callback so entry.stopPromise is installed before the raw
        // stop path can synchronously emit `exit` in a test or future runtime.
        void Promise.resolve()
          .then(() => entry.stop())
          .then(
            () => {
              clearTimeout(timeout);
              resolve();
            },
            (error) => {
              clearTimeout(timeout);
              reject(error);
            },
          );
      }).then(() => {
        if (this.resident === entry) {
          throw new Error(
            `${entry.kind} process reported that it stopped before emitting exit`,
          );
        }
      });

      let retryableStopPromise!: Promise<void>;
      retryableStopPromise = stopAttempt.catch((error) => {
        if (entry.stopPromise === retryableStopPromise) {
          // Keep the resident registered for safety, but allow a later queued
          // operation to retry stopping it instead of caching a rejection.
          entry.stopPromise = undefined;
        }
        throw error;
      });
      entry.stopPromise = retryableStopPromise;
    }
    return entry.stopPromise;
  }
}

export const typescriptUtilityProcessScheduler =
  new TypeScriptUtilityProcessScheduler();
