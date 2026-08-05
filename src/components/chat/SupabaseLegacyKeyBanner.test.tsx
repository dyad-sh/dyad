import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseLegacyKeyBanner } from "./SupabaseLegacyKeyBanner";
import { dismissedLegacySupabaseKeyAppIdsAtom } from "@/atoms/supabaseAtoms";

const {
  detectLegacyAppKeyMock,
  switchAppToPublishableKeyMock,
  showSuccessMock,
  showErrorMock,
  showInfoMock,
  isSupabaseConnectedMock,
} = vi.hoisted(() => ({
  detectLegacyAppKeyMock: vi.fn(),
  switchAppToPublishableKeyMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showErrorMock: vi.fn(),
  showInfoMock: vi.fn(),
  isSupabaseConnectedMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    supabase: {
      detectLegacyAppKey: detectLegacyAppKeyMock,
      switchAppToPublishableKey: switchAppToPublishableKeyMock,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showSuccess: showSuccessMock,
  showError: showErrorMock,
  showInfo: showInfoMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {} }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: { supabaseProjectId: "proj-1" } }),
}));

vi.mock("@/lib/schemas", () => ({
  isSupabaseConnected: isSupabaseConnectedMock,
}));

function renderBanner({ appId = 7 }: { appId?: number | null } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const store = createStore();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  const view = render(<SupabaseLegacyKeyBanner appId={appId} />, { wrapper });
  return { ...view, store, queryClient };
}

const banner = () => screen.queryByTestId("supabase-legacy-key-banner");

beforeEach(() => {
  vi.clearAllMocks();
  detectLegacyAppKeyMock.mockResolvedValue({ hasLegacyKey: true });
  switchAppToPublishableKeyMock.mockResolvedValue({ outcome: "switched" });
  isSupabaseConnectedMock.mockReturnValue(true);
});

describe("SupabaseLegacyKeyBanner", () => {
  it("warns when the app is still on the legacy key", async () => {
    renderBanner();

    await waitFor(() => expect(banner()).toBeTruthy());
  });

  // Detection is the only gate: an app already on a publishable key has nothing
  // to be warned about, and the switch has nothing to do.
  it("stays hidden when there is no legacy key to migrate", async () => {
    detectLegacyAppKeyMock.mockResolvedValue({ hasLegacyKey: false });
    renderBanner();

    await waitFor(() => expect(detectLegacyAppKeyMock).toHaveBeenCalled());
    expect(banner()).toBeNull();
  });

  // The banner's whole self-clearing contract: the switch invalidates the
  // detection query, the re-check comes back false, and the warning goes away
  // on its own. Nothing else clears it, so if this link breaks the user fixes
  // the key and keeps being told it's broken.
  it("switches the app to the publishable key and then clears itself", async () => {
    renderBanner();
    await waitFor(() => expect(banner()).toBeTruthy());

    // The app is migrated from this point on, so re-detection must agree.
    switchAppToPublishableKeyMock.mockImplementation(async () => {
      detectLegacyAppKeyMock.mockResolvedValue({ hasLegacyKey: false });
      return { outcome: "switched" };
    });

    fireEvent.click(screen.getByRole("button", { name: /updateApiKeyShort/ }));

    await waitFor(() =>
      expect(switchAppToPublishableKeyMock).toHaveBeenCalledWith({ appId: 7 }),
    );
    expect(showSuccessMock).toHaveBeenCalled();
    await waitFor(() => expect(banner()).toBeNull());
  });

  // Reachable despite the detection gate: client.ts can change between the
  // check that raised the banner and the click. The key is still legacy, so
  // the banner has to stay — and "already up to date" would be a falsehood.
  it("keeps warning when the switch couldn't act on the key", async () => {
    switchAppToPublishableKeyMock.mockResolvedValue({
      outcome: "not-applicable",
    });
    renderBanner();
    await waitFor(() => expect(banner()).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /updateApiKeyShort/ }));

    await waitFor(() =>
      expect(showInfoMock).toHaveBeenCalledWith(
        "integrations.supabase.apiKeyNotUpdated",
      ),
    );
    expect(showSuccessMock).not.toHaveBeenCalled();
    expect(banner()).toBeTruthy();
  });

  // Disabling a query stops it refetching but keeps its last result, so without
  // re-checking connectivity at render the banner would go on offering a
  // migration there is no longer a Supabase token to perform.
  it("disappears when Supabase is disconnected, cached verdict and all", async () => {
    const { rerender } = renderBanner();
    await waitFor(() => expect(banner()).toBeTruthy());

    isSupabaseConnectedMock.mockReturnValue(false);
    rerender(<SupabaseLegacyKeyBanner appId={7} />);

    expect(banner()).toBeNull();
  });

  it("reports a failed switch instead of silently leaving the legacy key", async () => {
    switchAppToPublishableKeyMock.mockRejectedValue(new Error("boom"));
    renderBanner();
    await waitFor(() => expect(banner()).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /updateApiKeyShort/ }));

    await waitFor(() => expect(showErrorMock).toHaveBeenCalled());
    // Still on the legacy key, so the warning has to stay up.
    expect(banner()).toBeTruthy();
  });

  it("hides after the user dismisses it", async () => {
    renderBanner();
    await waitFor(() => expect(banner()).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(banner()).toBeNull());
  });

  // Dismissal is session-only and per app: it lives in an in-memory atom that a
  // restart resets, and it says nothing about any other app.
  it("keeps the dismissal to this app, in memory only", async () => {
    const { store } = renderBanner();
    await waitFor(() => expect(banner()).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(store.get(dismissedLegacySupabaseKeyAppIdsAtom).has(7)).toBe(true),
    );
    expect(store.get(dismissedLegacySupabaseKeyAppIdsAtom).has(8)).toBe(false);
  });

  it("stays off the wire without an app", async () => {
    renderBanner({ appId: null });

    await waitFor(() => expect(detectLegacyAppKeyMock).not.toHaveBeenCalled());
    expect(banner()).toBeNull();
  });
});
