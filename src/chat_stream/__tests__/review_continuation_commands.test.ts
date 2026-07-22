import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  reviewBarrierHeldByIdAtom,
  queuedMessagesByIdAtom,
  streamReviewEligibleByIdAtom,
} from "@/atoms/chatAtoms";
import {
  clearPendingReviewContinuation,
  hasPendingReviewContinuation,
  setPendingReviewContinuation,
} from "@/hooks/subagentReviewContinuation";

const mocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  release: vi.fn(),
  runAutoReviewBarrier: vi.fn(),
  skipReviewAutoFix: vi.fn(),
}));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    agent: {
      runAutoReviewBarrier: mocks.runAutoReviewBarrier,
      skipReviewAutoFix: mocks.skipReviewAutoFix,
    },
    chat: {
      getChat: mocks.getChat,
    },
    chatStream: {
      release: mocks.release,
    },
  },
}));

import {
  productionChatStreamCommands,
  registerChatStreamRuntimeDeps,
} from "../commands";
import type { StreamEvent } from "../state";

function setup(chatId: number) {
  const store = createStore();
  registerChatStreamRuntimeDeps({
    store,
    queryClient: new QueryClient(),
    getSettings: () => undefined,
    getPosthog: () => null,
  });
  mocks.getChat.mockResolvedValue({ id: chatId, messages: [] });
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const chatId of [31, 32, 33]) {
    clearPendingReviewContinuation(chatId);
  }
});

describe("review continuation terminal handling", () => {
  it("keeps the Continue stream successful when verification rejects", async () => {
    const chatId = 31;
    const store = setup(chatId);
    store.set(
      queuedMessagesByIdAtom,
      new Map([[chatId, [{ id: "q", prompt: "queued" }]]]),
    );
    store.set(streamReviewEligibleByIdAtom, new Map([[chatId, true]]));
    mocks.runAutoReviewBarrier
      .mockResolvedValueOnce({
        outcome: "fix_required",
        threadId: "review-1",
        prompt: "fix it",
      })
      .mockRejectedValueOnce(new Error("verification unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    let remediationRequest:
      | Extract<StreamEvent, { type: "submit" }>
      | undefined;
    productionChatStreamCommands.dispatchNextQueued({
      chatId,
      emit: (event) => {
        if (event.type === "submit") remediationRequest = event;
      },
    });
    await vi.waitFor(() => expect(remediationRequest).toBeDefined());
    if (!remediationRequest || remediationRequest.type !== "submit") {
      throw new Error("Expected remediation submission");
    }
    remediationRequest.request.onSettled?.({
      success: false,
      pausedByStepLimit: true,
    });
    await vi.waitFor(() =>
      expect(hasPendingReviewContinuation(chatId)).toBe(true),
    );

    const onSettled = vi.fn();
    await productionChatStreamCommands.runEndSideEffects({
      chatId,
      streamId: 1,
      request: { prompt: "continue", chatId, onSettled },
      response: { chatId, updatedFiles: false },
    });

    expect(onSettled).toHaveBeenCalledWith({
      success: true,
      pausedByStepLimit: false,
    });
    expect(hasPendingReviewContinuation(chatId)).toBe(false);
    expect(store.get(reviewBarrierHeldByIdAtom).get(chatId)).toBe(false);
    expect(mocks.runAutoReviewBarrier).toHaveBeenCalledTimes(2);
  });

  it("abandons the review-owned hold when a continuation is cancelled", async () => {
    const chatId = 32;
    const store = setup(chatId);
    const continuation = vi.fn(async () => {});
    setPendingReviewContinuation(chatId, continuation);
    store.set(reviewBarrierHeldByIdAtom, new Map([[chatId, true]]));

    await productionChatStreamCommands.runEndSideEffects({
      chatId,
      streamId: 1,
      request: { prompt: "continue", chatId },
      response: { chatId, updatedFiles: false, wasCancelled: true },
    });

    expect(continuation).not.toHaveBeenCalled();
    expect(hasPendingReviewContinuation(chatId)).toBe(false);
    expect(store.get(reviewBarrierHeldByIdAtom).get(chatId)).toBe(false);
  });

  it("abandons the review-owned hold when a continuation stream errors", () => {
    const chatId = 33;
    const store = setup(chatId);
    setPendingReviewContinuation(chatId, async () => {});
    store.set(reviewBarrierHeldByIdAtom, new Map([[chatId, true]]));
    vi.spyOn(console, "error").mockImplementation(() => {});

    productionChatStreamCommands.runErrorSideEffects({
      chatId,
      streamId: 1,
      request: { prompt: "continue", chatId },
      error: "stream failed",
    });

    expect(hasPendingReviewContinuation(chatId)).toBe(false);
    expect(store.get(reviewBarrierHeldByIdAtom).get(chatId)).toBe(false);
  });
});
