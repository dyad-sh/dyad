import { createStore, Provider } from "jotai";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStatus, UserBudgetInfo } from "@/ipc/types";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  status: null as SubscriptionStatus | null,
  userBudget: null as UserBudgetInfo | null,
  openBillingAction: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/hooks/useSubscriptionStatus", () => ({
  useSubscriptionStatus: () => ({ data: mocks.status }),
}));
vi.mock("@/hooks/useUserBudgetInfo", () => ({
  useUserBudgetInfo: () => ({ userBudget: mocks.userBudget }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: { openBillingAction: mocks.openBillingAction },
  },
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.capture }),
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
    mocks.userBudget = {
      usedCredits: 349.6,
      totalCredits: 1000,
      budgetResetDate: new Date("2026-08-01T00:00:00.000Z"),
      redactedUserId: "test-user",
      isTrial: false,
    };
    mocks.openBillingAction.mockReset();
    mocks.capture.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-07-14T00:00:00.000Z").getTime(),
    );
  });

  afterEach(() => vi.restoreAllMocks());

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
      text: "Payment failed. Update your payment method to keep Dyad Pro active.",
      action: "Update payment method",
    },
    {
      alert: "subscription_ending" as const,
      text: "Your Dyad Pro subscription ends in 20 days. You will lose 650 credits.",
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
    expect(mocks.capture).toHaveBeenCalledWith("billing_nudge_clicked", {
      alert: "subscription_paused",
      has_effective_at: true,
    });
  });

  it("uses singular day and credit copy", () => {
    mocks.status = {
      alert: "subscription_ending",
      effectiveAt: "2026-07-15T00:00:00.000Z",
      actionUrl: "https://academy.dyad.sh/subscription",
    };
    mocks.userBudget = {
      ...mocks.userBudget!,
      usedCredits: 999,
    };

    renderBanner();

    expect(
      screen.getByText(
        "Your Dyad Pro subscription ends in 1 day. You will lose 1 credit.",
      ),
    ).not.toBeNull();
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
    expect(mocks.capture).toHaveBeenCalledWith("billing_nudge_dismissed", {
      alert: "subscription_paused",
      has_effective_at: true,
    });
    expect(screen.queryByTestId("subscription-status-banner")).toBeNull();

    mocks.status = {
      ...mocks.status,
      effectiveAt: "2026-09-03T00:00:00.000Z",
    };
    view.rerenderBanner();
    expect(screen.queryByTestId("subscription-status-banner")).not.toBeNull();
  });

  it("deduplicates shown analytics and reports a confirmed resolution", () => {
    mocks.status = {
      alert: "payment_past_due",
      effectiveAt: null,
      actionUrl: "https://academy.dyad.sh/billing",
    };
    const view = renderBanner();
    expect(mocks.capture).toHaveBeenCalledWith("billing_nudge_shown", {
      alert: "payment_past_due",
      has_effective_at: false,
    });

    view.rerenderBanner();
    expect(
      mocks.capture.mock.calls.filter(
        ([event]) => event === "billing_nudge_shown",
      ),
    ).toHaveLength(1);

    mocks.status = { alert: null, effectiveAt: null, actionUrl: null };
    view.rerenderBanner();
    expect(mocks.capture).toHaveBeenCalledWith("billing_nudge_resolved", {
      alert: "payment_past_due",
      has_effective_at: false,
    });
  });

  it("does not report a resolution when status becomes unavailable", () => {
    mocks.status = {
      alert: "payment_past_due",
      effectiveAt: null,
      actionUrl: "https://academy.dyad.sh/billing",
    };
    const view = renderBanner();
    mocks.capture.mockClear();

    mocks.status = null;
    view.rerenderBanner();
    expect(mocks.capture).not.toHaveBeenCalledWith(
      "billing_nudge_resolved",
      expect.anything(),
    );
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
