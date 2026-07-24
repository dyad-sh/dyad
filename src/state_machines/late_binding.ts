export type LateBindingMode = "one-shot" | "replaceable";

export interface LateBinding<T> {
  get(): T;
  configure(value: T): void;
  onConfigured(
    callback: (value: T) => void,
    onFailure?: (error: unknown) => void,
  ): () => void;
  fail(error: unknown): void;
  dispose(): void;
}

type Listener<T> = {
  configured: (value: T) => void;
  failed?: (error: unknown) => void;
};

/**
 * Explicit escape hatch for a dependency whose composition lifecycle cannot
 * make it available when its consumer is first constructed.
 */
export function createLateBinding<T>(
  mode: LateBindingMode = "one-shot",
): LateBinding<T> {
  let state:
    | { type: "pending" }
    | { type: "configured"; value: T }
    | { type: "failed"; error: unknown }
    | { type: "disposed" } = { type: "pending" };
  const listeners = new Set<Listener<T>>();

  const assertUsable = () => {
    if (state.type === "disposed") {
      throw new Error("Late binding has been disposed");
    }
  };

  return {
    get() {
      if (state.type === "configured") return state.value;
      if (state.type === "failed") throw state.error;
      if (state.type === "disposed") {
        throw new Error("Late binding has been disposed");
      }
      throw new Error("Late binding has not been configured");
    },
    configure(value) {
      assertUsable();
      if (state.type === "failed") throw state.error;
      if (mode === "one-shot" && state.type === "configured") {
        throw new Error("Late binding is already configured");
      }
      state = { type: "configured", value };
      const queued = Array.from(listeners);
      listeners.clear();
      const errors: unknown[] = [];
      for (const listener of queued) {
        try {
          listener.configured(value);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Late-binding callbacks failed");
      }
    },
    onConfigured(callback, onFailure) {
      assertUsable();
      if (state.type === "configured") {
        callback(state.value);
        return () => undefined;
      }
      if (state.type === "failed") {
        if (onFailure) onFailure(state.error);
        else throw state.error;
        return () => undefined;
      }
      const listener = { configured: callback, failed: onFailure };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fail(error) {
      assertUsable();
      if (state.type === "failed") throw state.error;
      if (state.type === "configured") {
        throw new Error("Configured late binding cannot fail");
      }
      state = { type: "failed", error };
      const queued = Array.from(listeners);
      listeners.clear();
      const errors: unknown[] = [];
      for (const listener of queued) {
        try {
          listener.failed?.(error);
        } catch (callbackError) {
          errors.push(callbackError);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          "Late-binding failure callbacks failed",
        );
      }
    },
    dispose() {
      if (state.type === "disposed") return;
      state = { type: "disposed" };
      listeners.clear();
    },
  };
}
