// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disposeAll: vi.fn<() => Promise<void>>(),
}));

vi.mock("./mcp_manager", () => ({
  mcpManager: {
    disposeAll: mocks.disposeAll,
  },
}));

const { createMcpBeforeQuitHandler, disposeMcpClientsForShutdown } =
  await import("./mcp_shutdown");

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

it("starts MCP shutdown cleanup exactly once", async () => {
  const cleanup = Promise.resolve();
  mocks.disposeAll.mockReturnValue(cleanup);

  const first = disposeMcpClientsForShutdown();
  const second = disposeMcpClientsForShutdown();

  expect(first).toBe(cleanup);
  expect(second).toBe(cleanup);
  expect(mocks.disposeAll).toHaveBeenCalledTimes(1);
  await expect(first).resolves.toBeUndefined();
});

describe("createMcpBeforeQuitHandler", () => {
  it("prevents quit until cleanup settles and resumes quit exactly once", async () => {
    const pendingCleanup = deferred();
    const cleanup = vi.fn(() => pendingCleanup.promise);
    const quit = vi.fn();
    const handler = createMcpBeforeQuitHandler({ cleanup, quit });
    const firstEvent = { preventDefault: vi.fn() };
    const duplicateEvent = { preventDefault: vi.fn() };

    handler(firstEvent);
    handler(duplicateEvent);
    await Promise.resolve();

    expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(duplicateEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();

    pendingCleanup.resolve();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

    const resumedQuitEvent = { preventDefault: vi.fn() };
    handler(resumedQuitEvent);
    expect(resumedQuitEvent.preventDefault).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("resumes quit after the safety timeout when cleanup hangs", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn(() => new Promise<void>(() => {}));
      const quit = vi.fn();
      const handler = createMcpBeforeQuitHandler({
        cleanup,
        quit,
        timeoutMs: 25,
      });
      const event = { preventDefault: vi.fn() };

      handler(event);
      await vi.advanceTimersByTimeAsync(25);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(quit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
