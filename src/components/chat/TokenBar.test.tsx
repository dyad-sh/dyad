import { createStore, Provider } from "jotai";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatInputValuesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { TokenBar } from "./TokenBar";

const mocks = vi.hoisted(() => ({
  useCountTokens: vi.fn(),
}));

vi.mock("@/hooks/useCountTokens", () => ({
  useCountTokens: mocks.useCountTokens,
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: undefined }),
}));

describe("TokenBar", () => {
  beforeEach(() => {
    mocks.useCountTokens.mockReset();
    mocks.useCountTokens.mockReturnValue({ result: null, error: null });
  });

  it("counts the draft belonging to its pane chat", () => {
    const store = createStore();
    store.set(selectedChatIdAtom, 1);
    store.set(
      chatInputValuesByIdAtom,
      new Map([
        [1, "focused draft"],
        [2, "background pane draft"],
      ]),
    );

    render(
      <Provider store={store}>
        <TokenBar chatId={2} />
      </Provider>,
    );

    expect(mocks.useCountTokens).toHaveBeenCalledWith(
      2,
      "background pane draft",
    );
  });
});
