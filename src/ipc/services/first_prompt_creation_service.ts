import log from "electron-log";
import type { WebContents } from "electron";

const logger = log.scope("first_prompt_creation_service");

interface CreationEntry {
  cancelled: boolean;
  cleanup?: () => Promise<void>;
}

interface OwnerBinding {
  owner: WebContents;
  operationIds: Set<string>;
  onGone: () => void;
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
  private readonly ownerBindings = new Map<number, OwnerBinding>();
  private readonly operationOwnerIds = new Map<string, number>();

  track(operationId: string, owner?: WebContents): void {
    if (
      !owner ||
      this.finalizedOperationIds.has(operationId) ||
      this.entries.get(operationId)?.cancelled
    ) {
      return;
    }

    this.releaseOwner(operationId);
    let binding = this.ownerBindings.get(owner.id);
    if (!binding) {
      const onGone = () => {
        const current = this.ownerBindings.get(owner.id);
        if (!current || current.onGone !== onGone) return;
        this.ownerBindings.delete(owner.id);
        owner.removeListener("destroyed", onGone);
        owner.removeListener("render-process-gone", onGone);
        for (const ownedOperationId of current.operationIds) {
          this.operationOwnerIds.delete(ownedOperationId);
          void this.cancel(ownedOperationId).catch((error) =>
            logFirstPromptCreationCleanupFailure(ownedOperationId, error),
          );
        }
      };
      binding = { owner, operationIds: new Set(), onGone };
      this.ownerBindings.set(owner.id, binding);
      owner.once("destroyed", onGone);
      owner.once("render-process-gone", onGone);
    }
    binding.operationIds.add(operationId);
    this.operationOwnerIds.set(operationId, owner.id);
  }

  private releaseOwner(operationId: string): void {
    const ownerId = this.operationOwnerIds.get(operationId);
    if (ownerId === undefined) return;
    this.operationOwnerIds.delete(operationId);
    const binding = this.ownerBindings.get(ownerId);
    if (!binding) return;
    binding.operationIds.delete(operationId);
    if (binding.operationIds.size > 0) return;
    binding.owner.removeListener("destroyed", binding.onGone);
    binding.owner.removeListener("render-process-gone", binding.onGone);
    this.ownerBindings.delete(ownerId);
  }

  private markFinalized(operationId: string): void {
    this.releaseOwner(operationId);
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
    this.releaseOwner(operationId);
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
