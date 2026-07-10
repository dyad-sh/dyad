import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getQueueFilePath,
  readPersistedQueue,
  writePersistedQueue,
  pruneDeletedChats,
} from "@/main/queue_store";
import { getUserDataPath } from "@/paths/paths";
import { getDb } from "@/db";
import type { PersistedQueue } from "@/ipc/types/queue";

vi.mock("@/paths/paths", () => ({
  getUserDataPath: vi.fn(),
}));
vi.mock("@/db", () => ({
  getDb: vi.fn(),
}));

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-store-test-"));
  vi.mocked(getUserDataPath).mockReturnValue(tempDir);
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function mockExistingChatIds(ids: number[]) {
  vi.mocked(getDb).mockReturnValue({
    select: () => ({
      from: () => ({
        all: () => ids.map((id) => ({ id })),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>);
}

const sampleQueue: PersistedQueue = {
  "1": [
    {
      id: "item-1",
      prompt: "hello",
      selectedComponents: [
        {
          id: "c1",
          name: "Button",
          relativePath: "src/Button.tsx",
          lineNumber: 10,
          columnNumber: 2,
        },
      ],
    },
  ],
  "2": [
    {
      id: "item-2",
      prompt: "with attachment",
      attachments: [
        {
          name: "a.txt",
          type: "text/plain",
          data: "data:text/plain;base64,aGVsbG8=",
          attachmentType: "chat-context",
        },
      ],
    },
  ],
};

describe("queue_store", () => {
  it("returns an empty queue when the file does not exist", () => {
    expect(readPersistedQueue()).toEqual({});
  });

  it("round-trips a queue through write + read", () => {
    writePersistedQueue(sampleQueue);
    expect(fs.existsSync(getQueueFilePath())).toBe(true);
    expect(readPersistedQueue()).toEqual(sampleQueue);
  });

  it("returns an empty queue for a corrupt file instead of throwing", () => {
    fs.writeFileSync(getQueueFilePath(), "{ not valid json");
    expect(readPersistedQueue()).toEqual({});
  });

  it("returns an empty queue for a schema-invalid file", () => {
    fs.writeFileSync(
      getQueueFilePath(),
      JSON.stringify({ "1": [{ missing: "prompt" }] }),
    );
    expect(readPersistedQueue()).toEqual({});
  });

  it("prunes entries whose chat no longer exists", () => {
    mockExistingChatIds([1]); // chat 2 was deleted
    const pruned = pruneDeletedChats(sampleQueue);
    expect(Object.keys(pruned)).toEqual(["1"]);
    expect(pruned["1"]).toEqual(sampleQueue["1"]);
  });

  it("keeps all entries when every chat still exists", () => {
    mockExistingChatIds([1, 2]);
    const pruned = pruneDeletedChats(sampleQueue);
    expect(pruned).toEqual(sampleQueue);
  });

  it("does not query the db for an empty queue", () => {
    const pruned = pruneDeletedChats({});
    expect(pruned).toEqual({});
    expect(getDb).not.toHaveBeenCalled();
  });
});
