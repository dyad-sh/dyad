import { describe, expect, it } from "vitest";
import type { QueuedMessageItem } from "@/atoms/chatAtoms";
import {
  findRestorableQueueItems,
  getPersistableQueueItems,
} from "./useQueuePersistence";

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
  it("drops machine-owned continuations during hydration", () => {
    const persisted = [
      queuedItem("persisted", "integration:1"),
      queuedItem("ordinary"),
    ];

    expect(findRestorableQueueItems(persisted, [])).toEqual([persisted[1]]);
  });

  it("deduplicates ordinary prompts by queue item id", () => {
    const existing = queuedItem("existing");
    expect(findRestorableQueueItems([existing], [existing])).toEqual([]);
  });
});

describe("getPersistableQueueItems", () => {
  it("serializes ordinary prompts but not machine-owned continuations", () => {
    const ordinary = queuedItem("ordinary");
    expect(
      getPersistableQueueItems([
        queuedItem("machine", "integration:1"),
        ordinary,
      ]),
    ).toEqual([ordinary]);
  });
});
