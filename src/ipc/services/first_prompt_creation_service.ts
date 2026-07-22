import log from "electron-log";

const logger = log.scope("first_prompt_creation_service");

interface CreationEntry {
  cancelled: boolean;
  cleanup?: () => Promise<void>;
}

const MAX_FINALIZED_OPERATION_IDS = 1_000;

/**
 * Main-owned lifecycle registry for entities created by the renderer's first
 * prompt saga. Cancellation can arrive before creation finishes, including
 * during renderer teardown, so the main process retains the tombstone and
 * performs cleanup once the resource is registered.
 */
export class FirstPromptCreationRegistry {
  private readonly entries = new Map<string, CreationEntry>();
  private readonly finalizedOperationIds = new Set<string>();

  private markFinalized(operationId: string): void {
    this.finalizedOperationIds.add(operationId);
    if (this.finalizedOperationIds.size <= MAX_FINALIZED_OPERATION_IDS) return;
    const oldest = this.finalizedOperationIds.values().next().value;
    if (oldest !== undefined) this.finalizedOperationIds.delete(oldest);
  }

  async complete(
    operationId: string,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    if (this.finalizedOperationIds.has(operationId)) return;
    const entry = this.entries.get(operationId) ?? { cancelled: false };
    if (entry.cancelled) {
      this.entries.set(operationId, { ...entry, cleanup });
      await cleanup();
      this.entries.delete(operationId);
      this.markFinalized(operationId);
      return;
    }
    this.entries.set(operationId, { ...entry, cleanup });
  }

  commit(operationId: string): void {
    this.entries.delete(operationId);
    this.markFinalized(operationId);
  }

  async cancel(operationId: string): Promise<void> {
    if (this.finalizedOperationIds.has(operationId)) return;
    const entry = this.entries.get(operationId);
    if (!entry) {
      this.entries.set(operationId, { cancelled: true });
      return;
    }
    if (!entry.cleanup) {
      entry.cancelled = true;
      return;
    }
    await entry.cleanup();
    this.entries.delete(operationId);
    this.markFinalized(operationId);
  }
}

export const firstPromptCreationRegistry = new FirstPromptCreationRegistry();

export function logFirstPromptCreationCleanupFailure(
  operationId: string,
  error: unknown,
): void {
  logger.error(
    `Failed to clean up first-prompt operation ${operationId}`,
    error,
  );
}
