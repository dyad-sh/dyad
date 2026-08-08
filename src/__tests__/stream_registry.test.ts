import { describe, expect, it, vi } from "vitest";

import { StreamRegistry } from "@/ipc/utils/stream_registry";

function controller() {
  return { abort: vi.fn() };
}

describe("StreamRegistry", () => {
  it("leaves other conversations running when one starts a turn", () => {
    // The bug this guards: starting a message in one tab used to abort every
    // other tab's answer.
    const registry = new StreamRegistry<{ abort: () => void }>();
    const a = controller();
    const b = controller();

    registry.register("tab-a", a);
    registry.register("tab-b", b);

    expect(a.abort).not.toHaveBeenCalled();
    expect(registry.size).toBe(2);
  });

  it("replaces an earlier turn in the same conversation", () => {
    const registry = new StreamRegistry<{ abort: () => void }>();
    const first = controller();
    const second = controller();

    registry.register("tab-a", first);
    registry.register("tab-a", second);

    expect(first.abort).toHaveBeenCalledTimes(1);
    expect(second.abort).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);
  });

  it("cancels only the conversation named", () => {
    const registry = new StreamRegistry<{ abort: () => void }>();
    const a = controller();
    const b = controller();
    registry.register("tab-a", a);
    registry.register("tab-b", b);

    expect(registry.abort("tab-a")).toBe(true);
    expect(a.abort).toHaveBeenCalledTimes(1);
    expect(b.abort).not.toHaveBeenCalled();
    expect(registry.has("tab-b")).toBe(true);
  });

  it("reports nothing to cancel for an idle conversation", () => {
    const registry = new StreamRegistry<{ abort: () => void }>();
    expect(registry.abort("nobody")).toBe(false);
  });

  it("does not let a finishing turn evict the turn that replaced it", () => {
    // The race: turn one is aborted, turn two registers, then turn one's
    // teardown runs. Retiring by identity keeps turn two cancellable.
    const registry = new StreamRegistry<{ abort: () => void }>();
    const first = controller();
    const second = controller();

    registry.register("tab-a", first);
    registry.register("tab-a", second);
    registry.retire("tab-a", first);

    expect(registry.has("tab-a")).toBe(true);
    expect(registry.abort("tab-a")).toBe(true);
    expect(second.abort).toHaveBeenCalledTimes(1);
  });

  it("removes a turn that is still the registered one", () => {
    const registry = new StreamRegistry<{ abort: () => void }>();
    const only = controller();
    registry.register("tab-a", only);
    registry.retire("tab-a", only);

    expect(registry.has("tab-a")).toBe(false);
    // Retiring is not cancelling; the turn ended on its own.
    expect(only.abort).not.toHaveBeenCalled();
  });
});
