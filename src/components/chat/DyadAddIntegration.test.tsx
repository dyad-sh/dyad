import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { DyadAddIntegration } from "./DyadAddIntegration";

const mocks = vi.hoisted(() => ({
  app: { frameworkType: "vite", files: [] } as
    | { frameworkType: "vite"; files: string[] }
    | undefined,
  appLoading: false,
  posthogCapture: vi.fn(),
  requestId: "integration-1",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.posthogCapture }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { provider?: string }) => {
      if (key.endsWith("providers.neon.name")) return "Neon";
      if (key.endsWith("providers.supabase.name")) return "Supabase";
      if (key.endsWith("recommended")) return "Recommended";
      if (key.endsWith("continueWithProvider")) {
        return `Continue with ${values?.provider}`;
      }
      return key;
    },
  }),
}));

vi.mock("@/user_input/hooks", () => ({
  usePendingIntegrations: () =>
    new Map([
      [
        7,
        {
          requestId: mocks.requestId,
          chatId: 7,
          provider: undefined,
        },
      ],
    ]),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: mocks.app,
    loading: mocks.appLoading,
  }),
}));

vi.mock("@/hooks/useNeon", () => ({
  useNeon: () => ({ projectInfo: null, isLoadingBranches: false }),
}));

vi.mock("@/hooks/useIntegrationContinue", () => ({
  useIntegrationContinue: () => ({
    canContinue: false,
    canSkip: true,
    isSubmitting: false,
    handleContinue: vi.fn(),
    handleSkip: vi.fn(),
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));

function renderCard() {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  store.set(selectedChatIdAtom, 7);

  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }

  return render(<DyadAddIntegration>Connect a database.</DyadAddIntegration>, {
    wrapper: Wrapper,
  });
}

describe("DyadAddIntegration", () => {
  beforeEach(() => {
    mocks.app = { frameworkType: "vite", files: [] };
    mocks.appLoading = false;
    mocks.posthogCapture.mockReset();
    mocks.requestId = crypto.randomUUID();
  });

  it("shows Neon first and selects it by default", () => {
    renderCard();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].textContent).toContain("Neon");
    expect(radios[0].textContent).toContain("Recommended");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].textContent).toContain("Supabase");
    expect(radios[1].textContent).not.toContain("Recommended");
    expect(radios[1].getAttribute("aria-checked")).toBe("false");
  });

  it("tracks each provider once when setup starts", () => {
    const view = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Continue with Neon" }));
    view.unmount();
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Neon" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "integrations.databaseSetup.back",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue with Neon" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "integrations.databaseSetup.back",
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Supabase/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Supabase" }),
    );

    expect(mocks.posthogCapture.mock.calls).toEqual([
      [
        "integration-setup:start",
        { provider: "neon", requestId: mocks.requestId },
      ],
      [
        "integration-setup:start",
        { provider: "supabase", requestId: mocks.requestId },
      ],
    ]);
  });

  it("waits for app metadata before committing the default provider", () => {
    mocks.app = undefined;
    mocks.appLoading = true;
    renderCard();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].textContent).toContain("Neon");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(
      (
        screen.getByRole("button", {
          name: "Continue with Neon",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
