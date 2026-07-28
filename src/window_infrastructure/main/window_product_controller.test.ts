import { describe, expect, it, vi } from "vitest";
import { awaitProductWindowRenderer } from "./window_product_controller";

describe("awaitProductWindowRenderer", () => {
  it("does not report success until the renderer load completes", async () => {
    let resolveLoad!: () => void;
    const rendererLoad = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    const rollback = vi.fn();
    let settled = false;
    const result = awaitProductWindowRenderer({
      rendererLoad,
      result: "session-id",
      rollback,
    }).then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    resolveLoad();

    await expect(result).resolves.toBe("session-id");
    expect(rollback).not.toHaveBeenCalled();
  });

  it("rolls back before propagating a renderer load failure", async () => {
    const rollback = vi.fn();
    const loadError = new Error("renderer unavailable");

    await expect(
      awaitProductWindowRenderer({
        rendererLoad: Promise.reject(loadError),
        result: "session-id",
        rollback,
      }),
    ).rejects.toBe(loadError);
    expect(rollback).toHaveBeenCalledOnce();
  });
});
