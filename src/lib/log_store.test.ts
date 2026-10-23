import { afterEach, describe, expect, it } from "vitest";
import type { ConsoleEntry } from "@/ipc/types";
import {
  addLog,
  addLogs,
  clearLogs,
  getLogs,
  MAX_LOGS_PER_APP,
} from "./log_store";

function entry(appId: number, message: string): ConsoleEntry {
  return {
    level: "info",
    type: "client",
    message,
    timestamp: 0,
    appId,
  };
}

describe("log_store", () => {
  afterEach(() => {
    clearLogs(1);
    clearLogs(2);
  });

  it("appends batched entries in order, per app", () => {
    addLog(entry(1, "a"));
    addLogs([entry(1, "b"), entry(2, "x"), entry(1, "c")]);

    expect(getLogs(1).map((log) => log.message)).toEqual(["a", "b", "c"]);
    expect(getLogs(2).map((log) => log.message)).toEqual(["x"]);
  });

  it("keeps only the newest MAX_LOGS_PER_APP entries after a large batch", () => {
    addLog(entry(1, "old"));
    const batch = Array.from({ length: MAX_LOGS_PER_APP + 5 }, (_, i) =>
      entry(1, `m${i}`),
    );
    addLogs(batch);

    const logs = getLogs(1);
    expect(logs).toHaveLength(MAX_LOGS_PER_APP);
    expect(logs[0].message).toBe("m5");
    expect(logs.at(-1)?.message).toBe(`m${MAX_LOGS_PER_APP + 4}`);
  });
});
