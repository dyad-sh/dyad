import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { readSettings, writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import type { UserSettings } from "@/lib/schemas";

const PRO_SETTINGS: Partial<UserSettings> = {
  enableDyadPro: true,
  providerSettings: {
    auto: {
      apiKey: { value: "testdyadkey" },
    },
  },
};

const CONNECTED_SUPABASE_SETTINGS: Partial<UserSettings> = {
  supabase: {
    accessToken: { value: "fake-access-token" },
    refreshToken: { value: "fake-refresh-token" },
    expiresIn: 3600,
    tokenTimestamp: Math.floor(Date.now() / 1000),
  },
  enableSupabaseWriteSqlMigration: false,
};

describe("settings actions (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  function resetSettings(settings: Partial<UserSettings> = {}) {
    writeSettings({
      telemetryConsent: "unset",
      maxToolCallSteps: undefined,
      enableDyadPro: false,
      providerSettings: {},
      enableProLazyEditsMode: true,
      proLazyEditsMode: "v1",
      enableProSmartFilesContextMode: true,
      proSmartContextOption: "deep",
      supabase: undefined,
      enableSupabaseWriteSqlMigration: false,
      ...settings,
    });
  }

  it("accepts telemetry from the privacy banner", async () => {
    resetSettings();

    harness.mountSurface({ route: "/", withPrivacyBanner: true });
    fireEvent.click(await screen.findByTestId("telemetry-accept-button"));

    await waitFor(() =>
      expect(readSettings().telemetryConsent).toBe("opted_in"),
    );
    expect(screen.queryByTestId("telemetry-accept-button")).toBeNull();
  });

  it("rejects telemetry from the privacy banner", async () => {
    resetSettings();

    harness.mountSurface({ route: "/", withPrivacyBanner: true });
    fireEvent.click(await screen.findByTestId("telemetry-reject-button"));

    await waitFor(() =>
      expect(readSettings().telemetryConsent).toBe("opted_out"),
    );
    expect(screen.queryByTestId("telemetry-reject-button")).toBeNull();
  });

  it("hides the privacy banner for later without changing telemetry settings", async () => {
    resetSettings();

    harness.mountSurface({ route: "/", withPrivacyBanner: true });
    fireEvent.click(await screen.findByTestId("telemetry-later-button"));

    await waitFor(() =>
      expect(screen.queryByTestId("telemetry-later-button")).toBeNull(),
    );
    expect(readSettings().telemetryConsent).toBe("unset");
  });

  it("persists max tool call step selections from settings", async () => {
    resetSettings(PRO_SETTINGS);

    harness.mountSurface({ route: "/settings" });
    const trigger = await screen.findByRole("combobox", {
      name: "Max Tool Calls (Agent)",
    });

    await harness.selectFromBaseUiSelect(trigger, "Low (25)");
    await waitFor(() => expect(readSettings().maxToolCallSteps).toBe(25));

    await harness.selectFromBaseUiSelect(trigger, "High (200)");
    await waitFor(() => expect(readSettings().maxToolCallSteps).toBe(200));

    await harness.selectFromBaseUiSelect(trigger, "Default (100)");
    await waitFor(() =>
      expect(readSettings().maxToolCallSteps).toBeUndefined(),
    );
  });

  it("validates Dyad Pro keys before saving provider settings", async () => {
    resetSettings();

    harness.mountSurface({
      route: "/settings/providers/$provider",
      params: { provider: "auto" },
    });

    const keyInput = await screen.findByRole("textbox", {
      name: "Set Dyad API Key",
    });
    fireEvent.change(keyInput, { target: { value: "invalid-dyad-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "API key rejected" }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/Dyad rejected this API key/)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Try another API key" }),
    );
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(readSettings().providerSettings.auto).toBeUndefined();
    expect(readSettings().enableDyadPro).not.toBe(true);

    fireEvent.change(keyInput, { target: { value: "testdyadkey" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    await screen.findByText("Current Key (Settings)");
    await waitFor(() => {
      const settings = readSettings();
      expect(settings.providerSettings.auto?.apiKey?.value).toBe("testdyadkey");
      expect(settings.enableDyadPro).toBe(true);
    });
  }, 60_000);

  it("persists the Supabase SQL migration toggle from settings", async () => {
    resetSettings(CONNECTED_SUPABASE_SETTINGS);

    harness.mountSurface({ route: "/settings" });
    const migrationSwitch = await screen.findByRole("switch", {
      name: "Write SQL migration files",
    });
    expect(migrationSwitch.getAttribute("aria-checked")).toBe("false");

    await harness.setSwitch(migrationSwitch, true);
    await waitFor(() =>
      expect(readSettings().enableSupabaseWriteSqlMigration).toBe(true),
    );

    await harness.setSwitch(migrationSwitch, false);
    await waitFor(() =>
      expect(readSettings().enableSupabaseWriteSqlMigration).toBe(false),
    );
  });
});
