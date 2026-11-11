// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mocks.exec,
  }),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  access: vi.fn().mockResolvedValue(undefined),
}));
import { claudeStatus, isClaudeVersionSupported } from "./runtime";
beforeEach(() => {
  vi.useFakeTimers();
  mocks.exec.mockReset();
});
afterEach(() => vi.useRealTimers());
it.each(["2.1.259", "2.1.275", "2.2.0", "3.0.0"])(
  "admits %s subject to runtime inventory validation",
  (version) => expect(isClaudeVersionSupported(version)).toBe(true),
);
it.each(["unknown", "1.9.0", "2.0.999", "2.1.258"])(
  "rejects unsupported %s",
  (version) => expect(isClaudeVersionSupported(version)).toBe(false),
);
it("coalesces concurrent probes and shares a bounded main-process cache", async () => {
  mocks.exec.mockImplementation(async (_file, args) => ({
    stdout:
      args[0] === "--version"
        ? "2.2.0"
        : JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
  }));
  const statuses = await Promise.all([
    claudeStatus(),
    claudeStatus(),
    claudeStatus(),
  ]);
  expect(mocks.exec).toHaveBeenCalledTimes(2);
  expect(statuses[0]).toMatchObject({ connected: true, compatible: true });
  await claudeStatus();
  expect(mocks.exec).toHaveBeenCalledTimes(2);
  await claudeStatus({ force: true });
  expect(mocks.exec).toHaveBeenCalledTimes(4);
  vi.advanceTimersByTime(30_001);
  await claudeStatus();
  expect(mocks.exec).toHaveBeenCalledTimes(6);
});
