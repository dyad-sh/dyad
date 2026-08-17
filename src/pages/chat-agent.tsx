import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { ChatAgentComposer } from "@/components/chat-agent/ChatAgentComposer";
import { JumpToLatestButton } from "@/components/chat-agent/JumpToLatestButton";
import { ChatAgentHeader } from "@/components/chat-agent/ChatAgentHeader";
import { ChatAgentMessageRow } from "@/components/chat-agent/ChatAgentMessageRow";
import { ChatAgentActivityIndicator } from "@/components/chat-agent/ChatAgentActivityIndicator";
import { ChatAgentHistoryDialog } from "@/components/chat-agent/ChatAgentHistoryDialog";
import type { MessageFeedback } from "@/components/chat-agent/ChatAgentMessageActions";
import type {
  ChatAgentConversation,
  ChatAgentMessage,
  ChatAgentOpenTab,
  ChatAgentToolResult,
} from "@/components/chat-agent/types";
import { useChatAgentStream } from "@/hooks/useChatAgentStream";
import { useAtom, useSetAtom } from "jotai";
import {
  activeChatAgentTabAtom,
  chatAgentAttachmentsAtom,
  chatAgentHistoryAtom,
  chatAgentOpenTabsAtom,
  busyChatSessionsAtom,
  MAX_CHAT_AGENT_HISTORY,
} from "@/atoms/chatAgentAtoms";
import {
  describeAttachments,
  getFirstImageAttachmentDataUrl,
  needsDocumentReading,
  prepareChatAgentMessage,
} from "@/lib/chat_agent_attachments";
import {
  buildChatAgentMcpActionsMessage,
  getChatAgentMcpActionSelectionKeys,
  type ChatAgentMcpAction,
} from "@/lib/chat_agent_mcp_actions";
import { detectImagePrompt } from "@/lib/chat_agent_image_intent";
import { detectVideoPrompt } from "@/lib/chat_agent_video_intent";
import { ipc } from "@/ipc/types";
import { DEFAULT_VIDEO_MODEL } from "@/ipc/types/video_generation";
import { useSettings } from "@/hooks/useSettings";
import { TooltipProvider } from "@/components/ui/tooltip";
import { showError, showSuccess } from "@/lib/toast";
import { getAssignedModelForRole } from "@/lib/model_roles";
import { useChatAutoScroll } from "@/hooks/useChatAutoScroll";
import {
  closeChatAgentTab,
  openChatAgentTab,
  syncChatAgentTab,
} from "@/lib/chat_agent_tabs";
import { pruneEmptyAssistantMessages } from "@/lib/chat_agent_messages";
import { chatAgentConversationTitle } from "@/lib/chat_agent_conversation_title";
import { mergeSettledChatTabsIntoHistory } from "@/lib/chat_agent_history";

/**
 * How often the live transcript is mirrored into the durable tab list. Long
 * enough that streaming does not thrash localStorage, short enough that a
 * crash costs at most this much of an answer.
 */
const TAB_SYNC_INTERVAL_MS = 400;

/** Shared empty value, so "nothing is busy" never re-renders the tab bar. */
const EMPTY_BUSY_SESSIONS: readonly string[] = [];

function createBlankConversation(projectId?: string | null): ChatAgentOpenTab {
  return {
    id: crypto.randomUUID(),
    title: "New conversation",
    messages: [],
    vectorCollectionIds: [],
    // Stamped from whatever project is active when the conversation starts.
    projectId: projectId ?? null,
    updatedAt: Date.now(),
  };
}

