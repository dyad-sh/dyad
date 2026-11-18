import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { NeonReconnectionNotice } from "../NeonReconnectionNotice";
import { NeonReconnectionBanner } from "./NeonReconnectionBanner";

const mocks = vi.hoisted(() => ({
  settings: {} as Partial<UserSettings>,
  signIn: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: (appId: number | null) => ({
    app:
      appId === null
        ? undefined
        : { id: appId, neonProjectId: `project-${appId}` },
  }),
}));

vi.mock("../NeonSignInButton", () => ({
  NeonSignInButton: () => (
    <button onClick={mocks.signIn}>Reconnect Neon</button>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        close: "Close",
        "integrations.neon.reconnectTitle": "Reconnect Neon",
        "integrations.neon.reconnectDescription":
          "Sign in again so Dyad can access your Neon projects.",
      })[key] ?? key,
  }),
}));

function sessionWrapper() {
  const store = createStore();
  return ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = {
    neon: { accessToken: { value: "old-token" }, reconnectRequired: true },
  };
});

afterEach(cleanup);

it.each(["invalid", "missing"])(
  "dismisses only the chat notice for %s credentials, leaving reconnection available elsewhere",
  (credentials) => {
    if (credentials === "missing") mocks.settings = {};
    const originalSettings = structuredClone(mocks.settings);
    render(<NeonReconnectionBanner appId={1} />, {
      wrapper: sessionWrapper(),
      reactStrictMode: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByTestId("neon-reconnection-notice")).toBeNull();
    expect(mocks.settings).toEqual(originalSettings);
    expect(mocks.signIn).not.toHaveBeenCalled();

    // Settings and database panels use the notice without a dismiss action.
    render(<NeonReconnectionNotice appId={1} />);
    expect(screen.getByRole("button", { name: "Reconnect Neon" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  },
);

it("remembers dismissal across chat remounts without dismissing another app", () => {
  const wrapper = sessionWrapper();
  const first = render(<NeonReconnectionBanner appId={1} />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  first.unmount();

  const second = render(<NeonReconnectionBanner appId={1} />, { wrapper });
  expect(screen.queryByTestId("neon-reconnection-notice")).toBeNull();

  second.rerender(<NeonReconnectionBanner appId={2} />);
  expect(screen.getByRole("button", { name: "Reconnect Neon" })).toBeTruthy();

  second.rerender(<NeonReconnectionBanner appId={1} />);
  expect(screen.queryByTestId("neon-reconnection-notice")).toBeNull();
});

it("shows the reminder again in a new renderer session", () => {
  const first = render(<NeonReconnectionBanner appId={1} />, {
    wrapper: sessionWrapper(),
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  first.unmount();

  render(<NeonReconnectionBanner appId={1} />, {
    wrapper: sessionWrapper(),
  });
  expect(screen.getByRole("button", { name: "Reconnect Neon" })).toBeTruthy();
});
