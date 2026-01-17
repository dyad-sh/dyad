import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import JoyCreatorStudioPage from "@/pages/nft-marketplace";

import { vi } from "vitest";

vi.mock("@/ipc/nft_client", () => ({
  NFTClient: {
    getStats: vi.fn().mockResolvedValue({
      listed_count: 0,
      sold_count: 0,
      total_listings: 0,
      total_value: 0,
    }),
    getAllListings: vi.fn().mockResolvedValue([]),
    getPortfolio: vi.fn().mockResolvedValue({ owned: [], created: [] }),
    deleteListing: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue({ success: true }),
    chunkAsset: vi.fn().mockResolvedValue({ success: true, chunks: [] }),
    bulkCreateListings: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/ipc/asset_studio_client", () => ({
  AssetStudioClient: {
    listAll: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ total: 0, published: 0 }),
  },
}));

vi.mock("@/ipc/ipc_client", () => {
  const instance = {
    listIpldReceipts: vi.fn().mockResolvedValue([]),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn().mockResolvedValue(undefined),
  };
  return {
    IpcClient: {
      getInstance: () => instance,
    },
  };
});

describe("JoyCreatorStudioPage receipts", () => {
  it("renders the receipts builder tab", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <JoyCreatorStudioPage />
      </QueryClientProvider>
    );

    const tab = screen.getByText("Receipts");
    fireEvent.click(tab);

    expect(await screen.findByText("Inference Receipt Builder")).toBeTruthy();
    expect(screen.getByText("Latest Receipt")).toBeTruthy();
  });
});
