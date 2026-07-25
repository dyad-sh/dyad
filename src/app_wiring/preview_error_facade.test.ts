import { describe, expect, it, vi } from "vitest";
import { DeferredPreviewErrorFacade } from "./preview_error_facade";

describe("DeferredPreviewErrorFacade", () => {
  it("defers delivery and fans out to every registered source", async () => {
    const facade = new DeferredPreviewErrorFacade();
    const first = {
      setAppError: vi.fn(),
      clearAppError: vi.fn(),
      setSyncError: vi.fn(),
      clearSyncError: vi.fn(),
    };
    const second = {
      setAppError: vi.fn(),
      clearAppError: vi.fn(),
      setSyncError: vi.fn(),
      clearSyncError: vi.fn(),
    };
    facade.registerSource(first);
    facade.registerSource(second);

    facade.setAppError(7, "failed");
    expect(first.setAppError).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(first.setAppError).toHaveBeenCalledWith(7, "failed");
    expect(second.setAppError).toHaveBeenCalledWith(7, "failed");
  });
});
