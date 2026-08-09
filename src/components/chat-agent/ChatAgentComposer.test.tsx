import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enhancePromptMock = vi.hoisted(() => vi.fn());

// The composer pulls in the editor, model pickers and voice capture; none of
// that matters for the send/stop swap, so they are stubbed out.
vi.mock("@/components/chat/LexicalChatInput", () => ({
  LexicalChatInput: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Chat input"
      data-testid="chat-input"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/chat/VoiceInputButton", () => ({
  VoiceInputButton: () => <button type="button">Voice</button>,
}));
vi.mock("./ChatAgentAttachMenu", () => ({
  ChatAgentAttachMenu: () => null,
}));
vi.mock("./ChatAgentToolMenu", () => ({ ChatAgentToolMenu: () => null }));
vi.mock("./ChatAgentKnowledgeMenu", () => ({
  ChatAgentKnowledgeMenu: ({
    selectedCollectionIds,
    onChange,
  }: {
    selectedCollectionIds: string[];
    onChange: (ids: string[]) => void;
  }) => (
    <button
      type="button"
      data-testid="knowledge-selection"
      onClick={() => onChange([...selectedCollectionIds, "knowledge-base"])}
    >
      {selectedCollectionIds.join(",")}
    </button>
  ),
}));
// Stubbed for the same reason as the knowledge menu: it fetches through
// react-query, and this suite renders the composer without a provider.
vi.mock("./ChatAgentDataSourceMenu", () => ({
  ChatAgentDataSourceMenu: ({
    selectedDataSourceIds,
    onChange,
  }: {
    selectedDataSourceIds: string[];
    onChange: (ids: string[]) => void;
  }) => (
    <button
      type="button"
      data-testid="data-source-selection"
      onClick={() => onChange([...selectedDataSourceIds, "source-1"])}
    >
      {selectedDataSourceIds.join(",")}
    </button>
  ),
}));
vi.mock("./ChatAgentAttachmentsList", () => ({
  ChatAgentAttachmentsList: () => null,
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: null }),
}));
vi.mock("@/hooks/useModelDisplayName", () => ({
  useModelDisplayName: () => "Test Model",
}));
vi.mock("@/hooks/useScrollAndNavigateTo", () => ({
  useScrollAndNavigateTo: () => () => {},
}));
vi.mock("@/hooks/useEnhanceChatAgentPrompt", () => ({
  useEnhanceChatAgentPrompt: () => ({
    enhancePrompt: enhancePromptMock,
    isEnhancing: false,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "chat:chatAgent.stopGenerating") return "Stop generating";
      if (key === "chat:chatAgent.enhancePrompt") return "Improve prompt";
      return key;
    },
  }),
}));

const { ChatAgentComposer } = await import("./ChatAgentComposer");

function renderComposer(props: Record<string, unknown> = {}) {
  return render(<ChatAgentComposer onSubmit={vi.fn()} {...props} />);
}

beforeEach(() => {
  enhancePromptMock.mockReset();
});

describe("ChatAgentComposer send/stop button", () => {
  it("shows send when nothing is generating", () => {
    renderComposer();
    expect(screen.getByTestId("chat-agent-send")).toBeTruthy();
    expect(screen.queryByTestId("chat-agent-stop")).toBeNull();
  });

  it("becomes a stop button while a response is generating", () => {
    renderComposer({ isStreaming: true, onStop: vi.fn(), disabled: true });
    expect(screen.getByTestId("chat-agent-stop")).toBeTruthy();
    expect(screen.queryByTestId("chat-agent-send")).toBeNull();
  });

  it("stops the response when clicked", async () => {
    const onStop = vi.fn();
    renderComposer({ isStreaming: true, onStop, disabled: true });

    await userEvent.click(screen.getByTestId("chat-agent-stop"));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("stays clickable even though the composer is disabled mid-response", () => {
    // `disabled` blocks sending, but stop has to stay reachable — that is the
    // whole point of the swap.
    renderComposer({ isStreaming: true, onStop: vi.fn(), disabled: true });
    const stop = screen.getByTestId("chat-agent-stop") as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
  });

  it("keeps showing send when there is no way to stop", () => {
    // Streaming without a handler would be a stop button that does nothing.
    renderComposer({ isStreaming: true });
    expect(screen.getByTestId("chat-agent-send")).toBeTruthy();
    expect(screen.queryByTestId("chat-agent-stop")).toBeNull();
  });

  it("labels the stop button for screen readers", () => {
    renderComposer({ isStreaming: true, onStop: vi.fn() });
    expect(
      screen.getByRole("button", { name: "Stop generating" }),
    ).toBeTruthy();
  });
});

describe("ChatAgentComposer knowledge selection", () => {
  it("restores a conversation's selection when the composer remounts", async () => {
    function ComposerSwapHarness() {
      const [threadStarted, setThreadStarted] = useState(false);
      const [collectionIds, setCollectionIds] = useState<string[]>([]);
      const composer = (
        <ChatAgentComposer
          onSubmit={vi.fn()}
          selectedVectorCollectionIds={collectionIds}
          onVectorCollectionIdsChange={setCollectionIds}
        />
      );
      return (
        <>
          <button
            type="button"
            onClick={() => setThreadStarted((started) => !started)}
          >
            Toggle thread
          </button>
          {threadStarted ? <main>{composer}</main> : <aside>{composer}</aside>}
        </>
      );
    }

    render(<ComposerSwapHarness />);
    await userEvent.click(screen.getByTestId("knowledge-selection"));
    expect(screen.getByTestId("knowledge-selection").textContent).toBe(
      "knowledge-base",
    );

    // The real page swaps its empty-state composer for the docked composer
    // after the first turn. The selection must come back on that new mount.
    await userEvent.click(
      screen.getByRole("button", { name: "Toggle thread" }),
    );
    expect(screen.getByTestId("knowledge-selection").textContent).toBe(
      "knowledge-base",
    );
  });
});

describe("ChatAgentComposer prompt improvement", () => {
  it("replaces the draft for review without sending it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    enhancePromptMock.mockResolvedValue(
      "Create a responsive portfolio site with a clear project gallery and contact section.",
    );
    renderComposer({ onSubmit });

    const input = screen.getByRole("textbox", { name: "Chat input" });
    await user.clear(input);
    await user.type(input, "make me a portfolio");
    await user.click(screen.getByRole("button", { name: "Improve prompt" }));

    expect(enhancePromptMock).toHaveBeenCalledWith("make me a portfolio");
    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe(
        "Create a responsive portfolio site with a clear project gallery and contact section.",
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
