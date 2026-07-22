import { describe, expect, it, vi } from "vitest";
import { EntityDisposalRegistry } from "./entity_disposal";

describe("EntityDisposalRegistry", () => {
  it("notifies only the matching scope", () => {
    const registry = new EntityDisposalRegistry();
    const app = vi.fn();
    const chat = vi.fn();
    registry.onAppDeleted(app);
    registry.onChatDeleted(chat);

    registry.disposeForApp(7);

    expect(app).toHaveBeenCalledWith(7);
    expect(chat).not.toHaveBeenCalled();
  });

  it("supports unregistering during a disposal callback", () => {
    const registry = new EntityDisposalRegistry();
    const second = vi.fn();
    let unregisterSecond: () => void = () => undefined;
    registry.onAppDeleted(() => unregisterSecond());
    unregisterSecond = registry.onAppDeleted(second);

    registry.disposeForApp(1);
    registry.disposeForApp(2);

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("runs every disposer before surfacing cleanup failures", () => {
    const registry = new EntityDisposalRegistry();
    const afterFailure = vi.fn();
    registry.onChatDeleted(() => {
      throw new Error("cleanup failed");
    });
    registry.onChatDeleted(afterFailure);

    expect(() => registry.disposeForChat(3)).toThrow(AggregateError);
    expect(afterFailure).toHaveBeenCalledWith(3);
  });
});
