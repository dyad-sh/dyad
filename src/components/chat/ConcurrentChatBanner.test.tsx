import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppWorkspaceOverview } from "@/ipc/types";
import { ConcurrentChatBanner } from "./ConcurrentChatBanner";

const state = vi.hoisted(() => ({
  overview: undefined as AppWorkspaceOverview | undefined,
  // `null` while the settings query has not resolved, as `useSettings` returns.
  settings: null as { enableWorktreeIsolation?: boolean } | null,
  update: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "workspace.concurrentBannerMessage": "Another chat is working",
        "workspace.concurrentBannerEnable": "Enable",
        "workspace.isolationEnabledToast": "Isolation is on",
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/useChatWorkspace", () => ({
  useAppWorkspaceOverview: () => ({ data: state.overview }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: state.settings,
    updateSettings: state.update,
  }),
}));

vi.mock("@/lib/toast", () => ({
  showSuccess: state.showSuccess,
  showError: state.showError,
}));

function banner() {
  return (
    <Provider>
      <ConcurrentChatBanner appId={1} chatId={7} />
    </Provider>
  );
}

function renderBanner() {
  return render(banner());
}

describe("ConcurrentChatBanner", () => {
  beforeEach(() => {
    state.overview = {
      appId: 1,
      isolationEnabled: false,
      writableChatIds: [9],
      workspaces: [],
    };
    state.settings = { enableWorktreeIsolation: false };
    state.update.mockReset();
    state.showSuccess.mockReset();
    state.showError.mockReset();
  });

  it("offers to enable isolation while another chat is writing", async () => {
    state.update.mockResolvedValue(undefined);
    renderBanner();
    expect(screen.getByTestId("concurrent-chat-banner").textContent).toContain(
      "Another chat is working",
    );
    fireEvent.click(screen.getByText("Enable"));
    expect(state.update).toHaveBeenCalledWith({
      enableWorktreeIsolation: true,
    });
    await waitFor(() =>
      expect(state.showSuccess).toHaveBeenCalledWith("Isolation is on"),
    );
  });

  it("waits for settings before warning or offering to enable", () => {
    state.settings = null;
    const { rerender } = renderBanner();
    // Isolation may already be on; the stored value is not known yet.
    expect(screen.queryByTestId("concurrent-chat-banner")).toBeNull();

    state.settings = { enableWorktreeIsolation: true };
    rerender(banner());
    expect(screen.queryByTestId("concurrent-chat-banner")).toBeNull();

    state.settings = { enableWorktreeIsolation: false };
    rerender(banner());
    expect(screen.getByTestId("concurrent-chat-banner")).toBeTruthy();
  });

  it("leaves a failed enable to the settings mutation's own error toast", async () => {
    state.update.mockRejectedValue(new Error("disk full"));
    renderBanner();
    fireEvent.click(screen.getByText("Enable"));
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
    // Let the rejection settle; an unhandled one would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.showError).not.toHaveBeenCalled();
    expect(state.showSuccess).not.toHaveBeenCalled();
  });

  it("stays hidden when only this chat writes, and once dismissed", () => {
    state.overview = { ...state.overview!, writableChatIds: [7] };
    const { rerender } = renderBanner();
    expect(screen.queryByTestId("concurrent-chat-banner")).toBeNull();

    state.overview = { ...state.overview, writableChatIds: [9] };
    rerender(banner());
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("concurrent-chat-banner")).toBeNull();
  });
});
