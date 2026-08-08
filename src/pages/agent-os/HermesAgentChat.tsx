import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom } from "jotai";

import { ParticleBackground } from "@/components/home/ParticleBackground";
import { ChatAgentComposer } from "@/components/chat-agent/ChatAgentComposer";
import { JumpToLatestButton } from "@/components/chat-agent/JumpToLatestButton";
import { ChatAgentHeader } from "@/components/chat-agent/ChatAgentHeader";
import { ChatAgentHistoryDialog } from "@/components/chat-agent/ChatAgentHistoryDialog";
import {
  ChatAgentAssistantAvatar,
  ChatAgentMessageRow,
} from "@/components/chat-agent/ChatAgentMessageRow";
import type { MessageFeedback } from "@/components/chat-agent/ChatAgentMessageActions";
import type {
  ChatAgentConversation,
  ChatAgentMessage,
} from "@/components/chat-agent/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  chatAgentAttachmentsAtom,
  hermesAgentHistoryAtom,
  MAX_CHAT_AGENT_HISTORY,
} from "@/atoms/chatAgentAtoms";
import {
  describeAttachments,
  prepareChatAgentMessage,
  getFirstImageAttachmentDataUrl,
} from "@/lib/chat_agent_attachments";
import {
  buildChatAgentMcpActionsMessage,
  type ChatAgentMcpAction,
} from "@/lib/chat_agent_mcp_actions";
import { detectImagePrompt } from "@/lib/chat_agent_image_intent";
import { detectVideoPrompt } from "@/lib/chat_agent_video_intent";
import {
  buildHermesApiMessages,
  getHermesConversationTitle,
} from "@/lib/hermes_agent_chat";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import { DEFAULT_VIDEO_MODEL } from "@/ipc/types/video_generation";
import { showError, showSuccess } from "@/lib/toast";
import { getAssignedModelForRole } from "@/lib/model_roles";
import { useChatAutoScroll } from "@/hooks/useChatAutoScroll";
import type { Agent } from "./data";

