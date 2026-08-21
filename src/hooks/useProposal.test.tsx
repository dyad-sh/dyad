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

  it("does not refresh an incomplete proposal while proposal loading is disabled", async () => {
    const getProposal = vi
      .spyOn(ipc.proposal, "getProposal")
      .mockResolvedValue(null);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(
      ({ enabled }) => useProposal(7, { enabled }),
      {
        initialProps: { enabled: true },
        wrapper,
      },
    );

    await waitFor(() => expect(getProposal).toHaveBeenCalledTimes(1));

    rerender({ enabled: false });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.proposals.detail({ chatId: 7 }),
    });
    expect(getProposal).toHaveBeenCalledTimes(1);

    rerender({ enabled: true });
    await waitFor(() => expect(getProposal).toHaveBeenCalledTimes(2));
  });
});
