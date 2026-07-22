import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./home";

const mocks = vi.hoisted(() => ({
  attachments: [] as any[],
  effectiveDefaultChatMode: "build",
  hasManuallySelectedChatMode: false,
  inputValue: "Build a notes app",
  initialChatMode: "build",
  isAnyProviderSetup: false,
  isLoadingLanguageModelProviders: false,
  isSettingsLoading: false,
  isExistingAppSubmission: false,
  navigate: vi.fn(),
  phase: "idle",
  posthogCapture: vi.fn(),
  selectedApp: null as any,
  send: vi.fn(() => true),
  settings: { selectedChatMode: "build" } as any,
  setInputValue: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtom: () => [mocks.inputValue, mocks.setInputValue],
  useAtomValue: (atom: { debugLabel?: string }) => {
    if (atom.debugLabel === "homeSelectedAppAtom") return mocks.selectedApp;
    if (atom.debugLabel === "attachmentsAtom") return mocks.attachments;
    if (atom.debugLabel === "hasManuallySelectedChatModeAtom") {
      return mocks.hasManuallySelectedChatMode;
    }
    if (atom.debugLabel === "firstPromptSagaAtom") {
      return {
        phase: mocks.phase,
        hasArmedPayload: false,
        isExistingAppSubmission: mocks.isExistingAppSubmission,
      };
    }
    return undefined;
  },
}));

vi.mock("@/first_prompt/FirstPromptProvider", () => ({
  useFirstPromptSend: () => mocks.send,
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.posthogCapture }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({}),
}));
vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    isLoading: mocks.isLoadingLanguageModelProviders,
    isAnyProviderSetup: () => mocks.isAnyProviderSetup,
  }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    envVars: {},
    loading: mocks.isSettingsLoading,
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));
vi.mock("@/hooks/useFreeAgentQuota", () => ({
  useFreeAgentQuota: () => ({ isLoading: false, isQuotaExceeded: false }),
}));
vi.mock("@/hooks/useInitialChatMode", () => ({
  useInitialChatMode: () => mocks.initialChatMode,
}));
vi.mock("@/lib/schemas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/schemas")>()),
  getEffectiveDefaultChatMode: () => mocks.effectiveDefaultChatMode,
  hasDyadProKey: () => false,
}));
vi.mock("@/lib/homeChatMode", () => ({
  getHomeDefaultChatMode: () => mocks.effectiveDefaultChatMode,
}));
vi.mock("@/components/chat/HomeChatInput", () => ({
  HomeChatInput: ({ onSubmit }: { onSubmit: (options?: any) => boolean }) => (
    <button
      type="button"
      onClick={() =>
        onSubmit({
          attachments: mocks.attachments,
          selectedApp: mocks.selectedApp ?? undefined,
        })
      }
    >
      Submit home prompt
    </button>
  ),
}));
vi.mock("@/components/TelemetryBanner", () => ({ PrivacyBanner: () => null }));
vi.mock("@/components/ImportAppButton", () => ({
  ImportAppButton: () => null,
}));
vi.mock("@/components/FeaturedAppShowcase", () => ({
  FeaturedAppShowcase: () => null,
}));

describe("HomePage first-prompt projection", () => {
  beforeEach(() => {
    mocks.attachments = [];
    mocks.effectiveDefaultChatMode = "build";
    mocks.hasManuallySelectedChatMode = false;
    mocks.inputValue = "Build a notes app";
    mocks.initialChatMode = "build";
    mocks.isAnyProviderSetup = false;
    mocks.isLoadingLanguageModelProviders = false;
    mocks.isSettingsLoading = false;
    mocks.isExistingAppSubmission = false;
    mocks.phase = "idle";
    mocks.posthogCapture.mockReset();
    mocks.selectedApp = null;
    mocks.send.mockReset();
    mocks.send.mockReturnValue(true);
    mocks.settings = { selectedChatMode: "build" };
    mocks.updateSettings.mockReset();
  });

  it("submits a captured payload to the machine", () => {
    const attachment = { file: new File(["x"], "x.txt"), type: "chat-context" };
    mocks.attachments = [attachment];
    mocks.selectedApp = { id: 9, name: "Existing" };
    mocks.settings = { selectedChatMode: "plan" };
    mocks.hasManuallySelectedChatMode = true;
    render(<HomePage />);

    fireEvent.click(screen.getByRole("button", { name: "Submit home prompt" }));

    expect(mocks.send).toHaveBeenCalledWith({
      type: "SUBMIT",
      payload: {
        prompt: "Build a notes app",
        attachments: [attachment],
        selectedApp: { id: 9, name: "Existing" },
        chatMode: "plan",
        isChatModeExplicit: true,
      },
    });
  });

  it("arms the setup detour with the same captured payload", () => {
    render(<HomePage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Connect AI to build/ }),
    );

    expect(mocks.send).toHaveBeenCalledWith({
      type: "ARM_FOR_SETUP",
      payload: {
        prompt: "Build a notes app",
        attachments: [],
        selectedApp: undefined,
        chatMode: "build",
        isChatModeExplicit: false,
      },
    });
  });

  it("shows the loading projection for every active orchestration phase", () => {
    for (const phase of [
      "creating",
      "postCreate",
      "dispatching",
      "navigating",
    ]) {
      mocks.phase = phase;
      const view = render(<HomePage />);
      expect(screen.getByText("buildingApp")).toBeTruthy();
      view.unmount();
    }
  });

  it("keeps the composer visible while checking providers", () => {
    mocks.phase = "checkingProviders";
    render(<HomePage />);

    expect(
      screen.getByRole("button", { name: "Submit home prompt" }),
    ).toBeTruthy();
    expect(screen.queryByText("buildingApp")).toBeNull();
  });

  it("preserves existing-app loading copy", () => {
    mocks.phase = "dispatching";
    mocks.isExistingAppSubmission = true;
    render(<HomePage />);

    expect(screen.getByText("startingChat")).toBeTruthy();
    expect(screen.getByText("creatingNewChat")).toBeTruthy();
    expect(screen.queryByText("buildingApp")).toBeNull();
  });

  it("keeps the effective default chat-mode synchronization", async () => {
    mocks.effectiveDefaultChatMode = "local-agent";
    render(<HomePage />);

    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedChatMode: "local-agent",
      }),
    );
  });
});
