import { act, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeChatInput } from "./HomeChatInput";

const mocks = vi.hoisted(() => ({
  setInputValue: vi.fn(),
  setSelectedApp: vi.fn(),
  transcription: null as null | ((text: string) => void),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtom: (atom: { debugLabel?: string }) =>
    atom.debugLabel === "homeSelectedAppAtom"
      ? [null, mocks.setSelectedApp]
      : ["Build a notes app", mocks.setInputValue],
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableDyadPro: true,
      enableSelectAppFromHomeChatInput: true,
    },
  }),
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ isStreaming: false }),
}));
vi.mock("@/hooks/useChatModeToggle", () => ({
  useChatModeToggle: () => undefined,
}));
vi.mock("@/hooks/useUserBudgetInfo", () => ({
  useUserBudgetInfo: () => ({ userBudget: { budget: 1 } }),
}));
vi.mock("@/hooks/useTypingPlaceholder", () => ({
  useTypingPlaceholder: () => "something",
}));
vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({ apps: [{ id: 1, name: "Existing" }] }),
}));
vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({
    attachments: [],
    isDraggingOver: false,
    pendingFiles: null,
    handleFileSelect: vi.fn(),
    removeAttachment: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handlePaste: vi.fn(),
    confirmPendingFiles: vi.fn(),
    cancelPendingFiles: vi.fn(),
  }),
}));
vi.mock("@/hooks/useVoiceToText", () => ({
  useVoiceToText: ({
    onTranscription,
  }: {
    onTranscription: (text: string) => void;
  }) => {
    mocks.transcription = onTranscription;
    return {
      isRecording: false,
      isTranscribing: false,
      toggleRecording: vi.fn(),
    };
  },
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({
    render: trigger,
    children,
  }: {
    render: ReactElement;
    children: ReactNode;
  }) => cloneElement(trigger, {}, children),
  TooltipContent: () => null,
}));
vi.mock("./AttachmentsList", () => ({
  AttachmentsList: () => <button type="button">Remove attachment</button>,
}));
vi.mock("./DragDropOverlay", () => ({ DragDropOverlay: () => null }));
vi.mock("./FileAttachmentTypeDialog", () => ({
  FileAttachmentTypeDialog: () => null,
}));
vi.mock("./LexicalChatInput", () => ({
  LexicalChatInput: ({ disabled }: { disabled: boolean }) => (
    <button type="button" disabled={disabled}>
      Editor
    </button>
  ),
}));
vi.mock("../ChatInputControls", () => ({
  ChatInputControls: () => <button type="button">Change mode</button>,
}));
vi.mock("./AuxiliaryActionsMenu", () => ({
  AuxiliaryActionsMenu: () => <button type="button">More actions</button>,
}));
vi.mock("../AppSearchDialog", () => ({ AppSearchDialog: () => null }));
vi.mock("@/pages/home", () => ({}));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));

describe("HomeChatInput disabled state", () => {
  beforeEach(() => {
    mocks.setInputValue.mockReset();
    mocks.setSelectedApp.mockReset();
    mocks.transcription = null;
  });

  it("makes the entire snapshotted composer inert", () => {
    render(<HomeChatInput onSubmit={vi.fn()} disabled />);

    const composer = screen
      .getByTestId("home-chat-input-container")
      .querySelector('[aria-disabled="true"]');
    expect(composer?.hasAttribute("inert")).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Editor" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Voice to text",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("home-app-selector") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      composer?.contains(screen.getByRole("button", { name: "Change mode" })),
    ).toBe(true);
    expect(
      composer?.contains(screen.getByRole("button", { name: "More actions" })),
    ).toBe(true);
  });

  it("ignores a transcription that completes after the payload is locked", () => {
    render(<HomeChatInput onSubmit={vi.fn()} disabled />);

    act(() => mocks.transcription?.("late transcript"));

    expect(mocks.setInputValue).not.toHaveBeenCalled();
  });
});
