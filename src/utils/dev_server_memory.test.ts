import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEV_SERVER_SAMPLE_INTERVAL_MS,
  getDevServerMemorySample,
  parseWindowsProcessTable,
  resetDevServerMemoryForTesting,
  summarizeDevServerMemory,
} from "@/utils/dev_server_memory";
import {
  parsePsProcessTable,
  type PsProcessEntry,
} from "@/utils/process_memory_diagnostics";

describe("parseWindowsProcessTable", () => {
  it("parses pid, parent pid and private bytes per line", () => {
    const entries = parseWindowsProcessTable(
      [
        "",
        "4 0 0",
        "1234 4 104857600",
        "not a row",
        "5678 1234 52428800",
        "",
      ].join("\r\n"),
    );
    expect(entries).toEqual([
      { pid: 4, ppid: 0, rssKb: 0, command: "" },
      { pid: 1234, ppid: 4, rssKb: 102400, command: "" },
      { pid: 5678, ppid: 1234, rssKb: 51200, command: "" },
    ]);
  });
});

describe("summarizeDevServerMemory", () => {
  // Two dev servers: pid 100 (npm -> node -> esbuild) and pid 200 (npm ->
  // node), plus an unrelated process the trees must not pick up.
  const entries = parsePsProcessTable(
    [
      "  PID  PPID   RSS COMM",
      "  100     1 10240 npm",
      "  101   100 204800 node",
      "  102   101 51200 esbuild",
      "  200     1 10240 npm",
      "  201   200 102400 node",
      "  300     1 999999 chrome",
    ].join("\n"),
  );

  it("sums each dev server's whole process tree", () => {
    expect(summarizeDevServerMemory([100, 200], entries, 1234)).toEqual({
      sampledAt: 1234,
      count: 2,
      totalMB: 370,
      maxMB: 260,
      maxProcessCount: 3,
    });
  });

  it("skips a root that has already exited", () => {
    expect(summarizeDevServerMemory([100, 999], entries, 1234)).toEqual({
      sampledAt: 1234,
      count: 1,
      totalMB: 260,
      maxMB: 260,
      maxProcessCount: 3,
    });
  });

  it("reports zeros with no dev servers", () => {
    expect(summarizeDevServerMemory([], entries, 1234)).toEqual({
      sampledAt: 1234,
      count: 0,
      totalMB: 0,
      maxMB: 0,
      maxProcessCount: 0,
    });
  });
});

describe("summarizeDevServerMemory with a vanished root", () => {
  it("does not count an orphaned child as a live dev server", () => {
    // The root exited but its child survived and still names it as
    // parent; the tree walk alone would find that child.
    const entries = parsePsProcessTable(
      ["  101   100 204800 node", "  300     1 999999 chrome"].join("\n"),
    );
    expect(summarizeDevServerMemory([100], entries, 1).count).toBe(0);
  });
});

describe("getDevServerMemorySample", () => {
  beforeEach(() => {
    resetDevServerMemoryForTesting();
  });

  const entriesFor = (pids: number[]) =>
    pids.map((pid) => ({ pid, ppid: 1, rssKb: 1024 * 100, command: "node" }));

  // Lets the sampler's then/finally chain settle after a snapshot resolves.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function deferredSnapshot() {
    let resolve!: (entries: PsProcessEntry[]) => void;
    const promise = new Promise<PsProcessEntry[]>((r) => {
      resolve = r;
    });
    return { snapshot: () => promise, resolve };
  }

  it("answers zeros at once with no dev servers and no shell-out", () => {
    const snapshot = vi.fn();
    expect(
      getDevServerMemorySample({ rootPids: [], now: 1000, snapshot }),
    ).toEqual({
      sampledAt: 1000,
      count: 0,
      totalMB: 0,
      maxMB: 0,
      maxProcessCount: 0,
    });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("samples as soon as the pid set changes, not on the interval", async () => {
    const first = deferredSnapshot();
    expect(
      getDevServerMemorySample({
        rootPids: [100],
        now: 1000,
        snapshot: first.snapshot,
      }),
    ).toBeNull();
    first.resolve(entriesFor([100]));
    await flush();
    expect(
      getDevServerMemorySample({
        rootPids: [100],
        now: 2000,
        snapshot: first.snapshot,
      }),
    ).toMatchObject({ count: 1, totalMB: 100 });

    // A second dev server starts: a fresh sample runs immediately, and the
    // old one is not reported for the new set in the meantime.
    const second = deferredSnapshot();
    expect(
      getDevServerMemorySample({
        rootPids: [100, 200],
        now: 3000,
        snapshot: second.snapshot,
      }),
    ).toBeNull();
    second.resolve(entriesFor([100, 200]));
    await flush();
    expect(
      getDevServerMemorySample({
        rootPids: [100, 200],
        now: 4000,
        snapshot: second.snapshot,
      }),
    ).toMatchObject({ sampledAt: 3000, count: 2, totalMB: 200 });
  });

  it("discards a snapshot that finishes after the pid set moved on", async () => {
    const stale = deferredSnapshot();
    getDevServerMemorySample({
      rootPids: [100],
      now: 1000,
      snapshot: stale.snapshot,
    });
    // The app stopped while the snapshot was running.
    getDevServerMemorySample({
      rootPids: [],
      now: 2000,
      snapshot: stale.snapshot,
    });
    stale.resolve(entriesFor([100]));
    await flush();
    expect(
      getDevServerMemorySample({
        rootPids: [],
        now: 3000,
        snapshot: stale.snapshot,
      }),
    ).toMatchObject({ count: 0 });
  });

  it("resamples an unchanged pid set only after the interval", async () => {
    const snapshot = vi.fn(async () => entriesFor([100]));
    getDevServerMemorySample({ rootPids: [100], now: 0, snapshot });
    await flush();
    getDevServerMemorySample({ rootPids: [100], now: 30_000, snapshot });
    expect(snapshot).toHaveBeenCalledTimes(1);
    getDevServerMemorySample({
      rootPids: [100],
      now: DEV_SERVER_SAMPLE_INTERVAL_MS,
      snapshot,
    });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("waits for the interval before retrying a failed snapshot", async () => {
    // A broken shell-out (PowerShell blocked, timeout) must not respawn on
    // every heartbeat just because no sample for this set exists yet.
    const snapshot = vi.fn(async () => {
      throw new Error("powershell unavailable");
    });
    expect(
      getDevServerMemorySample({ rootPids: [100], now: 0, snapshot }),
    ).toBeNull();
    await flush();
    getDevServerMemorySample({ rootPids: [100], now: 30_000, snapshot });
    getDevServerMemorySample({ rootPids: [100], now: 60_000, snapshot });
    expect(snapshot).toHaveBeenCalledTimes(1);
    getDevServerMemorySample({
      rootPids: [100],
      now: DEV_SERVER_SAMPLE_INTERVAL_MS,
      snapshot,
    });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});
