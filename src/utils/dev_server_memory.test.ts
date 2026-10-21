import { describe, it, expect } from "vitest";
import {
  parseWindowsProcessTable,
  summarizeDevServerMemory,
} from "@/utils/dev_server_memory";
import { parsePsProcessTable } from "@/utils/process_memory_diagnostics";

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
