import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WEB_SEARCH_BRAVE_PROVIDER_ID,
  WEB_SEARCH_EXA_PROVIDER_ID,
} from "@/lib/schemas";
import { WebAccessSettings } from "./WebAccessSettings";

const mocks = vi.hoisted(() => ({
  settings: {
    enableWebAccess: false,
    webSearchProvider: "auto",
    providerSettings: {},
  } as any,
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

describe("WebAccessSettings", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(undefined);
    mocks.settings = {
      enableWebAccess: false,
      webSearchProvider: "auto",
      providerSettings: {},
    };
  });

  it("updates the web access toggle", () => {
    render(<WebAccessSettings />);

    fireEvent.click(screen.getByRole("switch", { name: "Web access" }));

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableWebAccess: true,
    });
  });

  it("stores search keys in reserved encrypted-provider settings", async () => {
    mocks.settings = {
      enableWebAccess: true,
      webSearchProvider: "auto",
      providerSettings: {
        [WEB_SEARCH_BRAVE_PROVIDER_ID]: { apiKey: { value: "brave-key" } },
      },
    };
    render(<WebAccessSettings />);

    fireEvent.change(screen.getByLabelText("Exa API key value"), {
      target: { value: "exa-key" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Save/ })[0]);

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        providerSettings: {
          [WEB_SEARCH_BRAVE_PROVIDER_ID]: { apiKey: { value: "brave-key" } },
          [WEB_SEARCH_EXA_PROVIDER_ID]: { apiKey: { value: "exa-key" } },
        },
      });
    });
  });

  it("explicitly clears a deleted key", async () => {
    mocks.settings = {
      enableWebAccess: true,
      webSearchProvider: "exa",
      providerSettings: {
        [WEB_SEARCH_EXA_PROVIDER_ID]: { apiKey: { value: "saved-exa-key" } },
      },
    };
    render(<WebAccessSettings />);

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        providerSettings: {
          [WEB_SEARCH_EXA_PROVIDER_ID]: { apiKey: undefined },
        },
      });
    });
  });

  it("serializes concurrent key saves against the latest settings", async () => {
    mocks.settings = {
      enableWebAccess: true,
      webSearchProvider: "auto",
      providerSettings: {},
    };
    let resolveFirst: ((value: typeof mocks.settings) => void) | undefined;
    mocks.updateSettings
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async (update) => ({
        ...mocks.settings,
        ...update,
      }));
    render(<WebAccessSettings />);

    fireEvent.change(screen.getByLabelText("Exa API key value"), {
      target: { value: "exa-key" },
    });
    fireEvent.change(screen.getByLabelText("Brave Search API key value"), {
      target: { value: "brave-key" },
    });
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[0]);
    fireEvent.click(saveButtons[1]);

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    resolveFirst?.({
      ...mocks.settings,
      providerSettings: {
        [WEB_SEARCH_EXA_PROVIDER_ID]: { apiKey: { value: "exa-key" } },
      },
    });

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenLastCalledWith({
        providerSettings: {
          [WEB_SEARCH_EXA_PROVIDER_ID]: { apiKey: { value: "exa-key" } },
          [WEB_SEARCH_BRAVE_PROVIDER_ID]: {
            apiKey: { value: "brave-key" },
          },
        },
      });
    });
  });
});
