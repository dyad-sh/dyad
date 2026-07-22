import { describe, expect, it } from "vitest";
import type { QueuedMessageItem } from "@/atoms/chatAtoms";
import { findRestorableQueueItems } from "./useQueuePersistence";

function queuedItem(
  id: string,
  userInputRequestId?: string,
): QueuedMessageItem {
  return {
    id,
    prompt: id,
    selectedComponents: [],
    userInputRequestId,
  };
}

describe("findRestorableQueueItems", () => {
  it("deduplicates a continuation by its durable request id", () => {
    const existing = [queuedItem("live", "integration:1")];
    const persisted = [
      queuedItem("persisted", "integration:1"),
      queuedItem("ordinary"),
    ];

    expect(findRestorableQueueItems(persisted, existing)).toEqual([
      persisted[1],
    ]);
  });

  it("deduplicates repeated persisted entries in the same hydration", () => {
    const first = queuedItem("first", "integration:1");
    expect(
      findRestorableQueueItems(
        [first, queuedItem("second", "integration:1")],
        [],
      ),
    ).toEqual([first]);
  });
});
