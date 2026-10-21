import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewCookieIsolationSwitch } from "./PreviewCookieIsolationSwitch";
import enSettings from "@/i18n/locales/en/settings.json";
import esSettings from "@/i18n/locales/es/settings.json";

const mocks = vi.hoisted(() => ({
  settings: undefined as Record<string, unknown> | undefined,
  settingsLoading: true,
  updateSettings: vi.fn(),
  language: "en" as "en" | "es",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const copy = (mocks.language === "en" ? enSettings : esSettings)
        .experiments.previewCookieIsolation;
      return (
        {
          "experiments.previewCookieIsolation.label": copy.label,
          "experiments.previewCookieIsolation.description": copy.description,
          "experiments.previewCookieIsolation.loading": copy.loading,
          "experiments.previewCookieIsolation.loadError": copy.loadError,
        }[key] ?? key
      );
    },
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => mocks,
}));

describe("PreviewCookieIsolationSwitch", () => {
  beforeEach(() => {
    mocks.settings = undefined;
    mocks.settingsLoading = true;
    mocks.language = "en";
    mocks.updateSettings.mockReset().mockResolvedValue(undefined);
  });

  it("shows loading without presenting an unconfirmed setting", () => {
    render(<PreviewCookieIsolationSwitch />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loading setting…");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("shows a load failure without presenting the default as a saved value", () => {
    mocks.settingsLoading = false;
    render(<PreviewCookieIsolationSwitch />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "Unable to load setting",
    );
  });

  it.each([undefined, false, true])(
    "shows and toggles preference %s, defaulting to on",
    (enabled) => {
      mocks.settings = { enablePreviewCookieIsolation: enabled };
      render(<PreviewCookieIsolationSwitch />);
      const toggle = screen.getByRole("switch", {
        name: "Isolate preview sign-in cookies",
      });
      expect(toggle.getAttribute("aria-checked")).toBe(String(enabled ?? true));
      fireEvent.click(toggle);
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        enablePreviewCookieIsolation: !(enabled ?? true),
      });
    },
  );

  it.each([
    [true, "Cargando ajuste…"],
    [false, "No se pudo cargar el ajuste"],
  ])("translates the loading=%s status", (loading, message) => {
    mocks.language = "es";
    mocks.settingsLoading = loading;
    render(<PreviewCookieIsolationSwitch />);
    expect(screen.getByRole("status").textContent).toBe(message);
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
