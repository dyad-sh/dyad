import { act, cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode, SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStreamingByIdAtom,
  selectedChatIdAtom,
  streamingPreviewByChatIdAtom,
} from "@/atoms/chatAtoms";
import { applyPreviewChunk } from "@/lib/streamingPreviewSync";
import { makeAgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/chat_search_spec_utils";
import type { HistoryReportStats } from "@/pro/main/ipc/handlers/local_agent/tools/explore_chat_history_report";
import { readChatTool } from "@/pro/main/ipc/handlers/local_agent/tools/read_chat";

const mocks = vi.hoisted(() => ({
  runExploreChatHistorySubagent: vi.fn(),
}));

vi.mock(
  "@/pro/main/ipc/handlers/local_agent/tools/explore_chat_history_subagent",
  () => ({
    runExploreChatHistorySubagent: mocks.runExploreChatHistorySubagent,
  }),
);

vi.mock("./CodeHighlight", () => ({
  CodeHighlight: ({ children }: { children?: ReactNode }) => (
    <pre>{children}</pre>
  ),
}));

vi.mock("../preview_panel/FileEditor", () => ({
  FileEditor: () => null,
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: vi.fn() }),
}));

import { exploreChatHistoryTool } from "@/pro/main/ipc/handlers/local_agent/tools/explore_chat_history";
import { DyadMarkdownParser } from "./DyadMarkdownParser";

const REPORT_STATS: HistoryReportStats = {
  chats: 1,
  evidence: 1,
  outcome: "complete",
  fabricatedCitations: 0,
};

describe("explore_chat_history streaming preview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reproduces the pending card emitted while the history sub-agent is still running", async () => {
    let reportProgress: ((text: string) => void) | undefined;
    let finishSubagent!: () => void;
    mocks.runExploreChatHistorySubagent.mockImplementation(
      ({ onProgress }: { onProgress?: (text: string) => void }) => {
        reportProgress = onProgress;
        return new Promise((resolve) => {
          finishSubagent = () =>
            resolve({
              report: {
                text: "Historical evidence [chat 2, message 3]",
                stats: REPORT_STATS,
              },
            });
        });
      },
    );

    const chatId = 1;
    const store = createStore();
    store.set(selectedChatIdAtom, chatId);
    store.set(isStreamingByIdAtom, new Map([[chatId, true]]));

    let latestPreviewXml = "";
    const setPreview = (update: SetStateAction<Map<number, string>>) =>
      store.set(streamingPreviewByChatIdAtom, update);
    const ctx = makeAgentContext({
      isDyadPro: true,
      chatId,
      onXmlStream: (xml) => {
        latestPreviewXml = xml;
        applyPreviewChunk(setPreview, chatId, { content: xml });
      },
    });

    render(
      <Provider store={store}>
        <DyadMarkdownParser content="" showStreamingPreview />
      </Provider>,
    );

    let execution!: Promise<unknown>;
    await act(async () => {
      execution = exploreChatHistoryTool.execute(
        { query: "what did we decide about auth?" },
        ctx,
      );
      await Promise.resolve();
    });

    // The streaming sidecar protocol deliberately carries an open custom tag.
    // This is the exact intermediate payload that looks malformed when logged.
    expect(latestPreviewXml).toContain("<dyad-explore-chat-history");
    expect(latestPreviewXml).not.toContain("</dyad-explore-chat-history>");

    const card = screen.getByTestId("dyad-explore-chat-history");
    expect(card.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText('"what did we decide about auth?"')).toBeTruthy();
    expect(screen.getByText("Exploring...")).toBeTruthy();
    expect(screen.getByText("Exploring chat history…")).toBeTruthy();

    // Internal search_chats calls are consent-suppressed child tools and must
    // not leak their legacy card into the parent stream.
    expect(screen.queryByTestId("dyad-search-chats")).toBeNull();

    await act(async () => {
      reportProgress?.("Exploring chat history… (1 search, 1 read)");
    });
    expect(
      screen.getByText("Exploring chat history… (1 search, 1 read)"),
    ).toBeTruthy();
    expect(screen.getAllByTestId("dyad-explore-chat-history")).toHaveLength(1);

    finishSubagent();
    await act(async () => {
      await execution;
    });
  });

  it("normalizes mixed read_chat arguments before the pending card completes", async () => {
    const chatId = 1;
    const store = createStore();
    store.set(selectedChatIdAtom, chatId);
    store.set(isStreamingByIdAtom, new Map([[chatId, true]]));

    const mixedArgs = {
      chat_id: 703,
      around_message_id: 4_134,
      before: 6,
      after: 3,
      offset: 0,
      limit: 10,
    };
    const args = readChatTool.inputSchema.parse(mixedArgs);
    expect(args).toEqual({
      chat_id: 703,
      around_message_id: 4_134,
      before: 6,
      after: 3,
    });

    const previewXml = readChatTool.buildXml?.(args, false);
    expect(previewXml).toBe(
      '<dyad-read-chat chat-id="703" state="pending">Reading chat...</dyad-read-chat>',
    );
    applyPreviewChunk(
      (update) => store.set(streamingPreviewByChatIdAtom, update),
      chatId,
      { content: previewXml! },
    );

    const view = render(
      <Provider store={store}>
        <DyadMarkdownParser
          content="<think>Considering the cited chat</think>"
          showStreamingPreview
        />
      </Provider>,
    );

    const card = screen.getByTestId("dyad-read-chat");
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("CHAT HISTORY")).toBeTruthy();
    expect(screen.getByText("Chat #703")).toBeTruthy();
    expect(screen.getByText("Reading chat...")).toBeTruthy();
    expect(screen.queryByTestId("dyad-explore-chat-history")).toBeNull();

    await act(async () => {
      applyPreviewChunk(
        (update) => store.set(streamingPreviewByChatIdAtom, update),
        chatId,
        { content: "" },
      );
      view.rerender(
        <Provider store={store}>
          <DyadMarkdownParser
            content={
              '<think>Considering the cited chat</think>\n<dyad-read-chat chat-id="703" title="Build indie shop landing page" range="4–7 of 9">Historical messages</dyad-read-chat>'
            }
            showStreamingPreview
          />
        </Provider>,
      );
    });
    expect(screen.getAllByTestId("dyad-read-chat")).toHaveLength(1);
    expect(screen.getByText("Build indie shop landing page")).toBeTruthy();
    expect(screen.getByText(/messages 4–7 of 9/)).toBeTruthy();
    expect(screen.queryByText("Reading chat...")).toBeNull();
  });
});
