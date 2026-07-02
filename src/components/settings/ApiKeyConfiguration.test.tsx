import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiKeyConfiguration } from "./ApiKeyConfiguration";

function renderApiKeyConfiguration({
  isSaving = false,
  isTesting = false,
}: {
  isSaving?: boolean;
  isTesting?: boolean;
} = {}) {
  return render(
    <ApiKeyConfiguration
      provider="google"
      providerDisplayName="Google"
      settings={
        {
          providerSettings: {
            google: {
              apiKey: { value: "test-google-key" },
            },
          },
        } as any
      }
      envVars={{}}
      envVarName="GOOGLE_API_KEY"
      isSaving={isSaving}
      isTesting={isTesting}
      saveError={null}
      testSuccessMessage={null}
      apiKeyInput="new-google-key"
      onApiKeyInputChange={vi.fn()}
      onSaveKey={vi.fn()}
      onTestKey={vi.fn()}
      onDeleteKey={vi.fn()}
      isDyad={false}
      updateSettings={vi.fn()}
    />,
  );
}

describe("ApiKeyConfiguration", () => {
  it("shows only the test button as testing during key tests", () => {
    renderApiKeyConfiguration({ isTesting: true });

    expect(
      (screen.getByRole("button", { name: "Save Key" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Testing..." }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Saving..." })).toBeNull();
  });

  it("shows only the save button as saving during key saves", () => {
    renderApiKeyConfiguration({ isSaving: true });

    expect(
      (screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Test Key" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Testing..." })).toBeNull();
  });
});
