import { describe, expect, it } from "vitest";
import type { QueuedMessageItem } from "@/atoms/chatAtoms";
import {
  findRestorableQueueItems,
  getPersistableQueueItems,
} from "./useQueuePersistence";

function queuedItem(id: string, requestId?: string): QueuedMessageItem {
  return {
    id,
    prompt: id,
    selectedComponents: [],
    owner: requestId ? { kind: "user-input-follow-up", requestId } : undefined,
  };
}

describe("findRestorableQueueItems", () => {
  it("drops callback-less machine continuations after a full restart", () => {
    const persisted = [
      queuedItem("persisted", "integration:1"),
      {
        id: "legacy-persisted",
        prompt: "legacy",
        userInputRequestId: "integration:legacy",
      },
      queuedItem("ordinary"),
    ];

    expect(findRestorableQueueItems(persisted, [])).toEqual([persisted[2]]);
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
