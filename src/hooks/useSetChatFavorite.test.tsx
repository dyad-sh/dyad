import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSummary } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { useSetChatFavorite } from "./useSetChatFavorite";

const setChatFavoriteMock = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: {
      setChatFavorite: setChatFavoriteMock,
    },
  },
}));

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function chatSummary(isFavorite = false): ChatSummary {
  return {
    id: 7,
    appId: 42,
    title: "Important chat",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    chatMode: null,
    isFavorite,
  };
}

describe("useSetChatFavorite", () => {
  beforeEach(() => {
    setChatFavoriteMock.mockReset();
  });

  it("optimistically updates both app and global chat lists", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const appKey = queryKeys.chats.list({ appId: 42 });
    const globalKey = queryKeys.chats.list({ appId: null });
    queryClient.setQueryData(appKey, [chatSummary()]);
    queryClient.setQueryData(globalKey, [chatSummary()]);

    let resolveMutation: ((value: { isFavorite: boolean }) => void) | null =
      null;
    setChatFavoriteMock.mockImplementation(
      () =>
        new Promise<{ isFavorite: boolean }>((resolve) => {
          resolveMutation = resolve;
        }),
    );

    const { result } = renderHook(useSetChatFavorite, {
      wrapper: makeWrapper(queryClient),
    });
    let mutationPromise: Promise<{ isFavorite: boolean }>;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        chatId: 7,
        appId: 42,
        isFavorite: true,
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ChatSummary[]>(appKey)?.[0].isFavorite,
      ).toBe(true);
      expect(
        queryClient.getQueryData<ChatSummary[]>(globalKey)?.[0].isFavorite,
      ).toBe(true);
    });

    await act(async () => {
      resolveMutation?.({ isFavorite: true });
      await mutationPromise!;
    });
    expect(setChatFavoriteMock).toHaveBeenCalledWith({
      chatId: 7,
      isFavorite: true,
    });
  });

  it("restores both caches when persistence fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const appKey = queryKeys.chats.list({ appId: 42 });
    const globalKey = queryKeys.chats.list({ appId: null });
    queryClient.setQueryData(appKey, [chatSummary()]);
    queryClient.setQueryData(globalKey, [chatSummary()]);
    setChatFavoriteMock.mockRejectedValue(new Error("database unavailable"));

    const { result } = renderHook(useSetChatFavorite, {
      wrapper: makeWrapper(queryClient),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          chatId: 7,
          appId: 42,
          isFavorite: true,
        }),
      ),
    ).rejects.toThrow("database unavailable");

    expect(
      queryClient.getQueryData<ChatSummary[]>(appKey)?.[0].isFavorite,
    ).toBe(false);
    expect(
      queryClient.getQueryData<ChatSummary[]>(globalKey)?.[0].isFavorite,
    ).toBe(false);
  });
});
