import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  removeChatReferencedApp: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: {
      getChat: mocks.getChat,
      removeChatReferencedApp: mocks.removeChatReferencedApp,
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { appName?: string }) =>
      key === "referencedApps.remove"
        ? `Stop referencing ${options?.appName}`
        : key,
  }),
}));

import { ReferencedAppsBar } from "./ReferencedAppsBar";

const CHAT_ID = 7;

function wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function detachButton() {
  return screen.getByLabelText("Stop referencing other-app");
}

describe("ReferencedAppsBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getChat.mockResolvedValue({
      id: CHAT_ID,
      referencedApps: [{ id: 1, name: "other-app" }],
    });
    mocks.removeChatReferencedApp.mockResolvedValue(undefined);
  });

  it("lets the user detach a referenced app while idle", async () => {
    render(
      <ReferencedAppsBar chatId={CHAT_ID} isEnabled isStreaming={false} />,
      { wrapper },
    );

    fireEvent.click(await waitFor(detachButton));

    await waitFor(() =>
      expect(mocks.removeChatReferencedApp).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        appId: 1,
      }),
    );
  });

  // The running turn snapshots its referenced apps before the model call, so a
  // detach cannot revoke access until the turn ends. Removing the chip mid-turn
  // would claim the agent had already lost the app while it could still read it.
  it("blocks detaching while the turn is in flight", async () => {
    render(<ReferencedAppsBar chatId={CHAT_ID} isEnabled isStreaming />, {
      wrapper,
    });

    const button = (await waitFor(detachButton)) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(mocks.removeChatReferencedApp).not.toHaveBeenCalled();
  });

  it("keeps showing the referenced apps while the turn is in flight", async () => {
    render(<ReferencedAppsBar chatId={CHAT_ID} isEnabled isStreaming />, {
      wrapper,
    });

    expect(await waitFor(() => screen.getByText("other-app"))).toBeTruthy();
  });

  it("renders nothing in modes that do not carry references forward", () => {
    render(
      <ReferencedAppsBar
        chatId={CHAT_ID}
        isEnabled={false}
        isStreaming={false}
      />,
      { wrapper },
    );

    expect(screen.queryByTestId("referenced-apps-bar")).toBeNull();
    expect(mocks.getChat).not.toHaveBeenCalled();
  });
});
