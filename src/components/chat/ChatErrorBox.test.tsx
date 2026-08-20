import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatErrorBox } from "./ChatErrorBox";

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: mocks.openExternalUrl } },
}));

vi.mock("@/hooks/useFreeAgentQuota", () => ({
  useFreeAgentQuota: () => ({
    messagesLimit: 10,
    resetTime: new Date("2026-08-21T07:00:00.000Z"),
  }),
}));

vi.mock("@/hooks/useFreeModelQuota", () => ({
  useFreeModelQuota: () => ({
    messagesLimit: 5,
    resetTime: null,
  }),
}));

vi.mock("@/hooks/useUserBudgetInfo", () => ({
  useUserBudgetInfo: () => ({ userBudget: null }),
}));

describe("ChatErrorBox Basic Agent quota error", () => {
  beforeEach(() => {
    mocks.openExternalUrl.mockReset();
  });

  it("offers upgrade and a non-retrying Build switch", () => {
    const onDismiss = vi.fn();
    const onSwitchToBuildMode = vi.fn();

    render(
      <ChatErrorBox
        error='{"type":"FREE_AGENT_QUOTA_EXCEEDED"}'
        isDyadProEnabled={false}
        onDismiss={onDismiss}
        onSwitchToBuildMode={onSwitchToBuildMode}
      />,
    );

    expect(
      screen.getByText(/used all 10 free Basic Agent messages/),
    ).toBeTruthy();
    expect(screen.getByText(/Your quota resets at/)).toBeTruthy();

    fireEvent.click(screen.getByText("Upgrade to Dyad Pro"));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      "https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=free-agent-quota-exceeded",
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to Build" }));
    expect(onSwitchToBuildMode).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("explains that Dyad Free must be changed before using Build", () => {
    render(
      <ChatErrorBox
        error='{"type":"FREE_AGENT_QUOTA_EXCEEDED"}'
        isDyadProEnabled={false}
        onDismiss={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/first choose a model other than Dyad Free/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Switch to Build" }),
    ).toBeNull();
  });
});