export function HermesAgentChat({
  agent,
  onBack,
}: {
  agent: Agent;
  onBack: () => void;
}) {
  const [historyByAgent, setHistoryByAgent] = useAtom(hermesAgentHistoryAtom);
  const initialConversation = historyByAgent[agent.id]?.[0];
  const [sessionId, setSessionId] = useState<string>(
    () => initialConversation?.id ?? crypto.randomUUID(),
  );
  const [messages, setMessages] = useState<ChatAgentMessage[]>(
    () => initialConversation?.messages ?? [],
  );
  const [feedback, setFeedback] = useState<Record<string, MessageFeedback>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [attachments, setAttachments] = useAtom(chatAgentAttachmentsAtom);
  const { settings } = useSettings();
  const streamIdRef = useRef<string | null>(null);
  const restorePendingRef = useRef(true);

  const history = historyByAgent[agent.id] ?? [];
  const isBusy = isStreaming || isGeneratingVideo;
  const title = useMemo(
    () => getHermesConversationTitle(messages, agent.name),
    [agent.name, messages],
  );
  const userMessageHistory = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user" && message.content.trim())
        .map((message) => message.content)
        .reverse(),
    [messages],
  );
  const lastAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") return messages[index].id;
    }
    return null;
  }, [messages]);
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

  useEffect(() => {
    if (!restorePendingRef.current) return;
    if (messages.length > 0) {
      restorePendingRef.current = false;
      return;
    }
    const latest = historyByAgent[agent.id]?.[0];
    if (!latest) return;
    restorePendingRef.current = false;
    setSessionId(latest.id);
    setMessages(latest.messages);
  }, [agent.id, historyByAgent, messages.length]);

  useEffect(() => {
    if (isStreaming || messages.length === 0) return;
    if (!messages.some((message) => message.role === "user")) return;
    setHistoryByAgent((current) => {
      const agentHistory = current[agent.id] ?? [];
      const conversation: ChatAgentConversation = {
        id: sessionId,
        title,
        messages,
        updatedAt: Date.now(),
      };
      const existingIndex = agentHistory.findIndex(
        (item) => item.id === sessionId,
      );
      const next =
        existingIndex >= 0
          ? agentHistory.map((item, index) =>
              index === existingIndex ? conversation : item,
            )
          : [conversation, ...agentHistory].slice(0, MAX_CHAT_AGENT_HISTORY);
      return { ...current, [agent.id]: next };
    });
  }, [agent.id, isStreaming, messages, sessionId, setHistoryByAgent, title]);

  const stopStreaming = useCallback(() => {
    const streamId = streamIdRef.current;
    if (!streamId) return;
    ipc.agentOsChatStream.cancel(streamId);
    void ipc.agentOs.chatCancel(streamId);
    streamIdRef.current = null;
    setIsStreaming(false);
  }, []);

  useEffect(
    () => () => {
      const streamId = streamIdRef.current;
      if (streamId) {
        ipc.agentOsChatStream.cancel(streamId);
        void ipc.agentOs.chatCancel(streamId);
      }
    },
    [],
  );

  const saveGeneratedImages = useCallback(
    (images: string[], prompt: string): void => {
      void Promise.all(
        images.map((image) =>
          ipc.imageGeneration.saveImageToLibrary({ image, prompt }),
        ),
      )
        .then((saved) => {
          const destination = saved.find(
            (item) => item.storageDestination,
          )?.storageDestination;
          if (destination === "local") {
            showSuccess("Generated image saved to your Local Vault");
          } else if (destination === "cloud") {
            showSuccess("Generated image saved to Vercel Blob");
          }
        })
        .catch((error) =>
          showError(
            error instanceof Error
              ? error.message
              : "The image was generated but could not be saved.",
          ),
        );
    },
    [],
  );

  const startStream = useCallback(
    (
      conversation: ChatAgentMessage[],
      assistantId: string,
      imagePrompt?: string,
    ) => {
      const streamId = `hermes_${crypto.randomUUID()}`;
      streamIdRef.current = streamId;
      setIsStreaming(true);
      ipc.agentOsChatStream.start(
        {
          streamId,
          agentId: agent.id,
          messages: buildHermesApiMessages(conversation),
        },
        {
          onChunk: ({ delta }) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + delta }
                  : message,
              ),
            );
          },
          onEnd: ({ content, images, model }) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      generatingImage: false,
                      content:
                        message.content ||
                        content ||
                        (images?.length
                          ? "Here's what I created:"
                          : "(The endpoint returned an empty response.)"),
                      images: images?.length ? images : undefined,
                      imageModel: images?.length ? model : undefined,
                    }
                  : message,
              ),
            );
            if (images?.length) {
              saveGeneratedImages(
                images,
                imagePrompt || `Image generated by ${agent.name}`,
              );
            }
            setIsStreaming(false);
            streamIdRef.current = null;
          },
          onError: ({ error }) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      generatingImage: false,
                      content: `Sorry, ${error}`,
                    }
                  : message,
              ),
            );
            setIsStreaming(false);
            streamIdRef.current = null;
            showError(error);
          },
        },
      );
    },
    [agent.id, agent.name, saveGeneratedImages],
  );

  const generateVideo = async (
    displayContent: string,
    prompt: string,
    format: "youtube_shorts" | "instagram_reels",
    inputImage?: string,
  ) => {
    const userMessage: ChatAgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: displayContent,
    };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        generatingVideo: true,
      },
    ]);
    setIsGeneratingVideo(true);
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
      });
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                generatingVideo: false,
                videoUrl: result.videoUrl,
                videoModel: result.model,
                videoFormat: result.format,
                content: "Here's the video I created:",
              }
            : message,
        ),
      );
      showSuccess("Video generated");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setMessages((current) =>
        current.map((message) =>
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
      setIsGeneratingVideo(false);
    }
  };

  const submit = async (
    text: string,
    selectedMcpActions: ChatAgentMcpAction[],
  ) => {
    const prepared = await prepareChatAgentMessage(text, attachments);
    if (prepared.attachmentErrors.length > 0) {
      showError(prepared.attachmentErrors.join("\n"));
    }
    const content = prepared.modelText;
    if (!content) return;
    // Captured before the composer is cleared.
    const sentAttachments = describeAttachments(attachments);

    const videoIntent = detectVideoPrompt(text);
    const inputImage = videoIntent
      ? await getFirstImageAttachmentDataUrl(attachments)
      : undefined;
    setAttachments([]);

    if (videoIntent && selectedMcpActions.length === 0) {
      await generateVideo(
        content,
        videoIntent.prompt,
        videoIntent.format,
        inputImage,
      );
      return;
    }

    const imagePrompt =
      selectedMcpActions.length === 0
        ? detectImagePrompt(text) || undefined
        : undefined;

    const contentForAgent =
      selectedMcpActions.length > 0
        ? buildChatAgentMcpActionsMessage(selectedMcpActions, content)
        : content;
    const userMessage: ChatAgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prepared.displayText,
      attachments: sentAttachments,
    };
    const assistantMessage: ChatAgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      generatingImage: Boolean(imagePrompt),
    };
    const nextMessages = [...messages, userMessage, assistantMessage];
    setMessages(nextMessages);
    startStream(
      [
        ...messages,
        { ...userMessage, content: contentForAgent },
        assistantMessage,
      ],
      assistantMessage.id,
      imagePrompt,
    );
  };

  const regenerate = (assistantMessageId: string) => {
    if (isBusy) return;
    const index = messages.findIndex(
      (message) => message.id === assistantMessageId,
    );
    if (index < 0) return;
    const assistantMessage: ChatAgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };
    const nextMessages = [...messages.slice(0, index), assistantMessage];
    setMessages(nextMessages);
    setFeedback((current) => {
      const next = { ...current };
      delete next[assistantMessageId];
      return next;
    });
    startStream(nextMessages, assistantMessage.id);
  };

  const newChat = () => {
    restorePendingRef.current = false;
    const streamId = streamIdRef.current;
    if (streamId) {
      ipc.agentOsChatStream.cancel(streamId);
      void ipc.agentOs.chatCancel(streamId);
    }
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setFeedback({});
    setAttachments([]);
    setIsStreaming(false);
    streamIdRef.current = null;
  };

  return (
    <div
      className="chat-agent-page home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="hermes-agent-chat-page"
    >
      <ParticleBackground className="z-0" />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatAgentHeader
          title={title}
          onBack={onBack}
          onNewChat={newChat}
          onOpenHistory={() => setHistoryOpen(true)}
        />

        <TooltipProvider delay={200}>
          {messages.length === 0 ? (
            <div className="chat-agent-empty-stage">
              <div className="chat-agent-empty">
                <h2 className="chat-agent-empty-title font-jarvis-display">
                  Chat with {agent.name}
                </h2>
                <p className="chat-agent-empty-hint">
                  Connected to {agent.endpoint || "an unconfigured endpoint"}
                </p>
              </div>
              <ChatAgentComposer
                onSubmit={submit}
                disabled={isBusy}
                isStreaming={isStreaming}
                onStop={stopStreaming}
                messageHistory={userMessageHistory}
                variant="empty"
                modelLabelOverride={`${agent.name} · ${agent.model || "hermes"}`}
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
                        !message.generatingImage
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
                          feedback={feedback[message.id] ?? null}
                          onFeedback={(id, value) =>
                            setFeedback((current) => ({
                              ...current,
                              [id]: value,
                            }))
                          }
                          onRegenerate={
                            message.id === lastAssistantMessageId
                              ? () => regenerate(message.id)
                              : undefined
                          }
                          assistantAvatar={agent.icon}
                          assistantName={agent.name}
                        />
                      );
                    })}
                    {isStreaming &&
                      messages[messages.length - 1]?.role === "assistant" &&
                      !messages[messages.length - 1]?.content &&
                      !messages[messages.length - 1]?.generatingImage && (
                        <article className="chat-agent-turn chat-agent-turn--assistant">
                          <ChatAgentAssistantAvatar
                            avatar={agent.icon}
                            name={agent.name}
                          />
                          <p className="chat-agent-typing font-jarvis-ui">
                            {agent.name} is thinking…
                          </p>
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
                  onSubmit={submit}
                  disabled={isBusy}
                  isStreaming={isStreaming}
                  onStop={stopStreaming}
                  messageHistory={userMessageHistory}
                  modelLabelOverride={`${agent.name} · ${agent.model || "hermes"}`}
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
        onSelect={(conversation) => {
          setSessionId(conversation.id);
          setMessages(conversation.messages);
          setFeedback({});
          setAttachments([]);
          setHistoryOpen(false);
        }}
        onDelete={(id) =>
          setHistoryByAgent((current) => ({
            ...current,
            [agent.id]: (current[agent.id] ?? []).filter(
              (conversation) => conversation.id !== id,
            ),
          }))
        }
      />
    </div>
  );
}
