import {
  isRateLimitError,
  retryWithRateLimit,
} from "@/ipc/utils/retryWithRateLimit";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("isRateLimitError", () => {
  describe("returns true for rate limit errors", () => {
    it("should return true for error with response.status === 429", () => {
      const error = { response: { status: 429 } };
      expect(isRateLimitError(error)).toBe(true);
    });

    it("should return true for error with additional properties", () => {
      const error = {
        message: "Rate limited",
        response: { status: 429, data: { error: "Too many requests" } },
      };
      expect(isRateLimitError(error)).toBe(true);
    });
  });

  describe("returns false for non-rate-limit errors", () => {
    it("should return false for 400 status", () => {
      const error = { response: { status: 400 } };
      expect(isRateLimitError(error)).toBe(false);
    });

    it("should return false for 401 status", () => {
      const error = { response: { status: 401 } };
      expect(isRateLimitError(error)).toBe(false);
    });

    it("should return false for 403 status", () => {
      const error = { response: { status: 403 } };
      expect(isRateLimitError(error)).toBe(false);
    });

    it("should return false for 404 status", () => {
      const error = { response: { status: 404 } };
      expect(isRateLimitError(error)).toBe(false);
    });

    it("should return false for 500 status", () => {
      const error = { response: { status: 500 } };
      expect(isRateLimitError(error)).toBe(false);
    });

    it("should return false for 503 status", () => {
      const error = { response: { status: 503 } };
      expect(isRateLimitError(error)).toBe(false);
    });
  });

  describe("returns false for invalid error shapes", () => {
    it("should return false for null", () => {
      expect(isRateLimitError(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isRateLimitError(undefined)).toBe(false);
    });

    it("should return false for empty object", () => {
      expect(isRateLimitError({})).toBe(false);
    });

    it("should return false for error without response", () => {
      const error = { message: "Something went wrong" };
      expect(isRateLimitError(error)).toBe(false);
    });

    it("should return false for error with null response", () => {
      const error = { response: null };
      expect(isRateLimitError(error)).toBe(false);
    });

    it("should return false for error with response but no status", () => {
      const error = { response: { data: "error" } };
      expect(isRateLimitError(error)).toBe(false);
    });

    it("should return false for string error", () => {
      expect(isRateLimitError("Rate limited")).toBe(false);
    });

    it("should return false for Error instance without response", () => {
      expect(isRateLimitError(new Error("Rate limited"))).toBe(false);
    });
  });
});

describe("retryWithRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("successful operations", () => {
    it("should return result on first successful attempt", async () => {
      const operation = vi.fn().mockResolvedValue("success");

      const resultPromise = retryWithRateLimit(operation, "test-operation");
      const result = await resultPromise;

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should return result after retry on rate limit then success", async () => {
      const rateLimitError = { response: { status: 429 } };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce("success after retry");

      const resultPromise = retryWithRateLimit(operation, "test-operation");

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(0);

      // Wait for the retry delay
      await vi.advanceTimersByTimeAsync(3000);

      const result = await resultPromise;

      expect(result).toBe("success after retry");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should succeed after multiple rate limit errors", async () => {
      const rateLimitError = { response: { status: 429 } };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce("success after 3 retries");

      const resultPromise = retryWithRateLimit(operation, "test-operation");

      // Advance through all retry delays
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3000); // First retry
      await vi.advanceTimersByTimeAsync(5000); // Second retry
      await vi.advanceTimersByTimeAsync(10000); // Third retry

      const result = await resultPromise;

      expect(result).toBe("success after 3 retries");
      expect(operation).toHaveBeenCalledTimes(4);
    });
  });

  describe("non-rate-limit errors", () => {
    it("should throw immediately for 400 error", async () => {
      const badRequestError = { response: { status: 400 } };
      const operation = vi.fn().mockRejectedValue(badRequestError);

      await expect(
        retryWithRateLimit(operation, "test-operation"),
      ).rejects.toEqual(badRequestError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately for 500 error", async () => {
      const serverError = { response: { status: 500 } };
      const operation = vi.fn().mockRejectedValue(serverError);

      await expect(
        retryWithRateLimit(operation, "test-operation"),
      ).rejects.toEqual(serverError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately for generic Error", async () => {
      const error = new Error("Network failure");
      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        retryWithRateLimit(operation, "test-operation"),
      ).rejects.toThrow("Network failure");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately for error without response", async () => {
      const error = { message: "Connection timeout" };
      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        retryWithRateLimit(operation, "test-operation"),
      ).rejects.toEqual(error);
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe("exhausted retries", () => {
    it("should throw after max retries are exhausted", async () => {
      const rateLimitError = { response: { status: 429 } };
      const operation = vi.fn().mockRejectedValue(rateLimitError);

      const resultPromise = retryWithRateLimit(operation, "test-operation", {
        maxRetries: 2,
        baseDelay: 100,
      });

      // Attach rejection handler BEFORE running timers to avoid unhandled rejection
      const expectation = expect(resultPromise).rejects.toEqual(rateLimitError);

      // Run all timers to completion
      await vi.runAllTimersAsync();

      await expectation;
      expect(operation).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("should throw after default max retries (6)", async () => {
      const rateLimitError = { response: { status: 429 } };
      const operation = vi.fn().mockRejectedValue(rateLimitError);

      const resultPromise = retryWithRateLimit(operation, "test-operation", {
        baseDelay: 100,
      });

      // Attach rejection handler BEFORE running timers to avoid unhandled rejection
      const expectation = expect(resultPromise).rejects.toEqual(rateLimitError);

      // Run all timers to completion
      await vi.runAllTimersAsync();

      await expectation;
      expect(operation).toHaveBeenCalledTimes(7); // 1 initial + 6 retries
    });
  });

  describe("custom options", () => {
    it("should respect custom maxRetries", async () => {
      const rateLimitError = { response: { status: 429 } };
      const operation = vi.fn().mockRejectedValue(rateLimitError);

      const resultPromise = retryWithRateLimit(operation, "test-operation", {
        maxRetries: 1,
        baseDelay: 100,
      });

      // Attach rejection handler BEFORE running timers to avoid unhandled rejection
      const expectation = expect(resultPromise).rejects.toEqual(rateLimitError);

      // Run all timers to completion
      await vi.runAllTimersAsync();

      await expectation;
      expect(operation).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });

    it("should respect custom baseDelay", async () => {
      const rateLimitError = { response: { status: 429 } };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce("success");

      const resultPromise = retryWithRateLimit(operation, "test-operation", {
        baseDelay: 5000,
      });

      await vi.advanceTimersByTimeAsync(0);

      // Should not have retried yet (baseDelay is 5000ms)
      await vi.advanceTimersByTimeAsync(4000);
      expect(operation).toHaveBeenCalledTimes(1);

      // Now it should retry
      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should cap delay at maxDelay", async () => {
      const rateLimitError = { response: { status: 429 } };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError) // attempt 0
        .mockRejectedValueOnce(rateLimitError) // attempt 1
        .mockRejectedValueOnce(rateLimitError) // attempt 2
        .mockRejectedValueOnce(rateLimitError) // attempt 3
        .mockResolvedValueOnce("success"); // attempt 4

      const resultPromise = retryWithRateLimit(operation, "test-operation", {
        baseDelay: 1000,
        maxDelay: 5000,
        maxRetries: 10,
      });

      // Advance through retries - delays should be capped at maxDelay
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(6000);
      }

      const result = await resultPromise;
      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(5);
    });

    it("should use defaults when options is undefined", async () => {
      const operation = vi.fn().mockResolvedValue("success");

      const result = await retryWithRateLimit(operation, "test-operation");

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should use defaults for unspecified options", async () => {
      const rateLimitError = { response: { status: 429 } };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce("success");

      const resultPromise = retryWithRateLimit(operation, "test-operation", {
        maxRetries: 3,
        // baseDelay and maxDelay should use defaults
      });

      // Default baseDelay is 2000ms
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3000);

      const result = await resultPromise;
      expect(result).toBe("success");
    });
  });

  describe("return types", () => {
    it("should preserve return type for objects", async () => {
      const data = { id: 1, name: "test" };
      const operation = vi.fn().mockResolvedValue(data);

      const result = await retryWithRateLimit(operation, "test-operation");

      expect(result).toEqual(data);
    });

    it("should preserve return type for arrays", async () => {
      const data = [1, 2, 3];
      const operation = vi.fn().mockResolvedValue(data);

      const result = await retryWithRateLimit(operation, "test-operation");

      expect(result).toEqual(data);
    });

    it("should preserve return type for null", async () => {
      const operation = vi.fn().mockResolvedValue(null);

      const result = await retryWithRateLimit(operation, "test-operation");

      expect(result).toBeNull();
    });

    it("should preserve return type for undefined", async () => {
      const operation = vi.fn().mockResolvedValue(undefined);

      const result = await retryWithRateLimit(operation, "test-operation");

      expect(result).toBeUndefined();
    });
  });
});
