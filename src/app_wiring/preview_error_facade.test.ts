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

  it("rejects queued and late work for a disposed app key", async () => {
    const facade = new DeferredPreviewErrorFacade();
    const source = {
      setAppError: vi.fn(),
      clearAppError: vi.fn(),
      setSyncError: vi.fn(),
      clearSyncError: vi.fn(),
    };
    facade.registerSource(source);

    facade.setAppError(7, "queued");
    facade.disposeKey(7);
    facade.setSyncError(7, "late");
    facade.setAppError(8, "active");
    await Promise.resolve();

    expect(source.setAppError).toHaveBeenCalledTimes(1);
    expect(source.setAppError).toHaveBeenCalledWith(8, "active");
    expect(source.setSyncError).not.toHaveBeenCalled();
  });
});
