import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  claudeUsageGeneration,
  getClaudeUsageLimits,
  recordClaudeUsageLimits,
  setClaudeUsageAccount,
} from "./usage_limits";

const now = 1_789_689_600_000;
const event = (unifiedWindows: unknown) => ({
  type: "rate_limit_event",
  rate_limit_info: { status: "allowed", unifiedWindows },
});
const windows = {
  five_hour: { utilization: 0.07, resetsAt: now / 1000 + 3600 },
  seven_day: { utilization: 0.58, resetsAt: now / 1000 + 86400 },
};
const record = (value: unknown) =>
  recordClaudeUsageLimits(value, claudeUsageGeneration());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  setClaudeUsageAccount(null);
  setClaudeUsageAccount("account-a");
});
afterEach(() => {
  setClaudeUsageAccount(null);
  vi.useRealTimers();
});

it("converts normal allowed-status CLI fractions and seconds into display units", () => {
  record(event(windows));
  expect(getClaudeUsageLimits()).toEqual({
    windows: [
      {
        name: "five_hour",
        usedPercent: expect.closeTo(7),
        resetsAt: now + 3600_000,
      },
      {
        name: "seven_day",
        usedPercent: expect.closeTo(58),
        resetsAt: now + 86400_000,
      },
    ],
    updatedAt: now,
  });
});

it("expires each window independently without inventing zero usage", () => {
  record(event(windows));
  vi.setSystemTime(now + 3600_000);
  expect(getClaudeUsageLimits().windows.map((w) => w.name)).toEqual([
    "seven_day",
  ]);
  vi.setSystemTime(now + 86400_000);
  expect(getClaudeUsageLimits()).toEqual({ windows: [], updatedAt: now });
});

it.each([
  undefined,
  null,
  {},
  { type: "result" },
  event(null),
  event({}),
  event({ five_hour: { utilization: -1, resetsAt: now / 1000 } }),
])(
  "ignores unsupported or malformed events without refreshing old data: %j",
  (value) => {
    record(event(windows));
    const previous = getClaudeUsageLimits();
    vi.setSystemTime(now + 1000);
    expect(() => record(value)).not.toThrow();
    expect(getClaudeUsageLimits()).toEqual(previous);
  },
);

it("accepts zero usage and valid partial snapshots, dropping missing or invalid windows", () => {
  record(event(windows));
  record(
    event({
      five_hour: { ...windows.five_hour, utilization: 0 },
      seven_day: { ...windows.seven_day, utilization: Infinity },
      unknown_bucket: windows.seven_day,
    }),
  );
  expect(getClaudeUsageLimits().windows).toEqual([
    { name: "five_hour", usedPercent: 0, resetsAt: now + 3600_000 },
  ]);
});

it("clears usage on account changes and rejects events from older turns", () => {
  const oldGeneration = claudeUsageGeneration();
  record(event(windows));
  setClaudeUsageAccount("account-a");
  expect(getClaudeUsageLimits().windows).toHaveLength(2);
  setClaudeUsageAccount("account-b");
  recordClaudeUsageLimits(event(windows), oldGeneration);
  expect(getClaudeUsageLimits()).toEqual({ windows: [], updatedAt: null });
  record(event(windows));
  expect(getClaudeUsageLimits().windows).toHaveLength(2);
  setClaudeUsageAccount(null);
  record(event(windows));
  expect(getClaudeUsageLimits()).toEqual({ windows: [], updatedAt: null });
});
