import type { ConsoleEntry } from "@/ipc/types";
import {
  getPreviewConsoleEntryByteLength,
  MAX_PREVIEW_CONSOLE_BYTES_PER_APP,
  MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP,
  MAX_PREVIEW_CONSOLE_MESSAGE_BYTES,
  MAX_PREVIEW_CONSOLE_SOURCE_NAME_BYTES,
  PREVIEW_CONSOLE_OMISSION_MESSAGE,
} from "@/lib/preview_console_buffer";
import { describe, expect, it } from "vitest";
import { PreviewConsoleStore } from "./store";

function consoleEntry(
  message: string,
  timestamp: number,
  appId = 1,
  sourceName?: string,
): ConsoleEntry {
  return {
    level: "info",
    type: "server",
    message,
    timestamp,
    appId,
    sourceName,
  };
}

describe("PreviewConsoleStore", () => {
  it("keeps the newest entries when a batch exceeds the count limit", () => {
    const store = new PreviewConsoleStore();
    const entries = Array.from(
      { length: MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP + 2 },
      (_, index) => consoleEntry(`log-${index}`, index),
    );

    store.append(1, entries);

    const retained = store.getSnapshot(1);
    expect(retained).toHaveLength(MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP);
    expect(retained[0].message).toBe(PREVIEW_CONSOLE_OMISSION_MESSAGE);
    expect(retained[1].message).toBe("log-3");
    expect(retained[0].timestamp).toBe(retained[1].timestamp);
    expect(retained.at(-1)?.message).toBe(
      `log-${MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP + 1}`,
    );
  });

  it("keeps the newest entries within the UTF-8 byte budget", () => {
    const store = new PreviewConsoleStore();
    const entryCount =
      Math.floor(
        MAX_PREVIEW_CONSOLE_BYTES_PER_APP / MAX_PREVIEW_CONSOLE_MESSAGE_BYTES,
      ) + 2;
    store.append(
      1,
      Array.from({ length: entryCount }, (_, index) =>
        consoleEntry("x".repeat(MAX_PREVIEW_CONSOLE_MESSAGE_BYTES), index),
      ),
    );

    const retained = store.getSnapshot(1);
    expect(
      retained.reduce(
        (total, entry) => total + getPreviewConsoleEntryByteLength(entry),
        0,
      ),
    ).toBeLessThanOrEqual(MAX_PREVIEW_CONSOLE_BYTES_PER_APP);
    expect(retained[0].message).toBe(PREVIEW_CONSOLE_OMISSION_MESSAGE);
    expect(retained.at(-1)?.timestamp).toBe(entryCount - 1);
  });

  it("truncates giant multibyte fields with explicit markers", () => {
    const store = new PreviewConsoleStore();
    store.append(1, [
      consoleEntry(
        "🙂".repeat(MAX_PREVIEW_CONSOLE_MESSAGE_BYTES),
        1,
        1,
        "源".repeat(MAX_PREVIEW_CONSOLE_SOURCE_NAME_BYTES),
      ),
    ]);

    const [retained] = store.getSnapshot(1);
    expect(getPreviewConsoleEntryByteLength(retained)).toBeLessThanOrEqual(
      MAX_PREVIEW_CONSOLE_MESSAGE_BYTES + MAX_PREVIEW_CONSOLE_SOURCE_NAME_BYTES,
    );
    expect(retained.message).toContain("[log payload truncated]");
    expect(retained.sourceName).toContain("[source truncated]");
  });

  it("preserves delivery order across append batches", () => {
    const store = new PreviewConsoleStore();
    store.append(1, [consoleEntry("first", 300), consoleEntry("second", 100)]);
    store.append(1, [consoleEntry("third", 200), consoleEntry("fourth", 50)]);

    expect(store.getSnapshot(1).map((entry) => entry.message)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("disposes only the requested app buffer", () => {
    const store = new PreviewConsoleStore();
    store.append(1, [consoleEntry("one", 1)]);
    store.append(2, [consoleEntry("two", 2, 2)]);

    store.disposeKey(1);

    expect(store.getSnapshot(1)).toEqual([]);
    expect(store.getSnapshot(2).map((entry) => entry.message)).toEqual(["two"]);
  });
});
