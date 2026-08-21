import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useProposal } from "./useProposal";

describe("useProposal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refetches after streaming even when an earlier request settles after invalidation", async () => {
    let resolveInitialProposal: ((value: null) => void) | undefined;
    const initialProposal = new Promise<null>((resolve) => {
      resolveInitialProposal = resolve;
    });
    const getProposal = vi
      .spyOn(ipc.proposal, "getProposal")
      .mockImplementationOnce(() => initialProposal)
      .mockResolvedValue(null);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(
      ({ isStreaming }) => useProposal(7, { isStreaming }),
      {
        initialProps: { isStreaming: false },
        wrapper,
      },
    );

    await waitFor(() => expect(getProposal).toHaveBeenCalledTimes(1));

    rerender({ isStreaming: true });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.proposals.detail({ chatId: 7 }),
    });
    resolveInitialProposal?.(null);
    await waitFor(() =>
      expect(
        queryClient.getQueryState(queryKeys.proposals.detail({ chatId: 7 }))
          ?.dataUpdatedAt,
      ).toBeGreaterThan(0),
    );
    expect(getProposal).toHaveBeenCalledTimes(1);

    rerender({ isStreaming: false });
    await waitFor(() => expect(getProposal).toHaveBeenCalledTimes(2));
  });
});
