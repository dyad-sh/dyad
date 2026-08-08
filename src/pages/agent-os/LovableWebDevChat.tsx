import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom } from "jotai";
import { Globe2 } from "lucide-react";

import {
  chatAgentAttachmentsAtom,
  hermesAgentHistoryAtom,
  MAX_CHAT_AGENT_HISTORY,
} from "@/atoms/chatAgentAtoms";
import { ChatAgentComposer } from "@/components/chat-agent/ChatAgentComposer";
import { ChatAgentActivityIndicator } from "@/components/chat-agent/ChatAgentActivityIndicator";
import { ChatAgentHeader } from "@/components/chat-agent/ChatAgentHeader";
import { ChatAgentHistoryDialog } from "@/components/chat-agent/ChatAgentHistoryDialog";
import { JumpToLatestButton } from "@/components/chat-agent/JumpToLatestButton";
import {
  ChatAgentAssistantAvatar,
  ChatAgentMessageRow,
} from "@/components/chat-agent/ChatAgentMessageRow";
import type { MessageFeedback } from "@/components/chat-agent/ChatAgentMessageActions";
import type {
  ChatAgentConversation,
  ChatAgentMessage,
  ChatAgentToolResult,
} from "@/components/chat-agent/types";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useChatAgentStream } from "@/hooks/useChatAgentStream";
import { buildChatAgentMessageWithAttachments } from "@/lib/chat_agent_attachments";
import { LOVABLE_MCP_SERVER_URL } from "@/lib/lovableMcp";
import { LOVABLE_WEB_DEV_AGENT } from "@/lib/lovable_web_dev";
import { useChatAutoScroll } from "@/hooks/useChatAutoScroll";

function titleFromMessages(messages: ChatAgentMessage[]) {
  const firstUser = messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  if (!firstUser) return "Web Dev";
  const snippet = firstUser.content.trim().slice(0, 48);
  return snippet.length < firstUser.content.length ? `${snippet}…` : snippet;
}