export default function ChatAgentPage() {
  // Read before the initial tab is built below, which happens during the first
  // render and stamps the conversation with the project it started in.
  const { settings: settingsForProject } = useSettings();
  const activeProjectId = settingsForProject?.activeProjectId ?? null;
  const [openTabs, setOpenTabs] = useAtom(chatAgentOpenTabsAtom);
  const [persistedActiveId, setPersistedActiveId] = useAtom(
    activeChatAgentTabAtom,
  );
  const initialTabRef = useRef<ChatAgentOpenTab | null>(null);
  if (!initialTabRef.current) {
    initialTabRef.current =
      openTabs.find((tab) => tab.id === persistedActiveId) ??
      openTabs[0] ??
      createBlankConversation(activeProjectId);
  }
  const [sessionId, setSessionId] = useState<string>(initialTabRef.current.id);
  const [messages, setMessages] = useState<ChatAgentMessage[]>(
    pruneEmptyAssistantMessages(initialTabRef.current.messages),
  );
  const [vectorCollectionIds, setVectorCollectionIds] = useState<string[]>(
    initialTabRef.current.vectorCollectionIds ?? [],
  );
  const [messageFeedback, setMessageFeedback] = useState<
    Record<string, MessageFeedback>
  >({});
  /** The assistant message being written, per session — one per open tab. */
  const assistantMessageIdRef = useRef(new Map<string, string>());
  /**
   * The tab on screen right now, readable from callbacks that were created in
   * a different tab. Work started in one tab must land in that tab even after
   * the user has moved on.
   */
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;

  /**
   * Applies a change to one session's transcript, wherever it lives: through
   * React state when that tab is on screen, straight into the stored tab when
   * it is not. Without this, a slow answer would land in whichever tab the
   * user happened to switch to — or vanish.
   */
  const updateSessionMessages = useCallback(
    (
      target: string,
      updater: (previous: ChatAgentMessage[]) => ChatAgentMessage[],
    ) => {
      if (target === activeSessionRef.current) {
        // The tab-sync effect writes this through to openTabs.
        setMessages(updater);
        return;
      }
      setOpenTabs((previous) =>
        previous.map((tab) =>
          tab.id === target
            ? { ...tab, messages: updater(tab.messages), updatedAt: Date.now() }
            : tab,
        ),
      );
    },
    [setOpenTabs],
  );

  const title = useMemo(() => chatAgentConversationTitle(messages), [messages]);
  const userMessageHistory = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user" && m.content.trim())
        .map((m) => m.content)
        .reverse(),
    [messages],
  );
  const dayOfWeek = useMemo(() => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[new Date().getDay()]!;
  }, []);
  const [attachments, setAttachments] = useAtom(chatAgentAttachmentsAtom);
  const [history, setHistory] = useAtom(chatAgentHistoryAtom);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Media jobs are tracked per session for the same reason streams are: they
  // outlive the tab they were started from.
  const [generatingImageSessions, setGeneratingImageSessions] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [generatingVideoSessions, setGeneratingVideoSessions] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const markSessionBusy = useCallback(
    (
      setSessions: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
      target: string,
      busy: boolean,
    ) => {
      setSessions((previous) => {
        if (previous.has(target) === busy) return previous;
        const next = new Set(previous);
        if (busy) next.add(target);
        else next.delete(target);
        return next;
      });
    },
    [],
  );
  const isGeneratingImage = generatingImageSessions.has(sessionId);
  const isGeneratingVideo = generatingVideoSessions.has(sessionId);
  const { settings } = useSettings();
  const {
    sendMessage,
    regenerate,
    cancel,
    isStreaming,
    activeTool,
    streamingSessions,
  } = useChatAgentStream(sessionId);
  const isBusy = isStreaming || isGeneratingImage || isGeneratingVideo;

  // localStorage is a fast UI cache; the selected vault/cloud destination is
  // the durable source. Rehydrate missing or newer records from it so the
  // conversation dropdown survives cache clears and reinstalls.
  useEffect(() => {
    let cancelled = false;
    void ipc.storage
      .listConversations()
      .then((stored) => {
        if (cancelled || stored.length === 0) return;
        setHistory((previous) => {
          const byId = new Map(previous.map((item) => [item.id, item]));
          for (const conversation of stored) {
            const existing = byId.get(conversation.id);
            if (existing && existing.updatedAt >= conversation.updatedAt) {
              continue;
            }
            byId.set(conversation.id, {
              id: conversation.id,
              title: conversation.title,
              updatedAt: conversation.updatedAt,
              messages: conversation.messages.map((message, index) => ({
                id: `${conversation.id}-stored-${index}`,
                role: message.role,
                content: message.content,
              })),
            });
          }
          return [...byId.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_CHAT_AGENT_HISTORY);
        });
      })
      .catch((error) => {
        console.warn("Could not load stored Chat Agent conversations", error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    settings?.storage?.destination,
    settings?.storage?.localVaultPath,
    setHistory,
  ]);

  // Tell the tab bar which conversations are still working, so a background
  // answer is visibly in progress rather than silently finishing offscreen.
  const setBusyChatSessions = useSetAtom(busyChatSessionsAtom);
  useEffect(() => {
    const busy = new Set([
      ...streamingSessions,
      ...generatingImageSessions,
      ...generatingVideoSessions,
    ]);
    setBusyChatSessions(busy.size > 0 ? [...busy] : EMPTY_BUSY_SESSIONS);
  }, [
    streamingSessions,
    generatingImageSessions,
    generatingVideoSessions,
    setBusyChatSessions,
  ]);
  // Leaving Chat Agent must not leave stale spinners in the tab bar.
  useEffect(
    () => () => setBusyChatSessions(EMPTY_BUSY_SESSIONS),
    [setBusyChatSessions],
  );
  // Video generation runs on a provider job with no cancel route, so stop is
  // offered only for the work we can genuinely interrupt.
  const imageRequestIdRef = useRef(new Map<string, string>());
  const canStop = isStreaming || isGeneratingImage;
  const handleStop = useCallback(() => {
    if (isStreaming) cancel();
    const requestId = imageRequestIdRef.current.get(sessionId);
    if (requestId) {
      void ipc.imageGeneration.cancelImageGeneration({ requestId });
    }
  }, [cancel, isStreaming, sessionId]);
  const {
    scrollRef,
    handleScroll,
    followLatest,
    isFollowing,
    pendingCount,
    scrollIntentHandlers,
  } = useChatAutoScroll({
    conversationId: sessionId,
    contentVersion: messages,
    isStreaming: isBusy,
  });

  // Keep every open tab durable, including a brand-new empty tab. This is
  // separate from history because closing a tab must not delete its transcript.
  //
  // The tab list is localStorage-backed, so each write re-serialises every open
  // conversation. Doing that per streamed token — twenty-plus times a second,
  // synchronously — is what makes long chats stutter, so the mirror is
  // throttled and flushed explicitly at the moments staleness would be visible.
  const latestTabRef = useRef({
    sessionId,
    title,
    messages,
    vectorCollectionIds,
  });
  latestTabRef.current = {
    sessionId,
    title,
    messages,
    vectorCollectionIds,
  };
  const tabSyncTimerRef = useRef<number | null>(null);

  const flushTabSync = useCallback(() => {
    if (tabSyncTimerRef.current !== null) {
      window.clearTimeout(tabSyncTimerRef.current);
      tabSyncTimerRef.current = null;
    }
    const {
      sessionId: id,
      title: tabTitle,
      messages: tabMessages,
      vectorCollectionIds: tabVectorCollectionIds,
    } = latestTabRef.current;
    setOpenTabs((prev) =>
      syncChatAgentTab(prev, {
        id,
        title: tabTitle,
        messages: tabMessages,
        vectorCollectionIds: tabVectorCollectionIds,
        updatedAt: Date.now(),
      }),
    );
  }, [setOpenTabs]);

  useEffect(() => {
    if (tabSyncTimerRef.current !== null) return;
    tabSyncTimerRef.current = window.setTimeout(() => {
      tabSyncTimerRef.current = null;
      flushTabSync();
    }, TAB_SYNC_INTERVAL_MS);
  }, [messages, title, vectorCollectionIds, flushTabSync]);

  // Whatever is pending must reach storage before the page goes away.
  useEffect(() => () => flushTabSync(), [flushTabSync]);

  // A conversation closed mid-answer must not keep generating. The text has
  // nowhere to land, and tokens are billed until the model stops — so closing
  // a tab from anywhere in the app stops its stream too.
  useEffect(() => {
    if (streamingSessions.size === 0) return;
    const open = new Set(openTabs.map((tab) => tab.id));
    for (const id of streamingSessions) {
      if (!open.has(id)) cancel(id);
    }
  }, [openTabs, streamingSessions, cancel]);

  // The active id changes far less often than the transcript, so it gets its
  // own effect rather than a storage write per token.
  useEffect(() => {
    setPersistedActiveId(sessionId);
  }, [sessionId, setPersistedActiveId]);

  // Every settled open conversation belongs in the picker, including a reply
  // that finished in a background tab.
  useEffect(() => {
    const busy = new Set([
      ...streamingSessions,
      ...generatingImageSessions,
      ...generatingVideoSessions,
    ]);
    setHistory((previous) =>
      mergeSettledChatTabsIntoHistory(previous, openTabs, busy),
    );
  }, [
    generatingImageSessions,
    generatingVideoSessions,
    openTabs,
    setHistory,
    streamingSessions,
  ]);

  // A conversation in a project is also recorded there, so it survives the
  // tab being closed and can be continued from the project itself.
  useEffect(() => {
    if (isStreaming || messages.length === 0) return;
    const hasUserMessage = messages.some(
      (message) => message.role === "user" && message.content.trim(),
    );
    if (!hasUserMessage) return;
    // A conversation in a project is also recorded there, so it survives the
    // tab being closed and can be continued from the project itself.
    const projectId = openTabs.find((tab) => tab.id === sessionId)?.projectId;
    if (projectId) {
      void ipc.project
        .saveConversation({
          projectId,
          conversationId: sessionId,
          title,
          updatedAt: Date.now(),
          messages: messages.map(({ role, content }) => ({ role, content })),
        })
        .catch(() => {
          // Recording is a convenience; failing to write must not interrupt
          // the conversation the user is having.
        });
    }
  }, [isStreaming, messages, openTabs, sessionId, title, vectorCollectionIds]);

  const handleNewChat = () => {
    // A new tab never waits on an old one: work already running keeps running
    // in the tab that started it.
    flushTabSync();
    const conversation = createBlankConversation(activeProjectId);
    setOpenTabs((prev) => [...prev, conversation]);
    setPersistedActiveId(conversation.id);
    setSessionId(conversation.id);
    setMessages([]);
    setVectorCollectionIds([]);
    setMessageFeedback({});
    setAttachments([]);
  };

  // Register the conversation this page opened with, so it shows up in the
  // workspace tab bar like every other open tab.
  useEffect(() => {
    const initial = initialTabRef.current;
    if (!initial) return;
    setOpenTabs((prev) =>
      prev.some((tab) => tab.id === initial.id) ? prev : [...prev, initial],
    );
    setPersistedActiveId(initial.id);
    // Mount only: later tabs are registered as they are created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the tab label in step with the conversation as it gains messages.
  useEffect(() => {
    setOpenTabs((prev) => {
      const existing = prev.find((tab) => tab.id === sessionId);
      if (!existing || existing.title === title) return prev;
      return prev.map((tab) =>
        tab.id === sessionId ? { ...tab, title } : tab,
      );
    });
  }, [sessionId, title, setOpenTabs]);

  // The tab bar lives in the app chrome now, so a selection there arrives as
  // a change to the persisted active id. Load that conversation when it does.
  useEffect(() => {
    if (!persistedActiveId || persistedActiveId === sessionId) return;
    const target = openTabs.find((tab) => tab.id === persistedActiveId);
    if (!target) return;
    // Commit the outgoing tab first: it is still the one in React state here,
    // and a throttled write must not lose the last second of it.
    flushTabSync();
    // Switching away is always allowed; the outgoing tab keeps generating and
    // its text keeps landing in its own transcript.
    setSessionId(target.id);
    setMessages(pruneEmptyAssistantMessages(target.messages));
    setVectorCollectionIds(target.vectorCollectionIds ?? []);
    setMessageFeedback({});
  }, [persistedActiveId, sessionId, openTabs, flushTabSync]);

  const handleLoadConversation = (conversation: ChatAgentConversation) => {
    flushTabSync();
    const openConversation =
      openTabs.find((tab) => tab.id === conversation.id) ?? conversation;
    setOpenTabs((prev) => openChatAgentTab(prev, conversation));
    setPersistedActiveId(openConversation.id);
    setSessionId(openConversation.id);
    setMessages(pruneEmptyAssistantMessages(openConversation.messages));
    setVectorCollectionIds(openConversation.vectorCollectionIds ?? []);
    setMessageFeedback({});
    setAttachments([]);
    setHistoryOpen(false);
  };

  const handleDeleteConversation = async (id: string) => {
    // Deleting a conversation that is still answering stops it first, rather
    // than leaving an orphaned stream writing to a transcript that is gone.
    cancel(id);
    assistantMessageIdRef.current.delete(id);
    const conversation =
      history.find((item) => item.id === id) ??
      openTabs.find((item) => item.id === id);
    try {
      await ipc.storage.deleteConversation({ conversationId: id });
      if (conversation?.projectId) {
        await ipc.project
          .deleteConversation({
            projectId: conversation.projectId,
            conversationId: id,
          })
          .catch((error) => {
            console.warn("Could not remove project conversation copy", error);
          });
      }
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "Could not delete the stored conversation.",
      );
      return;
    }
    setHistory((prev) => prev.filter((c) => c.id !== id));
    const { tabs: remaining, fallback } = closeChatAgentTab(openTabs, id);
    // Deleting from history is permanent, so also remove any matching open tab.
    if (id === sessionId) {
      const next = fallback ?? createBlankConversation(activeProjectId);
      setOpenTabs(fallback ? remaining : [next]);
      setPersistedActiveId(next.id);
      setSessionId(next.id);
      setMessages(pruneEmptyAssistantMessages(next.messages));
      setVectorCollectionIds(next.vectorCollectionIds ?? []);
      setMessageFeedback({});
      setAttachments([]);
    } else {
      setOpenTabs(remaining);
    }
    showSuccess("Conversation deleted.");
  };

  const handleFeedback = (messageId: string, feedback: MessageFeedback) => {
    setMessageFeedback((prev) => ({ ...prev, [messageId]: feedback }));
  };

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);

  /**
   * Callbacks bound to the tab that started the response, so a stream still
   * writes into its own transcript after the user switches tabs.
   */
  const makeStreamCallbacks = (target: string) => ({
    onAssistantFlush: (content: string) => {
      const assistantId = assistantMessageIdRef.current.get(target);
      if (!assistantId) return;
      updateSessionMessages(target, (prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content } : m)),
      );
    },
    onToolResult: (result: ChatAgentToolResult) => {
      const assistantId = assistantMessageIdRef.current.get(target);
      if (!assistantId) return;
      updateSessionMessages(target, (prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, toolResults: [...(m.toolResults ?? []), result] }
            : m,
        ),
      );
    },
    onRagSources: (ragSources: ChatAgentMessage["ragSources"]) => {
      const assistantId = assistantMessageIdRef.current.get(target);
      if (!assistantId || !ragSources) return;
      updateSessionMessages(target, (prev) =>
        prev.map((message) =>
          message.id === assistantId ? { ...message, ragSources } : message,
        ),
      );
    },
    onComplete: () => {
      assistantMessageIdRef.current.delete(target);
      updateSessionMessages(target, pruneEmptyAssistantMessages);
    },
    onError: () => {
      assistantMessageIdRef.current.delete(target);
      updateSessionMessages(target, pruneEmptyAssistantMessages);
    },
  });

  const handleRegenerate = (assistantMessageId: string) => {
    if (isStreaming) return;
    const target = sessionId;
    const assistantId = crypto.randomUUID();
    assistantMessageIdRef.current.set(target, assistantId);
    setMessageFeedback((prev) => {
      const next = { ...prev };
      delete next[assistantMessageId];
      return next;
    });
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === assistantMessageId);
      if (idx < 0) return prev;
      return [
        ...prev.slice(0, idx),
        { id: assistantId, role: "assistant", content: "" },
      ];
    });
    regenerate(
      makeStreamCallbacks(target),
      messages.map(({ role, content }) => ({ role, content })),
    );
  };

  const handleGenerateImage = async (
    displayContent: string,
    prompt: string,
  ) => {
    const userMessage: ChatAgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: displayContent,
    };
    // The tab that asked for the image owns the result, even if the user has
    // moved to another tab by the time it arrives.
    const target = sessionId;
    const assistantId = crypto.randomUUID();
    updateSessionMessages(target, (prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        generatingImage: true,
      },
    ]);
    markSessionBusy(setGeneratingImageSessions, target, true);
    const requestId = crypto.randomUUID();
    imageRequestIdRef.current.set(target, requestId);
    try {
      const result = await ipc.imageGeneration.generateAgentImage({
        prompt,
        requestId,
        model:
          (settings
            ? getAssignedModelForRole(settings, "image")?.name
            : undefined) ?? settings?.imageAgentModel,
      });
      updateSessionMessages(target, (prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                generatingImage: false,
                images: result.images,
                imageModel: result.model,
                mediaPrompt: prompt,
                content: result.text?.trim() || "",
              }
            : m,
        ),
      );
      // Persist to the Library and the configured durable storage destination.
      void Promise.all(
        result.images.map((image) =>
          ipc.imageGeneration.saveImageToLibrary({ image, prompt }),
        ),
      )
        .then((savedImages) => {
          const destination = savedImages.find(
            (image) => image.storageDestination,
          )?.storageDestination;
          if (destination === "local") {
            showSuccess("Generated image saved to your Local Vault");
          } else if (destination === "cloud") {
            showSuccess("Generated image saved to Vercel Blob");
          }
        })
        .catch((error) => {
          showError(
            error instanceof Error
              ? error.message
              : "The image was generated but could not be saved.",
          );
        });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateSessionMessages(target, (prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                generatingImage: false,
                content: `Sorry, I couldn't generate that image. ${message}`,
              }
            : m,
        ),
      );
    } finally {
      markSessionBusy(setGeneratingImageSessions, target, false);
      imageRequestIdRef.current.delete(target);
    }
  };

  const handleGenerateVideo = async (
    displayContent: string,
    prompt: string,
    format: "youtube_shorts" | "instagram_reels",
    inputImage?: string,
    durationSeconds?: number,
  ) => {
    const userMessage: ChatAgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: displayContent,
    };
    // Video takes minutes, so switching tabs while it runs is the normal case
    // rather than the exception. Bind the result to the tab that asked.
    const target = sessionId;
    const assistantId = crypto.randomUUID();
    updateSessionMessages(target, (prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        generatingVideo: true,
      },
    ]);
    markSessionBusy(setGeneratingVideoSessions, target, true);
    try {
      const result = await ipc.videoGeneration.generate({
        prompt,
        format,
        model:
          (settings
            ? getAssignedModelForRole(settings, "video")?.name
            : undefined) ??
          settings?.videoAgentModel ??
          DEFAULT_VIDEO_MODEL,
        inputImage,
        // The provider clamps this to its own minimum, so asking for less
        // than ten seconds still yields a ten-second clip.
        duration: durationSeconds != null ? String(durationSeconds) : undefined,
      });
      const finished = {
        generatingVideo: false,
        videoUrl: result.videoUrl,
        videoModel: result.model,
        videoFormat: result.format,
        mediaPrompt: prompt,
        // No filler caption: it added nothing and forced an empty glass
        // panel to render behind the video.
        content: "",
      };
      updateSessionMessages(target, (prev) => {
        // Minutes of waiting must not be thrown away because the placeholder
        // is gone — if it is, post the video as a new message instead.
        if (!prev.some((message) => message.id === assistantId)) {
          return [...prev, { id: assistantId, role: "assistant", ...finished }];
        }
        return prev.map((message) =>
          message.id === assistantId ? { ...message, ...finished } : message,
        );
      });
      showSuccess("Video generated");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      updateSessionMessages(target, (prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                generatingVideo: false,
                content: `Sorry, I couldn't generate that video. ${errorMessage}`,
              }
            : message,
        ),
      );
      showError(errorMessage);
    } finally {
      markSessionBusy(setGeneratingVideoSessions, target, false);
    }
  };

  const handleSubmit = async (
    text: string,
    selectedMcpActions: ChatAgentMcpAction[],
    vectorCollectionIds: string[],
    dataSourceIds: string[],
    displayTextOverride?: string,
  ) => {
    // Reading a document happens before the model is called and can take a
    // while, so this turn is pinned to the tab it was sent from.
    const target = sessionId;
    // The project this conversation belongs to, not whichever is active now.
    // A chat started in a project keeps it; one started outside every project
    // stays outside, which is what makes the project sit above the chat.
    const conversationProjectId =
      openTabs.find((tab) => tab.id === target)?.projectId ?? null;
    // Captured before the composer is cleared, so the sent bubble can show
    // which files went with it.
    const sentAttachments = describeAttachments(attachments);
    const readingDocument = attachments.some((attachment) =>
      needsDocumentReading(attachment.file),
    );

    // Documents are read before the model is called, which takes real time.
    // Post the turn first so the upload is acknowledged and the reading
    // animation is visible, rather than the UI sitting silent.
    let placeholderId: string | null = null;
    if (readingDocument) {
      placeholderId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      updateSessionMessages(target, (prev) => [
        ...prev,
        {
          id: userId,
          role: "user",
          content: text.trim() || attachments[0].file.name,
          attachments: sentAttachments,
        },
        {
          id: placeholderId!,
          role: "assistant",
          content: "",
          readingDocument: true,
        },
      ]);
    }

    let prepared: Awaited<ReturnType<typeof prepareChatAgentMessage>>;
    try {
      prepared = await prepareChatAgentMessage(text, attachments);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The document could not be read.";
      if (placeholderId) {
        const id = placeholderId;
        updateSessionMessages(target, (prev) =>
          prev.map((message) =>
            message.id === id
              ? {
                  ...message,
                  readingDocument: false,
                  content: `Sorry, I couldn't read that document. ${errorMessage}`,
                }
              : message,
          ),
        );
      }
      showError(errorMessage);
      return;
    }
    const content = prepared.modelText;

    // The reading card has served its purpose; the turn continues below.
    if (placeholderId) {
      const id = placeholderId;
      updateSessionMessages(target, (prev) =>
        prev.filter((message) => message.id !== id),
      );
    }
    if (prepared.attachmentErrors.length > 0) {
      showError(prepared.attachmentErrors.join("\n"));
    }
    if (!content) return;

    const videoIntent = detectVideoPrompt(text);
    const inputImage = videoIntent
      ? await getFirstImageAttachmentDataUrl(attachments)
      : undefined;
    setAttachments([]);

    if (videoIntent && selectedMcpActions.length === 0) {
      await handleGenerateVideo(
        content,
        videoIntent.prompt,
        videoIntent.format,
        inputImage,
        videoIntent.durationSeconds,
      );
      return;
    }

    // If the user is asking for an image (and not invoking MCP tools), generate
    // one with the default image model instead of streaming a text reply.
    const imagePrompt = detectImagePrompt(text);
    if (imagePrompt && selectedMcpActions.length === 0) {
      await handleGenerateImage(content, imagePrompt);
      return;
    }

    const messageForApi =
      selectedMcpActions.length > 0
        ? buildChatAgentMcpActionsMessage(selectedMcpActions, content)
        : content;
    const selectedMcpKeys =
      selectedMcpActions.length > 0
        ? getChatAgentMcpActionSelectionKeys(selectedMcpActions)
        : null;

    sendMessage(
      {
        message: messageForApi,
        displayMessage: displayTextOverride ?? prepared.displayText,
        selectedMcpToolKeys: selectedMcpKeys?.toolKeys,
        selectedMcpWorkflowKeys: selectedMcpKeys?.workflowKeys,
        vectorCollectionIds:
          vectorCollectionIds.length > 0 ? vectorCollectionIds : undefined,
        // Only what the user ticked. The main process treats this as the
        // allow-list, so an empty array means the agent gets no database
        // tools at all rather than access to everything.
        dataSourceIds: dataSourceIds.length > 0 ? dataSourceIds : undefined,
        projectId: conversationProjectId,
        conversationHistory: messages.map(({ role, content }) => ({
          role,
          content,
        })),
      },
      {
        onUserMessage: (userContent) => {
          const assistantId = crypto.randomUUID();
          assistantMessageIdRef.current.set(target, assistantId);
          // The document path already posted this turn's user message while
          // the file was being read; posting it again would duplicate it.
          const userMessages: ChatAgentMessage[] = readingDocument
            ? []
            : [
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  content: userContent,
                  attachments: sentAttachments,
                },
              ];
          updateSessionMessages(target, (prev) => [
            ...prev,
            ...userMessages,
            { id: assistantId, role: "assistant", content: "" },
          ]);
        },
        ...makeStreamCallbacks(target),
      },
    );
  };

  const handleSelectCanvaCandidate = (selection: {
    jobId: string;
    candidateId: string;
    conceptNumber: number;
  }) => {
    if (isBusy) return;
    void handleSubmit(
      `Choose Canva candidate ${selection.candidateId} from generation job ${selection.jobId} and create the final editable design.`,
      [],
      vectorCollectionIds,
      [],
      `Use Canva Concept ${selection.conceptNumber}`,
    );
  };

  const handleRetryCanvaGeneration = () => {
    if (isBusy) return;
    void handleSubmit(
      "Retry the Canva design generation now using my original brief. Keep the same requested format and page count, but simplify the visual instructions if Canva needs a cleaner brief.",
      [],
      vectorCollectionIds,
      [],
      "Retry Canva design",
    );
  };

  return (
    <div
      className="chat-agent-page home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="chat-agent-page"
    >
      <ParticleBackground className="z-0" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatAgentHeader
          title={title}
          onNewChat={handleNewChat}
          onOpenHistory={() => setHistoryOpen(true)}
          conversations={history}
          activeId={sessionId}
          onSelectConversation={handleLoadConversation}
        />
        <TooltipProvider delay={200}>
          {messages.length === 0 ? (
            <div
              className="chat-agent-empty-stage"
              data-testid="chat-agent-empty-stage"
            >
              <div className="chat-agent-empty">
                <h2 className="chat-agent-empty-title font-jarvis-display">
                  Hello {dayOfWeek}
                </h2>
              </div>
              <ChatAgentComposer
                onSubmit={handleSubmit}
                disabled={isBusy}
                isStreaming={canStop}
                onStop={handleStop}
                messageHistory={userMessageHistory}
                variant="empty"
                selectedVectorCollectionIds={vectorCollectionIds}
                onVectorCollectionIdsChange={setVectorCollectionIds}
              />
            </div>
          ) : (
            <>
              <div
                ref={scrollRef}
                className="chat-agent-messages"
                onScroll={handleScroll}
                {...scrollIntentHandlers}
              >
                <div className="chat-agent-messages-inner">
                  <div className="chat-agent-thread">
                    {messages.map((message) => {
                      if (
                        isStreaming &&
                        message.role === "assistant" &&
                        !message.content.trim() &&
                        !message.toolResults?.length
                      ) {
                        return null;
                      }
                      return (
                        <ChatAgentMessageRow
                          key={message.id}
                          message={message}
                          isLastAssistant={
                            message.id === lastAssistantMessageId
                          }
                          isStreaming={isStreaming}
                          feedback={messageFeedback[message.id] ?? null}
                          onFeedback={handleFeedback}
                          onRegenerate={
                            message.id === lastAssistantMessageId
                              ? () => handleRegenerate(message.id)
                              : undefined
                          }
                          onSelectCanvaCandidate={handleSelectCanvaCandidate}
                          onRetryCanvaGeneration={handleRetryCanvaGeneration}
                        />
                      );
                    })}
                    {isStreaming &&
                      messages[messages.length - 1]?.role === "assistant" &&
                      (!messages[messages.length - 1]?.content ||
                        activeTool) && (
                        <article className="chat-agent-turn chat-agent-turn--assistant">
                          <div
                            className="chat-agent-assistant-avatar"
                            aria-hidden
                          >
                            <span className="chat-agent-typing-dots">···</span>
                          </div>
                          <ChatAgentActivityIndicator activeTool={activeTool} />
                        </article>
                      )}
                  </div>
                </div>
              </div>
              <div className="relative">
                <JumpToLatestButton
                  visible={!isFollowing}
                  onClick={followLatest}
                  pendingCount={pendingCount}
                  isStreaming={isBusy}
                />
                <ChatAgentComposer
                  onSubmit={handleSubmit}
                  disabled={isBusy}
                  isStreaming={canStop}
                  onStop={handleStop}
                  messageHistory={userMessageHistory}
                  selectedVectorCollectionIds={vectorCollectionIds}
                  onVectorCollectionIdsChange={setVectorCollectionIds}
                />
              </div>
            </>
          )}
        </TooltipProvider>
      </div>

      <ChatAgentHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        conversations={history}
        activeId={sessionId}
        onSelect={handleLoadConversation}
        onDelete={handleDeleteConversation}
      />
    </div>
  );
}
