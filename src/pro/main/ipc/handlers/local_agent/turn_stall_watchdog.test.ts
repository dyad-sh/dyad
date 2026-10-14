import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ info: [] as string[], warn: [] as string[] }));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: (message: string) => logs.info.push(message),
      warn: (message: string) => logs.warn.push(message),
    }),
  },
}));

const { startTurnStallWatchdog } = await import("./turn_stall_watchdog");

describe("startTurnStallWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logs.info.length = 0;
    logs.warn.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays silent when model output arrives in time", () => {
    const watchdog = startTurnStallWatchdog(7);
    vi.advanceTimersByTime(29_000);
    watchdog.stop();
    vi.advanceTimersByTime(10 * 60_000);

    expect(logs.warn).toEqual([]);
    expect(logs.info).toEqual([]);
  });

  it("names the phase a stuck turn is in, backing off between warnings", () => {
    const watchdog = startTurnStallWatchdog(7);
    vi.advanceTimersByTime(5_000);
    watchdog.setPhase("loading MCP tools");

    vi.advanceTimersByTime(25_000);
    expect(logs.warn).toEqual([
      'Chat 7: no model output after 30s; in phase "loading MCP tools" for 25s',
    ]);

    // Next warnings at +60s and +120s, not every 30s.
    vi.advanceTimersByTime(59_000);
    expect(logs.warn).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(logs.warn[1]).toBe(
      'Chat 7: no model output after 90s; in phase "loading MCP tools" for 85s',
    );
    vi.advanceTimersByTime(120_000);
    expect(logs.warn).toHaveLength(3);

    watchdog.stop();
    expect(logs.info).toEqual([
      'Chat 7: stall ended after 210s in phase "loading MCP tools"',
    ]);
  });

  it("caps the warning interval at ten minutes", () => {
    startTurnStallWatchdog(7, { firstWarningMs: 8 * 60_000 }).setPhase(
      "waiting for model response",
    );
    vi.advanceTimersByTime(8 * 60_000);
    expect(logs.warn).toHaveLength(1);

    // Doubling would give 16m; the cap keeps it at 10m.
    vi.advanceTimersByTime(10 * 60_000);
    expect(logs.warn).toHaveLength(2);
  });
});