export function LovableWebDevChat({
  avatar,
  onBack,
}: {
  avatar: string;
  onBack: () => void;
}) {
  const [historyByAgent, setHistoryByAgent] = useAtom(hermesAgentHistoryAtom);
  const initialConversation = historyByAgent[LOVABLE_WEB_DEV_AGENT.id]?.[0];
  const [sessionId, setSessionId] = useState<string>(
    () => initialConversation?.id ?? crypto.randomUUID(),
  );
  const [messages, setMessages] = useState<ChatAgentMessage[]>(
    () => initialConversation?.messages ?? [],
  );
  const [feedback, setFeedback] = useState<Record<string, MessageFeedback>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachments, setAttachments] = useAtom(chatAgentAttachmentsAtom);
  const assistantMessageIdRef = useRef<string | null>(null);
  const restorePendingRef = useRef(true);
  const { sendMessage, regenerate, cancel, isStreaming, activeTool } =
    useChatAgentStream(sessionId, { agentProfile: "lovable-web-dev" });

  const history = historyByAgent[LOVABLE_WEB_DEV_AGENT.id] ?? [];
  const title = useMemo(() => titleFromMessages(messages), [messages]);
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
    isStreaming,
  });

  useEffect(() => {
    if (!restorePendingRef.current) return;
    if (messages.length > 0) {
      restorePendingRef.current = false;
      return;
    }
    const latest = historyByAgent[LOVABLE_WEB_DEV_AGENT.id]?.[0];
    if (!latest) return;
    restorePendingRef.current = false;
    setSessionId(latest.id);
    setMessages(latest.messages);
  }, [historyByAgent, messages.length]);

  useEffect(() => {
    if (isStreaming || !messages.some((message) => message.role === "user")) {
      return;
    }
    setHistoryByAgent((current) => {
      const agentHistory = current[LOVABLE_WEB_DEV_AGENT.id] ?? [];
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
      return { ...current, [LOVABLE_WEB_DEV_AGENT.id]: next };
    });
  }, [isStreaming, messages, sessionId, setHistoryByAgent, title]);

  useEffect(() => cancel, [cancel]);

  const streamCallbacks = useMemo(
    () => ({
      onAssistantFlush: (content: string) => {
        const assistantId = assistantMessageIdRef.current;
        if (!assistantId) return;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content } : message,
          ),
        );
      },
      onToolResult: (result: ChatAgentToolResult) => {
        const assistantId = assistantMessageIdRef.current;
        if (!assistantId) return;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  toolResults: [...(message.toolResults ?? []), result],
                }
              : message,
          ),
        );
      },
      onComplete: () => {
        assistantMessageIdRef.current = null;
      },
      onError: (error: string) => {
        const assistantId = assistantMessageIdRef.current;
        assistantMessageIdRef.current = null;
        if (!assistantId) return;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: `I couldn't reach Lovable MCP. ${error}`,
                }
              : message,
          ),
        );
      },
    }),
    [],
  );

  const submit = useCallback(
    async (text: string) => {
      const content = await buildChatAgentMessageWithAttachments(
        text,
        attachments,
      );
      if (!content || isStreaming) return;
      setAttachments([]);

      const userMessage: ChatAgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };
      const assistantId = crypto.randomUUID();
      assistantMessageIdRef.current = assistantId;
      setMessages((current) => [
        ...current,
        userMessage,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      sendMessage(
        {
          message: content,
          displayMessage: content,
          agentProfile: "lovable-web-dev",
        },
        {
          onUserMessage: () => {},
          ...streamCallbacks,
        },
      );
    },
    [attachments, isStreaming, sendMessage, setAttachments, streamCallbacks],
  );

  const regenerateLast = (assistantMessageId: string) => {
    if (isStreaming) return;
    const index = messages.findIndex(
      (message) => message.id === assistantMessageId,
    );
    if (index < 0) return;
    const assistantId = crypto.randomUUID();
    assistantMessageIdRef.current = assistantId;
    setMessages([
      ...messages.slice(0, index),
      { id: assistantId, role: "assistant", content: "" },
    ]);
    regenerate(streamCallbacks);
  };

  const newChat = () => {
    restorePendingRef.current = false;
    cancel();
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setFeedback({});
    setAttachments([]);
    assistantMessageIdRef.current = null;
  };

  return (
    <div
      className="chat-agent-page home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="lovable-web-dev-chat-page"
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
                <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-cyan-400/20 bg-cyan-500/8 text-cyan-200">
                  <Globe2 className="size-7" />
                </span>
                <h2 className="chat-agent-empty-title font-jarvis-display">
                  Web Dev
                </h2>
                <p className="chat-agent-empty-hint">
                  Exclusively connected to {LOVABLE_MCP_SERVER_URL}
                </p>
              </div>
              <ChatAgentComposer
                onSubmit={(text) => void submit(text)}
                disabled={isStreaming}
                messageHistory={userMessageHistory}
                variant="empty"
                modelLabelOverride="Web Dev · Lovable MCP only"
                exclusiveToolLabel="Lovable MCP only"
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
                          feedback={feedback[message.id] ?? null}
                          onFeedback={(id, value) =>
                            setFeedback((current) => ({
                              ...current,
                              [id]: value,
                            }))
                          }
                          onRegenerate={
                            message.id === lastAssistantMessageId
                              ? () => regenerateLast(message.id)
                              : undefined
                          }
                          assistantAvatar={avatar}
                          assistantName={LOVABLE_WEB_DEV_AGENT.name}
                        />
                      );
                    })}
                    {isStreaming &&
                      messages[messages.length - 1]?.role === "assistant" &&
                      (!messages[messages.length - 1]?.content ||
                        activeTool) && (
                        <article className="chat-agent-turn chat-agent-turn--assistant">
                          <ChatAgentAssistantAvatar
                            avatar={avatar}
                            name={LOVABLE_WEB_DEV_AGENT.name}
                          />
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
                  isStreaming={isStreaming}
                />
                <ChatAgentComposer
                  onSubmit={(text) => void submit(text)}
                  disabled={isStreaming}
                  messageHistory={userMessageHistory}
                  modelLabelOverride="Web Dev · Lovable MCP only"
                  exclusiveToolLabel="Lovable MCP only"
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
            [LOVABLE_WEB_DEV_AGENT.id]: (
              current[LOVABLE_WEB_DEV_AGENT.id] ?? []
            ).filter((conversation) => conversation.id !== id),
          }))
        }
      />
    </div>
  );
}
