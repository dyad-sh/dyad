import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { integrationProviderSelectionAtom } from "@/atoms/integrationAtoms";
import type { AppFrameworkType } from "@/lib/framework_constants";
import { DyadAddIntegration } from "./DyadAddIntegration";

const mocks = vi.hoisted(() => ({
  app: { frameworkType: "vite", files: [] } as
    | { frameworkType: AppFrameworkType; files: string[] }
    | undefined,
  appLoading: false,
  posthogCapture: vi.fn(),
  requestId: "integration-1",
  pendingProvider: undefined as "neon" | "supabase" | undefined,
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
          provider: mocks.pendingProvider,
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

function renderCard(provider?: "neon" | "supabase") {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  store.set(selectedChatIdAtom, 7);

  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }

  return {
    ...render(
      <DyadAddIntegration provider={provider}>
        Connect a database.
      </DyadAddIntegration>,
      { wrapper: Wrapper },
    ),
    store,
  };
}

describe("DyadAddIntegration", () => {
  beforeEach(() => {
    mocks.app = { frameworkType: "vite", files: [] };
    mocks.appLoading = false;
    mocks.posthogCapture.mockReset();
    mocks.requestId = crypto.randomUUID();
    mocks.pendingProvider = undefined;
  });

  it("recommends Neon first and hands the default choice to Configure", () => {
    const { store } = renderCard();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].textContent).toContain("Neon");
    expect(radios[0].textContent).toContain("Recommended");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].textContent).toContain("Supabase");
    expect(radios[1].textContent).not.toContain("Recommended");
    expect(radios[1].getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Continue with Neon" }));
    expect(
      store.get(integrationProviderSelectionAtom).get(mocks.requestId),
    ).toBe("neon");
  });

  it("honors an explicitly requested Supabase provider", () => {
    const { store } = renderCard("supabase");

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(
      screen
        .getByRole("radio", { name: /Supabase/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Supabase" }),
    );
    expect(
      store.get(integrationProviderSelectionAtom).get(mocks.requestId),
    ).toBe("supabase");
  });

  it("honors a pending provider that arrives after the card mounts", () => {
    const view = renderCard();

    mocks.pendingProvider = "supabase";
    view.rerender(<DyadAddIntegration>Connect a database.</DyadAddIntegration>);

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(
      screen
        .getByRole("radio", { name: /Supabase/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
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
    const view = renderCard();

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

    mocks.app = { frameworkType: "other", files: [] };
    mocks.appLoading = false;
    view.rerender(<DyadAddIntegration>Connect a database.</DyadAddIntegration>);

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(
      screen
        .getByRole("radio", { name: /Supabase/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    const continueButton = screen.getByRole("button", {
      name: "Continue with Supabase",
    }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);
    expect(
      view.store.get(integrationProviderSelectionAtom).get(mocks.requestId),
    ).toBe("supabase");
  });
});
