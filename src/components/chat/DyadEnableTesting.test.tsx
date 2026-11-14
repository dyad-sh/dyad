import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import en from "@/i18n/locales/en/chat.json";
import {
  DyadEnableTesting,
  type DyadEnableTestingProps,
} from "./DyadEnableTesting";

const mocks = vi.hoisted(() => ({
  respond: vi.fn(),
  pending: new Map<number, unknown>(),
}));
vi.mock("@/user_input/hooks", () => ({
  usePendingEnableTesting: () => mocks.pending,
  useUserInputReadModel: () => ({ respond: mocks.respond }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      en.enableTesting[key.split(".")[1] as keyof typeof en.enableTesting],
  }),
}));

function renderCard(props: DyadEnableTestingProps = {}, chatId = 7) {
  const store = createStore();
  store.set(selectedChatIdAtom, chatId);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Provider store={store}>
        <DyadEnableTesting requestId="testing:1" outcome="pending" {...props} />
      </Provider>
    </QueryClientProvider>,
  );
}

describe("DyadEnableTesting", () => {
  beforeEach(() => {
    mocks.respond.mockReset().mockResolvedValue(true);
    mocks.pending = new Map([
      [7, { chatId: 7, requestId: "testing:1", isResponding: false }],
    ]);
  });
  it.each([true, false])(
    "submits enabled=%s from the matching card",
    async (enabled) => {
      renderCard();
      expect(screen.getByText(en.enableTesting.scope)).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(
        en.enableTesting.waiting,
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: enabled ? "Enable testing" : "Not now",
        }),
      );
      await waitFor(() =>
        expect(mocks.respond).toHaveBeenCalledWith("testing:1", {
          kind: "enable-testing",
          enabled,
        }),
      );
    },
  );
  it("prevents duplicate choices while saving and allows retry after a failure", async () => {
    let resolve!: (result: boolean) => void;
    mocks.respond.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Enable testing" }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole<HTMLButtonElement>("button")
          .every((button) => button.disabled),
      ).toBe(true),
    );
    resolve(false);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Enable testing" }));
    await waitFor(() => expect(mocks.respond).toHaveBeenCalledTimes(2));
  });
  it.each([{ requestId: "stale" }, { outcome: "dismissed" as const }])(
    "hides inactive cards (%o)",
    (props) => {
      const { container } = renderCard(props);
      expect(container.textContent).toBe("");
    },
  );
  it("does not show another chat's request", () => {
    const { container } = renderCard({}, 8);
    expect(container.textContent).toBe("");
  });
  it.each(["enabled", "declined"] as const)(
    "shows historical %s outcome without actions",
    (outcome) => {
      mocks.pending.clear();
      renderCard({ outcome });
      expect(screen.getByText(en.enableTesting[outcome])).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    },
  );
});
