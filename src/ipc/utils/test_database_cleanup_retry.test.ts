import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryTestDatabaseCleanup } from "./test_database_cleanup_retry";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn }) },
}));

function networkError(code: string) {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("Connection failed"), { code }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("retryTestDatabaseCleanup", () => {
  it.each([true, false])(
    "unwraps Neon's sourceError (network code present: %s)",
    async (withCode) => {
      const sourceError = withCode
        ? networkError("UND_ERR_CONNECT_TIMEOUT")
        : new TypeError("fetch failed");
      const error = Object.assign(
        new Error("Error connecting to database: fetch failed"),
        { sourceError },
      );
      const operation = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue("clean");
      const pending = retryTestDatabaseCleanup(
        operation,
        "Clear Neon test data",
      );
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe("clean");
      expect(operation).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    "ECONNRESET",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
  ])("recovers from %s and logs the underlying network code", async (code) => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(networkError(code))
      .mockResolvedValue("clean");
    const pending = retryTestDatabaseCleanup(operation, "Delete test user");
    await vi.advanceTimersByTimeAsync(999);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("clean");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(code));
  });

  it("retries a fetch failure with no diagnostic cause", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue("clean");
    const pending = retryTestDatabaseCleanup(operation, "Delete test user");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("clean");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("recognizes aggregate connection failures from multiple addresses", async () => {
    const error = new TypeError("fetch failed", {
      cause: new AggregateError([
        Object.assign(new Error("IPv4 failed"), { code: "ETIMEDOUT" }),
        Object.assign(new Error("IPv6 failed"), { code: "ENETUNREACH" }),
      ]),
    });
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("clean");
    const pending = retryTestDatabaseCleanup(operation, "Delete test user");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("clean");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("ETIMEDOUT, ENETUNREACH"),
    );
  });

  it("stops after three retries with increasing delays", async () => {
    const error = networkError("ECONNRESET");
    const operation = vi.fn().mockRejectedValue(error);
    const rejected = expect(
      retryTestDatabaseCleanup(operation, "Delete test user"),
    ).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(operation).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    await rejected;
    expect(operation).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringContaining("not retrying"),
    );
  });

  it.each([
    new Error("HTTP 401 Unauthorized"),
    new Error("foreign key constraint violation"),
    new TypeError("Invalid URL"),
    networkError("CERT_HAS_EXPIRED"),
    new DOMException("Stopped", "AbortError"),
  ])("does not retry permanent errors or cancellation: %s", async (error) => {
    const operation = vi.fn().mockRejectedValue(error);
    await expect(
      retryTestDatabaseCleanup(operation, "Delete test user"),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a request after cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("Test run stopped");
    controller.abort(reason);
    const operation = vi.fn();
    await expect(
      retryTestDatabaseCleanup(
        operation,
        "Delete test user",
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(operation).not.toHaveBeenCalled();
  });

  it("interrupts backoff and preserves the lifecycle shutdown reason", async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    const reason = new Error("Test case lifecycle is closing.");
    const retrying = new Promise<void>((resolve) =>
      warn.mockImplementationOnce(() => resolve()),
    );
    const operation = vi.fn().mockRejectedValue(networkError("ECONNRESET"));
    const rejected = expect(
      retryTestDatabaseCleanup(
        operation,
        "Delete test user",
        controller.signal,
      ),
    ).rejects.toBe(reason);
    await retrying;
    controller.abort(reason);
    await rejected;
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
