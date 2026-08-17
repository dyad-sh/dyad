import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCancellationRequestLatch } from "./useCancellationRequestLatch";

describe("useCancellationRequestLatch", () => {
  it("rejects a rapid second request before React publishes the latch", () => {
    const { result } = renderHook(() =>
      useCancellationRequestLatch({
        chatId: 1,
        isStreaming: true,
        isCancellationSettling: false,
      }),
    );

    act(() => {
      expect(result.current.requestCancellation()).toBe(true);
      expect(result.current.requestCancellation()).toBe(false);
    });

    expect(result.current.isCancellationRequested).toBe(true);
  });

  it("clears after the authoritative cancellation settles", async () => {
    const { result, rerender } = renderHook(
      ({ isStreaming, isCancellationSettling }) =>
        useCancellationRequestLatch({
          chatId: 1,
          isStreaming,
          isCancellationSettling,
        }),
      {
        initialProps: {
          isStreaming: true,
          isCancellationSettling: false,
        },
      },
    );

    act(() => {
      result.current.requestCancellation();
    });
    rerender({ isStreaming: true, isCancellationSettling: true });
    expect(result.current.isCancellationRequested).toBe(true);

    rerender({ isStreaming: false, isCancellationSettling: false });
    await waitFor(() => {
      expect(result.current.isCancellationRequested).toBe(false);
    });
  });

  it("does not carry a request into another chat", async () => {
    const { result, rerender } = renderHook(
      ({ chatId }) =>
        useCancellationRequestLatch({
          chatId,
          isStreaming: true,
          isCancellationSettling: false,
        }),
      { initialProps: { chatId: 1 } },
    );

    act(() => {
      result.current.requestCancellation();
    });
    rerender({ chatId: 2 });

    await waitFor(() => {
      expect(result.current.isCancellationRequested).toBe(false);
    });
    expect(result.current.requestCancellation()).toBe(true);
  });
});
