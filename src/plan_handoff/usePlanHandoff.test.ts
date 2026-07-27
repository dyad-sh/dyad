import { describe, expect, it, vi } from "vitest";
import { getRemotePlanHandoffSnapshot } from "./usePlanHandoff";

describe("getRemotePlanHandoffSnapshot", () => {
  it("returns a stable idle snapshot without addressing an invalid actor", () => {
    const manager = { getSnapshot: vi.fn() };

    const first = getRemotePlanHandoffSnapshot(manager, null);
    const second = getRemotePlanHandoffSnapshot(manager, null);

    expect(first).toBe(second);
    expect(first).toMatchObject({
      sourceChatId: -1,
      phase: "idle",
      failure: null,
    });
    expect(manager.getSnapshot).not.toHaveBeenCalled();
  });
});
