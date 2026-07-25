import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { TwoWindowHarness } from "./two_window_harness";

describe("two-window infrastructure harness", () => {
  it("dispatches from either window and reloads or destroys independently", () => {
    const harness = new TwoWindowHarness();
    const [first, second] = harness.createPair();
    const originalSecondWebContents = harness.webContentsId(second);

    harness.dispatchInvalidation(first, [{ family: "apps" }]);
    expect(harness.invalidatedKeys(first)).toEqual([]);
    expect(harness.invalidatedKeys(second)).toEqual([queryKeys.apps.all]);

    harness.reload(second);
    expect(harness.webContentsId(second)).not.toBe(originalSecondWebContents);
    harness.dispatchInvalidation(second, [{ family: "chats" }]);
    expect(harness.invalidatedKeys(first)).toEqual([queryKeys.chats.all]);

    harness.destroy(first);
    expect(
      harness.registry.snapshot().map((entry) => entry.windowSessionId),
    ).toEqual([second]);
  });

  it("inspects keyed subscriptions and exercises adopt-then-remove transfer", async () => {
    const harness = new TwoWindowHarness();
    const [first, second] = harness.createPair();
    await harness.subscribe(first, { kind: "chat-chunk", chatId: 9 }, () => [
      "bootstrap",
    ]);
    expect(harness.inspectSubscriptions(first)).toEqual(["chat-chunk:9"]);

    const tab = harness.tab(first, "transferable-state");
    const removeSource = vi.fn();
    const adopt = vi.fn().mockResolvedValue({ accepted: true });
    await expect(
      harness.transferTab(tab, second, adopt, removeSource),
    ).resolves.toEqual({ status: "adopted-and-removed" });
    expect(adopt).toHaveBeenCalledWith({
      ...tab,
      ownerWindowSessionId: second,
    });
    expect(removeSource).toHaveBeenCalledWith(tab.tabInstanceId);

    removeSource.mockClear();
    adopt.mockResolvedValue({ accepted: false, reason: "destination busy" });
    await expect(
      harness.transferTab(tab, second, adopt, removeSource),
    ).resolves.toEqual({
      status: "adoption-rejected",
      reason: "destination busy",
    });
    expect(removeSource).not.toHaveBeenCalled();
  });
});
