import { describe, expect, it, vi } from "vitest";
import { createLateBinding } from "./late_binding";

describe("createLateBinding", () => {
  it("fires queued work when the dependency is configured later", () => {
    const binding = createLateBinding<{ run(): void }>();
    const run = vi.fn();

    binding.onConfigured((dependency) => dependency.run());
    binding.configure({ run });

    expect(run).toHaveBeenCalledOnce();
    expect(binding.get().run).toBe(run);
  });

  it("supports cancellable queued callbacks", () => {
    const binding = createLateBinding<string>();
    const callback = vi.fn();
    const cancel = binding.onConfigured(callback);

    cancel();
    binding.configure("ready");

    expect(callback).not.toHaveBeenCalled();
  });

  it("defines one-shot, replaceable, pre-config, failure, and disposal behavior", () => {
    const oneShot = createLateBinding<number>();
    expect(() => oneShot.get()).toThrow("has not been configured");
    oneShot.configure(1);
    expect(() => oneShot.configure(2)).toThrow("already configured");

    const replaceable = createLateBinding<number>("replaceable");
    replaceable.configure(1);
    replaceable.configure(2);
    expect(replaceable.get()).toBe(2);

    const failed = createLateBinding<number>();
    const onFailure = vi.fn();
    failed.onConfigured(vi.fn(), onFailure);
    const failure = new Error("configuration failed");
    failed.fail(failure);
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(() => failed.get()).toThrow(failure);

    replaceable.dispose();
    replaceable.dispose();
    expect(() => replaceable.get()).toThrow("disposed");
    expect(() => replaceable.configure(3)).toThrow("disposed");
  });

  it("aggregates queued callback failures after notifying every listener", () => {
    const binding = createLateBinding<number>();
    const later = vi.fn();
    binding.onConfigured(() => {
      throw new Error("first");
    });
    binding.onConfigured(later);

    expect(() => binding.configure(1)).toThrow(AggregateError);
    expect(later).toHaveBeenCalledWith(1);
  });

  it("keeps the first failure terminal for early and late observers", () => {
    const binding = createLateBinding<number>();
    const earlyFailure = vi.fn();
    const firstError = new Error("first failure");
    const secondError = new Error("second failure");
    binding.onConfigured(vi.fn(), earlyFailure);

    binding.fail(firstError);

    expect(() => binding.fail(secondError)).toThrow(firstError);
    expect(() => binding.get()).toThrow(firstError);
    expect(earlyFailure).toHaveBeenCalledExactlyOnceWith(firstError);

    const lateFailure = vi.fn();
    binding.onConfigured(vi.fn(), lateFailure);
    expect(lateFailure).toHaveBeenCalledExactlyOnceWith(firstError);
  });
});
