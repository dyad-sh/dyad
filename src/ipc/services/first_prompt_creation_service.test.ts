import { describe, expect, it, vi } from "vitest";
import { FirstPromptCreationRegistry } from "./first_prompt_creation_service";

describe("FirstPromptCreationRegistry", () => {
  it("cleans up when cancellation arrives before creation completes", async () => {
    const registry = new FirstPromptCreationRegistry();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const duplicateCleanup = vi.fn().mockResolvedValue(undefined);

    await registry.cancel("operation-1");
    await registry.complete("operation-1", cleanup);
    await registry.cancel("operation-1");
    await registry.complete("operation-1", duplicateCleanup);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(duplicateCleanup).not.toHaveBeenCalled();
  });

  it("cleans up a completed creation when cancellation arrives", async () => {
    const registry = new FirstPromptCreationRegistry();
    const cleanup = vi.fn().mockResolvedValue(undefined);

    await registry.complete("operation-1", cleanup);
    await registry.cancel("operation-1");

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("relinquishes ownership after the first prompt is dispatched", async () => {
    const registry = new FirstPromptCreationRegistry();
    const cleanup = vi.fn().mockResolvedValue(undefined);

    await registry.complete("operation-1", cleanup);
    registry.commit("operation-1");
    await registry.cancel("operation-1");

    expect(cleanup).not.toHaveBeenCalled();
  });

  it("retains cancelled ownership so a failed cleanup can be retried", async () => {
    const registry = new FirstPromptCreationRegistry();
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce(undefined);

    await registry.complete("operation-1", cleanup);
    await expect(registry.cancel("operation-1")).rejects.toThrow("busy");
    await registry.cancel("operation-1");

    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
