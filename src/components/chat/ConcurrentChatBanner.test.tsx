import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppWorkspaceOverview } from "@/ipc/types";
import { ConcurrentChatBanner } from "./ConcurrentChatBanner";

const state = vi.hoisted(() => ({
  overview: undefined as AppWorkspaceOverview | undefined,
  isolationEnabled: false,
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
        "workspace.isolationEnableFailed": "Could not enable",
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/useChatWorkspace", () => ({
  useAppWorkspaceOverview: () => ({ data: state.overview }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enableWorktreeIsolation: state.isolationEnabled },
    updateSettings: state.update,
  }),
}));

vi.mock("@/lib/toast", () => ({
  showSuccess: state.showSuccess,
  showError: state.showError,
}));

function renderBanner() {
  return render(
    <Provider>
      <ConcurrentChatBanner appId={1} chatId={7} />
    </Provider>,
  );
}

describe("ConcurrentChatBanner", () => {
  beforeEach(() => {
    state.overview = {
      appId: 1,
      isolationEnabled: false,
      writableChatIds: [9],
      workspaces: [],
    };
    state.isolationEnabled = false;
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

  it("reports a failed enable", async () => {
    state.update.mockRejectedValue(new Error("disk full"));
    renderBanner();
    fireEvent.click(screen.getByText("Enable"));
    await waitFor(() =>
      expect(state.showError).toHaveBeenCalledWith("Could not enable"),
    );
  });

  it("stays hidden when only this chat writes, and once dismissed", () => {
    state.overview = { ...state.overview!, writableChatIds: [7] };
    const { rerender } = renderBanner();
    expect(screen.queryByTestId("concurrent-chat-banner")).toBeNull();

    state.overview = { ...state.overview, writableChatIds: [9] };
    rerender(
      <Provider>
        <ConcurrentChatBanner appId={1} chatId={7} />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("concurrent-chat-banner")).toBeNull();
  });
});
