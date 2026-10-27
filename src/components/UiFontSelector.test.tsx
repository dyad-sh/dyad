import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UiFontSelector } from "./UiFontSelector";
import enSettings from "@/i18n/locales/en/settings.json";
import esSettings from "@/i18n/locales/es/settings.json";

const mocks = vi.hoisted(() => ({
  settings: null as { uiFontFamily?: string } | null,
  updateSettings: vi.fn(),
  language: "en" as "en" | "es",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const general = (mocks.language === "en" ? enSettings : esSettings)
        .general as unknown as Record<string, unknown>;
      const options = general.uiFontOptions as Record<string, string>;
      if (key.startsWith("general.uiFontOptions.")) {
        return options[key.slice("general.uiFontOptions.".length)] ?? key;
      }
      return (general[key.split(".").pop() as string] as string) ?? key;
    },
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

describe("UiFontSelector", () => {
  beforeEach(() => {
    mocks.settings = null;
    mocks.language = "en";
    mocks.updateSettings.mockReset().mockResolvedValue(undefined);
  });

  it("shows the default font when nothing is configured", () => {
    render(<UiFontSelector />);
    expect(screen.getByText("App font")).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("persists the chosen font", async () => {
    const user = userEvent.setup();
    render(<UiFontSelector />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Fraunces/ }));

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        uiFontFamily: "fraunces",
      });
    });
  });
});
