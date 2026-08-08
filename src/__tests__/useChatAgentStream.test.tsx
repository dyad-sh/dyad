import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatAgentStream } from "@/hooks/useChatAgentStream";
import type { ChatAgentRagSource } from "@/ipc/types/chat_agent";

/**
 * The invariant under test: a response belongs to the session that asked for
 * it. Switching tabs mid-answer must not move, merge or lose it.
 */

type StreamCallbacks = {
  onChunk: (data: {
    delta?: string;
    ragSources?: ChatAgentRagSource[];
  }) => void;
  onEnd: () => void;
  onError: (data: { error: string }) => void;
};

const started = new Map<string, StreamCallbacks>();
const cancelled: string[] = [];

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    chatAgentStream: {
      start: (params: { sessionId: string }, callbacks: StreamCallbacks) => {
        started.set(params.sessionId, callbacks);
      },
    },
    chatAgent: {
      cancel: (sessionId: string) => {
        cancelled.push(sessionId);
        return Promise.resolve();
      },
    },
  },
}));

function noopCallbacks(onAssistantFlush: (content: string) => void) {
  return {
    onUserMessage: () => {},
    onAssistantFlush,
    onToolResult: () => {},
    onComplete: () => {},
    onError: () => {},
  };
}

describe("useChatAgentStream", () => {
  beforeEach(() => {
    started.clear();
    cancelled.length = 0;
  });

  it("reports streaming only for the session that is answering", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChatAgentStream(id),
      { initialProps: { id: "tab-a" } },
    );

    act(() => {
      result.current.sendMessage(
        "hello",
        noopCallbacks(() => {}),
      );
    });
    expect(result.current.isStreaming).toBe(true);

    // Switching to a fresh tab: that tab is idle and can be typed in.
    rerender({ id: "tab-b" });
    expect(result.current.isStreaming).toBe(false);

    // The first tab is still answering.
    rerender({ id: "tab-a" });
    expect(result.current.isStreaming).toBe(true);
  });

  it("delivers text to the tab that asked, after switching away", () => {
    const flushedToA: string[] = [];
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChatAgentStream(id),
      { initialProps: { id: "tab-a" } },
    );

    act(() => {
      result.current.sendMessage(
        "hello",
        noopCallbacks((content) => flushedToA.push(content)),
      );
    });

    rerender({ id: "tab-b" });

    act(() => {
      started.get("tab-a")!.onChunk({ delta: "answer for A" });
      started.get("tab-a")!.onEnd();
    });

    // A's text reached A's callback, not B's.
    expect(flushedToA.at(-1)).toBe("answer for A");
    expect(started.has("tab-b")).toBe(false);
  });

  it("keeps two conversations answering at once without mixing them", () => {
    const flushedToA: string[] = [];
    const flushedToB: string[] = [];
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChatAgentStream(id),
      { initialProps: { id: "tab-a" } },
    );

    act(() => {
      result.current.sendMessage(
        "question A",
        noopCallbacks((content) => flushedToA.push(content)),
      );
    });
    rerender({ id: "tab-b" });
    act(() => {
      result.current.sendMessage(
        "question B",
        noopCallbacks((content) => flushedToB.push(content)),
      );
    });

    act(() => {
      started.get("tab-a")!.onChunk({ delta: "alpha" });
      started.get("tab-b")!.onChunk({ delta: "beta" });
      started.get("tab-a")!.onEnd();
      started.get("tab-b")!.onEnd();
    });

    expect(flushedToA.at(-1)).toBe("alpha");
    expect(flushedToB.at(-1)).toBe("beta");
  });

  it("delivers deterministic RAG source locations with the answer", () => {
    const received: ChatAgentRagSource[][] = [];
    const { result } = renderHook(() => useChatAgentStream("tab-a"));
    const source: ChatAgentRagSource = {
      collectionId: "knowledge-base",
      collectionName: "Knowledge Base",
      sourceId: "manual",
      sourceName: "Manual.pdf",
      sourcePath: "/vault/Documents/Manual.pdf",
      page: 12,
      lineStart: null,
      lineEnd: null,
    };

    act(() => {
      result.current.sendMessage("question", {
        ...noopCallbacks(() => {}),
        onRagSources: (sources) => received.push(sources),
      });
      started.get("tab-a")!.onChunk({ ragSources: [source] });
    });

    expect(received).toEqual([[source]]);
  });

  it("cancels the named session rather than the one on screen", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChatAgentStream(id),
      { initialProps: { id: "tab-a" } },
    );

    act(() => {
      result.current.sendMessage(
        "hello",
        noopCallbacks(() => {}),
      );
    });
    rerender({ id: "tab-b" });

    act(() => {
      result.current.cancel("tab-a");
    });

    expect(cancelled).toEqual(["tab-a"]);
    rerender({ id: "tab-a" });
    expect(result.current.isStreaming).toBe(false);
  });

  it("keeps the unflushed tail when a response is stopped", () => {
    const flushed: string[] = [];
    const { result } = renderHook(() => useChatAgentStream("tab-a"));

    act(() => {
      result.current.sendMessage(
        "hello",
        noopCallbacks((content) => flushed.push(content)),
      );
    });
    act(() => {
      started.get("tab-a")!.onChunk({ delta: "partial answer" });
    });
    act(() => {
      result.current.cancel();
    });

    expect(flushed.at(-1)).toBe("partial answer");
  });

  it("frees a finished session so the tab can be used again", () => {
    const { result } = renderHook(() => useChatAgentStream("tab-a"));

    act(() => {
      result.current.sendMessage(
        "hello",
        noopCallbacks(() => {}),
      );
    });
    act(() => {
      started.get("tab-a")!.onEnd();
    });

    expect(result.current.isStreaming).toBe(false);
  });
});
