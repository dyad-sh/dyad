import { describe, expect, it } from "vitest";

import {
  collectSystemMemorySignals,
  collectProcessTree,
  parsePsProcessTable,
  parseSwapUsage,
  parseVmStat,
  round2,
  topProcessesByRss,
} from "../utils/process_memory_diagnostics";

const vmStatOutput = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               33882.
Pages active:                            384270.
Pages inactive:                          376297.
Pages speculative:                         5474.
Pages wired down:                        112824.
Pages purgeable:                           1550.
Pages occupied by compressor:            111529.
Pageouts:                                204076.
`;

describe("parsePsProcessTable", () => {
  it("parses ps output, skipping the header and keeping spaces in comm", () => {
    const output = [
      "  PID  PPID    RSS COMM",
      "    1     0  12345 /sbin/launchd",
      "  200     1  54321 /Applications/My App.app/Contents/MacOS/My App",
      "  300   200    999 node",
      "",
    ].join("\n");

    const entries = parsePsProcessTable(output);
    expect(entries).toEqual([
      { pid: 1, ppid: 0, rssKb: 12345, command: "/sbin/launchd" },
      {
        pid: 200,
        ppid: 1,
        rssKb: 54321,
        command: "/Applications/My App.app/Contents/MacOS/My App",
      },
      { pid: 300, ppid: 200, rssKb: 999, command: "node" },
    ]);
  });

  it("returns an empty array for garbage input", () => {
    expect(parsePsProcessTable("not ps output at all")).toEqual([]);
    expect(parsePsProcessTable("")).toEqual([]);
  });
});

describe("collectProcessTree", () => {
  const entries = parsePsProcessTable(
    [
      "  PID  PPID    RSS COMM",
      "    1     0    100 launchd",
      "   10     1    200 node",
      "   11    10    300 node",
      "   12    10    400 esbuild",
      "   13    11    500 vite",
      "   99     1    600 unrelated",
    ].join("\n"),
  );

  it("collects the root and all descendants", () => {
    const tree = collectProcessTree(10, entries);
    expect(tree.map((e) => e.pid).sort((a, b) => a - b)).toEqual([
      10, 11, 12, 13,
    ]);
  });

  it("returns empty when the root pid is not in the snapshot", () => {
    expect(collectProcessTree(4242, entries)).toEqual([]);
  });

  it("does not loop forever on ppid cycles", () => {
    const cyclic = [
      { pid: 5, ppid: 6, rssKb: 1, command: "a" },
      { pid: 6, ppid: 5, rssKb: 2, command: "b" },
    ];
    const tree = collectProcessTree(5, cyclic);
    expect(tree.map((e) => e.pid).sort((a, b) => a - b)).toEqual([5, 6]);
  });
});

describe("parseVmStat", () => {
  it("parses page size and the relevant counters", () => {
    const result = parseVmStat(vmStatOutput);
    expect(result).toEqual({
      pageSizeBytes: 16384,
      freePages: 33882,
      activePages: 384270,
      inactivePages: 376297,
      speculativePages: 5474,
      wiredPages: 112824,
      purgeablePages: 1550,
      compressorPages: 111529,
      pageouts: 204076,
    });
  });

  it("returns null for non-vm_stat output", () => {
    expect(parseVmStat("command not found")).toBeNull();
    expect(parseVmStat("")).toBeNull();
  });
});

describe("collectSystemMemorySignals", () => {
  it("preserves vm_stat diagnostics when swap collection fails", async () => {
    const result = await collectSystemMemorySignals({
      platform: "darwin",
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      freeMemoryBytes: 1024 * 1024 * 1024,
      runCommand: async (file) => {
        if (file === "vm_stat") return vmStatOutput;
        throw new Error("sysctl unavailable");
      },
    });

    expect(result.vmStat?.activePages).toBe(384270);
    expect(result.appMemoryMb).toBeGreaterThan(0);
    expect(result.fallback).toBeUndefined();
    expect(result.error).toContain("Failed to collect swap usage");
  });
});

describe("parseSwapUsage", () => {
  it("parses sysctl vm.swapusage output in MB", () => {
    const result = parseSwapUsage(
      "vm.swapusage: total = 2048.00M  used = 1017.75M  free = 1030.25M  (encrypted)",
    );
    expect(result).toEqual({ totalMb: 2048, usedMb: 1017.75 });
  });

  it("converts G and K suffixes to MB", () => {
    expect(
      parseSwapUsage("vm.swapusage: total = 4.00G  used = 512.00K  free = ..."),
    ).toEqual({ totalMb: 4096, usedMb: 0.5 });
  });

  it("returns null when output does not match", () => {
    expect(parseSwapUsage("vm.swapusage: unavailable")).toBeNull();
    expect(parseSwapUsage("")).toBeNull();
  });
});

describe("topProcessesByRss", () => {
  it("sorts descending by RSS and limits the count", () => {
    const entries = parsePsProcessTable(
      [
        "  PID  PPID    RSS COMM",
        "    1     0    100 low",
        "    2     0    300 high",
        "    3     0    200 mid",
      ].join("\n"),
    );
    const top = topProcessesByRss(entries, 2);
    expect(top).toEqual([
      { pid: 2, rssKb: 300, command: "high" },
      { pid: 3, rssKb: 200, command: "mid" },
    ]);
  });

  it("does not mutate the input array", () => {
    const entries = [
      { pid: 1, ppid: 0, rssKb: 1, command: "a" },
      { pid: 2, ppid: 0, rssKb: 2, command: "b" },
    ];
    topProcessesByRss(entries, 1);
    expect(entries[0].pid).toBe(1);
  });
});

describe("round2", () => {
  it("preserves useful sub-MB precision", () => {
    expect(round2(0.1875)).toBe(0.19);
  });
});
