import {
  collectDisposalError,
  TaskScope,
  type TaskCleanup,
} from "./task_scope";

export interface LifecycleHooks {
  stopAdmission: () => void;
  settleWaiters: () => void;
  publishFinalProjection: () => void;
  releaseResources: () => void;
  onLateSettlement: () => void;
}

export interface LifecycleScope<Key = PropertyKey> {
  replace(key: Key, cleanup: TaskCleanup): void;
  remove(key: Key): void;
  trackPromise<T>(promise: Promise<T>): Promise<T>;
  dispose(): void;
}

/**
 * Applies the shared disposal transition while leaving domain meaning in the
 * supplied hooks. Late settlements are compensated only after admission has
 * stopped and the synchronous resource-release phase has completed.
 */
export function createLifecycleScope<Key = PropertyKey>(
  hooks: LifecycleHooks,
): LifecycleScope<Key> {
  const resources = new TaskScope<Key>();
  let disposed = false;

  return {
    replace: (key, cleanup) => resources.replace(key, cleanup),
    remove: (key) => resources.remove(key),
    trackPromise: (promise) =>
      resources.trackPromise(promise, hooks.onLateSettlement),
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      collectDisposalError(errors, hooks.stopAdmission);
      collectDisposalError(errors, hooks.settleWaiters);
      collectDisposalError(errors, hooks.publishFinalProjection);
      collectDisposalError(errors, hooks.releaseResources);
      collectDisposalError(errors, () => resources.dispose());
      if (errors.length > 0) {
        throw new AggregateError(errors, "Lifecycle disposal failed");
      }
    },
  };
}
