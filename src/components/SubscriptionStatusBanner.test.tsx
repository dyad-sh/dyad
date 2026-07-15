import { createStore, Provider } from "jotai";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStatus } from "@/ipc/types";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  status: null as SubscriptionStatus | null,
  openBillingAction: vi.fn(),
}));

vi.mock("@/hooks/useSubscriptionStatus", () => ({
  useSubscriptionStatus: () => ({ data: mocks.status }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: { openBillingAction: mocks.openBillingAction },
  },
}));

import { SubscriptionStatusBanner } from "./SubscriptionStatusBanner";

function renderBanner() {
  const store = createStore();
  const view = render(
    <Provider store={store}>
      <SubscriptionStatusBanner />
    </Provider>,
  );
  return {
    ...view,
    rerenderBanner: () =>
      view.rerender(
        <Provider store={store}>
          <SubscriptionStatusBanner />
        </Provider>,
      ),
  };
}

describe("SubscriptionStatusBanner", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mocks.status = null;
    mocks.openBillingAction.mockReset();
  });

  it("renders nothing for unavailable or healthy status", () => {
    const view = renderBanner();
    expect(screen.queryByTestId("subscription-status-banner")).toBeNull();
    mocks.status = { alert: null, effectiveAt: null, actionUrl: null };
    view.rerenderBanner();
    expect(screen.queryByTestId("subscription-status-banner")).toBeNull();
  });

  it.each([
    {
      alert: "payment_past_due" as const,
      text: "We couldn’t renew your Dyad Pro subscription.",
      action: "Manage payment methods",
    },
    {
      alert: "subscription_ending" as const,
      text: "Your Dyad Pro subscription ends on Aug 2, 2026.",
      action: "Manage subscription",
    },
    {
      alert: "subscription_paused" as const,
      text: "Your Dyad Pro subscription is paused.",
      action: "Resume subscription",
    },
  ])("renders the $alert localized variant", ({ alert, text, action }) => {
    mocks.status = {
      alert,
      effectiveAt:
        alert === "payment_past_due" ? null : "2026-08-03T00:00:00.000Z",
      actionUrl: "https://academy.dyad.sh/subscription",
    };
    renderBanner();
    expect(screen.getByText(new RegExp(text))).not.toBeNull();
    expect(screen.getByRole("button", { name: action })).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("opens the server-provided action through the dedicated IPC", async () => {
    mocks.status = {
      alert: "subscription_paused",
      effectiveAt: "2026-08-03T00:00:00.000Z",
      actionUrl: "https://academy.dyad.sh/subscription?source=app",
    };
    renderBanner();
    await userEvent.click(
      screen.getByRole("button", { name: "Resume subscription" }),
    );
    expect(mocks.openBillingAction).toHaveBeenCalledWith(
      "https://academy.dyad.sh/subscription?source=app",
    );
  });

  it("dismisses only the current alert fingerprint in session memory", async () => {
    mocks.status = {
      alert: "subscription_paused",
      effectiveAt: "2026-08-03T00:00:00.000Z",
      actionUrl: "https://academy.dyad.sh/subscription",
    };
    const view = renderBanner();
    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss billing notice" }),
    );
    expect(screen.queryByTestId("subscription-status-banner")).toBeNull();

    mocks.status = {
      ...mocks.status,
      effectiveAt: "2026-09-03T00:00:00.000Z",
    };
    view.rerenderBanner();
    expect(screen.queryByTestId("subscription-status-banner")).not.toBeNull();
  });

  it.each([
    ["pt-BR", "Sua assinatura do Dyad Pro está pausada.", "Retomar assinatura"],
    ["zh-CN", "您的 Dyad Pro 订阅已暂停。", "恢复订阅"],
  ])("renders localized copy in %s", async (language, text, action) => {
    await i18n.changeLanguage(language);
    mocks.status = {
      alert: "subscription_paused",
      effectiveAt: "2026-08-03T00:00:00.000Z",
      actionUrl: "https://academy.dyad.sh/subscription",
    };
    renderBanner();
    expect(screen.getByText(new RegExp(text))).not.toBeNull();
    expect(screen.getByRole("button", { name: action })).not.toBeNull();
  });
});
