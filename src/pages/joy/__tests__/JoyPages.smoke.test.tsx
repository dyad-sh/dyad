/**
 * Smoke tests for the four /joy/* unified pages.
 *
 * Pure render-and-assert — verifies the pages mount, surface the expected
 * headings, and gracefully render when joybridge:* IPC returns empty data.
 *
 * Per Joy Unification PR scope: catch the "page wired but doesn't render"
 * regression class (which bit us when nft-marketplace ballooned to 128 KB).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub IPC. Each test resets the mock so we can wire success / error.
const mockInvoke = vi.fn();

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: () => ({
      invoke: mockInvoke,
    }),
  },
}));

// TanStack Router Link uses route context that's a pain to set up in tests.
// Stub it to a plain anchor so the page renders without the full router.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) =>
      // eslint-disable-next-line jsx-a11y/anchor-is-valid
      <a href={to} {...rest}>{children}</a>,
    useNavigate: () => () => undefined,
    useSearch: () => ({}),
  };
});

// Now import the pages — after the mocks above.
import JoyMarketplacePage from "@/pages/joy/MarketplacePage";
import JoyMyStoresPage from "@/pages/joy/MyStoresPage";
import JoyMyAssetsPage from "@/pages/joy/MyAssetsPage";

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("JoyMarketplacePage smoke", () => {
  it("renders header and empty state when browse returns no items", async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: { items: [] } });
    render(<JoyMarketplacePage />);
    expect(screen.getByText("Joy Marketplace")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/No published assets yet/i)).toBeTruthy();
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      "joybridge:browse-marketplace",
      expect.objectContaining({ limit: 24 }),
    );
  });

  it("renders error state when browse fails", async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: "Backend down" });
    render(<JoyMarketplacePage />);
    await waitFor(() => {
      expect(screen.getByText("Backend down")).toBeTruthy();
    });
  });
});

describe("JoyMyStoresPage smoke", () => {
  it("renders empty state with create-store CTA", async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] });
    render(<JoyMyStoresPage />);
    expect(screen.getByText("My Stores")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/don't have any stores yet/i)).toBeTruthy();
    });
    // The Create Store button is rendered above.
    expect(screen.getAllByText(/Create Store/).length).toBeGreaterThan(0);
  });
});

describe("JoyMyAssetsPage smoke", () => {
  it("renders empty state when list-my-assets returns empty", async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] });
    render(<JoyMyAssetsPage />);
    expect(screen.getByText("My Assets")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/haven't published anything yet/i)).toBeTruthy();
    });
  });

  it("renders an asset card when data is present", async () => {
    mockInvoke.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "a1",
          storeId: "s1",
          assetType: "image",
          name: "Cute kitten",
          priceUsdc: 1_000_000, // $1
        },
      ],
    });
    render(<JoyMyAssetsPage />);
    await waitFor(() => {
      expect(screen.getByText("Cute kitten")).toBeTruthy();
      expect(screen.getByText(/\$1\.00 USDC/)).toBeTruthy();
    });
  });
});
