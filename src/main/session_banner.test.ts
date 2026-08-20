import { describe, it, expect } from "vitest";
import {
  formatErrorBanner,
  formatExitBanner,
  formatPreviousSessionBanner,
  formatStartBanner,
  formatTimestamp,
  formatUptime,
} from "./session_banner";

describe("formatUptime", () => {
  it("shows seconds under a minute", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(999)).toBe("0s");
    expect(formatUptime(1000)).toBe("1s");
    expect(formatUptime(59_000)).toBe("59s");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(formatUptime(60_000)).toBe("1m0s");
    expect(formatUptime(252_000)).toBe("4m12s");
    expect(formatUptime(3_599_000)).toBe("59m59s");
  });

  it("drops seconds once past an hour", () => {
    expect(formatUptime(3_600_000)).toBe("1h0m");
    expect(formatUptime(28_560_000)).toBe("7h56m");
  });

  it("shows days for long sessions", () => {
    expect(formatUptime(86_400_000)).toBe("1d0h0m");
    expect(formatUptime(273_600_000)).toBe("3d4h0m");
  });

  it("returns unknown rather than nonsense for bad input", () => {
    expect(formatUptime(-1)).toBe("unknown");
    expect(formatUptime(Number.NaN)).toBe("unknown");
    expect(formatUptime(Number.POSITIVE_INFINITY)).toBe("unknown");
  });
});

describe("formatTimestamp", () => {
  it("matches electron-log's prefix format in local time", () => {
    const local = new Date(2026, 7, 17, 0, 39, 48, 628);
    expect(formatTimestamp(local.getTime())).toBe("2026-08-17 00:39:48.628");
  });

  it("pads every field", () => {
    const local = new Date(2026, 0, 2, 3, 4, 5, 6);
    expect(formatTimestamp(local.getTime())).toBe("2026-01-02 03:04:05.006");
  });
});

describe("banners", () => {
  it("are all found by a single grep for the marker", () => {
    const lines = [
      formatStartBanner({
        pid: 4821,
        version: "1.11.0-beta.1",
        platform: "linux",
        arch: "x64",
        electron: "38.0.0",
        node: "20.19.0",
      }),
      formatExitBanner(4821, "exitCode=0", 28_560_000),
      formatExitBanner(4821, "duplicate instance"),
      formatErrorBanner(4821, "uncaughtException", 252_000),
      formatPreviousSessionBanner(
        new Date(2026, 7, 17, 0, 39, 48, 628).getTime(),
      ),
    ];
    for (const line of lines) {
      expect(line).toContain("===== Dyad ");
      expect(line.split("\n")).toHaveLength(1);
    }
  });

  it("includes the launch details in the start banner", () => {
    expect(
      formatStartBanner({
        pid: 4821,
        version: "1.11.0-beta.1",
        platform: "linux",
        arch: "x64",
        electron: "38.0.0",
        node: "20.19.0",
      }),
    ).toBe(
      "===== Dyad started | pid 4821 | 1.11.0-beta.1 | linux x64 | electron 38.0.0 | node 20.19.0 =====",
    );
  });

  it("omits uptime when it isn't known", () => {
    expect(formatExitBanner(4821, "duplicate instance")).toBe(
      "===== Dyad exiting | pid 4821 | duplicate instance =====",
    );
    expect(formatExitBanner(4821, "exitCode=0", 28_560_000)).toBe(
      "===== Dyad exiting | pid 4821 | exitCode=0 | uptime 7h56m =====",
    );
  });

  it("pairs a second instance's banners by pid, not by position", () => {
    // A duplicate launch writes its pair into the running session's log.
    const live = formatStartBanner({
      pid: 3310,
      version: "1.11.0-beta.1",
      platform: "linux",
      arch: "x64",
      electron: "38.0.0",
      node: "20.19.0",
    });
    const intruder = formatExitBanner(4821, "duplicate instance");
    expect(live).toContain("pid 3310");
    expect(intruder).toContain("pid 4821");
  });

  it("names the error kind and how long the session had been up", () => {
    expect(formatErrorBanner(4821, "uncaughtException", 252_000)).toBe(
      "===== Dyad main-process error | pid 4821 | uncaughtException | uptime 4m12s =====",
    );
  });

  it("says so when the lost session's start time is unavailable", () => {
    expect(formatPreviousSessionBanner(undefined)).toBe(
      "===== Dyad previous session ended unexpectedly | start time unknown =====",
    );
  });

  it("approximates the lost session's uptime from its last sample", () => {
    const started = new Date(2026, 7, 17, 0, 39, 48, 628).getTime();
    expect(formatPreviousSessionBanner(started, started + 28_560_000)).toBe(
      "===== Dyad previous session ended unexpectedly | started 2026-08-17 00:39:48.628 | ran ~7h56m =====",
    );
  });

  it("does not claim a bound when the sample predates the session", () => {
    const started = new Date(2026, 7, 17, 0, 39, 48, 628).getTime();
    // Left over from an earlier run, so this session never sampled.
    expect(formatPreviousSessionBanner(started, started - 5_000)).toBe(
      "===== Dyad previous session ended unexpectedly | started 2026-08-17 00:39:48.628 | uptime unknown (ended before its first sample) =====",
    );
    expect(formatPreviousSessionBanner(started, started)).toContain(
      "uptime unknown",
    );
  });

  it("omits uptime when either end of the interval is missing", () => {
    const started = new Date(2026, 7, 17, 0, 39, 48, 628).getTime();
    expect(formatPreviousSessionBanner(started)).toBe(
      "===== Dyad previous session ended unexpectedly | started 2026-08-17 00:39:48.628 =====",
    );
    expect(formatPreviousSessionBanner(undefined, started)).not.toContain(
      "ran",
    );
  });
});
