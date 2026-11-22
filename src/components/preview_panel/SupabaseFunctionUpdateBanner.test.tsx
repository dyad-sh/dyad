import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { SupabaseFunctionUpdateBanner } from "./SupabaseFunctionUpdateBanner";

type TestApp = {
  id: number;
  supabaseProjectId: string | null;
  supabaseSelfHosted: { ssh: object | null } | null;
};

const h = vi.hoisted(() => ({
  app: null as TestApp | null,
  listPendingSelfHostedFunctionUpdates: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    supabase: {
      listPendingSelfHostedFunctionUpdates:
        h.listPendingSelfHostedFunctionUpdates,
    },
  },
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: h.app }),
}));

const LIVE_BY = new Date(2026, 10, 22, 15, 42).getTime();
const liveByText = new Date(LIVE_BY).toLocaleTimeString([], {
  hour: "numeric",
  minute: "2-digit",
});

function renderBanner() {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return render(<SupabaseFunctionUpdateBanner />, { wrapper: Wrapper });
}

describe("SupabaseFunctionUpdateBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.app = {
      id: 1,
      supabaseProjectId: "instance-1",
      supabaseSelfHosted: { ssh: { host: "example.com" } },
    };
  });
  afterEach(cleanup);

  it("says when an updated function will be live", async () => {
    h.listPendingSelfHostedFunctionUpdates.mockResolvedValue([
      { functionName: "send-email", liveByMs: LIVE_BY },
    ]);
    renderBanner();

    expect(
      (await screen.findByTestId("supabase-function-update-banner"))
        .textContent,
    ).toBe(
      `The update to send-email will be live by ${liveByText}. Until then, it may still answer with its previous code.`,
    );
    expect(h.listPendingSelfHostedFunctionUpdates).toHaveBeenCalledWith({
      projectId: "instance-1",
    });
  });

  it("gives the latest time when several functions are updating", async () => {
    h.listPendingSelfHostedFunctionUpdates.mockResolvedValue([
      { functionName: "charge", liveByMs: LIVE_BY - 60_000 },
      { functionName: "refund", liveByMs: LIVE_BY - 30_000 },
      { functionName: "send-email", liveByMs: LIVE_BY },
    ]);
    renderBanner();

    expect(
      (await screen.findByTestId("supabase-function-update-banner"))
        .textContent,
    ).toBe(
      `The updates to charge, refund and send-email will be live by ${liveByText}. Until then, they may still answer with their previous code.`,
    );
  });

  it("shows nothing when no update is pending", async () => {
    h.listPendingSelfHostedFunctionUpdates.mockResolvedValue([]);
    renderBanner();

    await waitFor(() =>
      expect(h.listPendingSelfHostedFunctionUpdates).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId("supabase-function-update-banner")).toBeNull();
  });

  it("doesn't ask for apps whose functions Dyad doesn't deploy", () => {
    for (const app of [
      { id: 1, supabaseProjectId: "cloud-ref", supabaseSelfHosted: null },
      {
        id: 1,
        supabaseProjectId: "instance-1",
        supabaseSelfHosted: { ssh: null },
      },
    ]) {
      h.app = app;
      renderBanner();
      cleanup();
    }

    expect(h.listPendingSelfHostedFunctionUpdates).not.toHaveBeenCalled();
  });
});
