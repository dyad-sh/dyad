import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { AzureConfiguration } from "./AzureConfiguration";

describe("AzureConfiguration", () => {
  it("sends an explicit apiKey clear when saving with an empty key", async () => {
    const updateSettings = vi.fn().mockResolvedValue({});
    const settings = {
      providerSettings: {
        azure: {
          resourceName: "old-resource",
        },
      },
    } as unknown as UserSettings;

    render(
      <AzureConfiguration
        settings={settings}
        envVars={{}}
        updateSettings={updateSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("Resource Name"), {
      target: { value: "new-resource" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalled();
    });

    const update = updateSettings.mock.calls[0][0] as Partial<UserSettings>;
    const azureSettings = update.providerSettings?.azure;
    expect(azureSettings?.resourceName).toBe("new-resource");
    expect(Object.prototype.hasOwnProperty.call(azureSettings, "apiKey")).toBe(
      true,
    );
    expect(azureSettings?.apiKey).toBeUndefined();
  });
});
