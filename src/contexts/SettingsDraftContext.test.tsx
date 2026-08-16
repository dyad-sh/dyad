import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import {
  SettingsDraftProvider,
  useSettingsDraftContext,
} from "./SettingsDraftContext";

const persistSettings = vi.fn();

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => "jarvis",
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettingsInternal: () => ({
    settings: { jarvis: {} } as UserSettings,
    updateSettings: persistSettings,
    isUpdatePending: false,
  }),
}));

vi.mock("@/lib/toast", () => ({
  showSuccess: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <SettingsDraftProvider>{children}</SettingsDraftProvider>;
}

describe("SettingsDraftProvider", () => {
  beforeEach(() => {
    persistSettings.mockReset();
    persistSettings.mockResolvedValue({
      jarvis: { elevenLabsApiKey: { value: "xi-secret" } },
    });
  });

  it("atomically persists a patch from a setting with its own Save button", async () => {
    const { result } = renderHook(() => useSettingsDraftContext(), { wrapper });

    await act(async () => {
      await result.current?.saveTabPatch("jarvis", {
        jarvis: { elevenLabsApiKey: { value: "xi-secret" } },
      });
    });

    expect(persistSettings).toHaveBeenCalledOnce();
    expect(persistSettings).toHaveBeenCalledWith({
      jarvis: { elevenLabsApiKey: { value: "xi-secret" } },
    });
  });
});
