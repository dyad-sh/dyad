/**
 * AgentChatPanel — Chat interface for conversing with a specific swarm agent.
 * Uses the executor's agentChat method which maintains per-agent conversation history.
 */

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Trash2 } from "lucide-react";
import { VoiceInputButton } from "@/components/chat/VoiceInputButton";
import { useAgentChat, useChatHistory } from "@/hooks/useAgentSwarm";
import type { AgentNodeId, AgentChatMessage } from "@/ipc/agent_swarm_client";

// =============================================================================
// TYPES
// =============================================================================

interface AgentChatPanelProps {
  agentId: AgentNodeId;
  agentName?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AgentChatPanel({ agentId, agentName }: AgentChatPanelProps) {
  const [input, setInput] = useState("");
  const chatMutation = useAgentChat();
  const historyQuery = useChatHistory(agentId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Combine server history with local optimistic messages
  const messages: AgentChatMessage[] = historyQuery.data ?? [];

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || chatMutation.isPending) return;
    setInput("");
    chatMutation.mutate(
      { agentId, message: trimmed },
      {
        onSettled: () => {
          inputRef.current?.focus();
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b mb-2">
        <h4 className="text-sm font-medium">
          Chat with {agentName ?? "Agent"}
        </h4>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 h-64 pr-2">
        {messages.length === 0 && !chatMutation.isPending ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm italic">
            Send a message to start chatting with this agent.
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Pending indicator */}
            {chatMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking…
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="flex items-center gap-2 pt-2 border-t mt-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          disabled={chatMutation.isPending}
          className="flex-1"
        />
        <VoiceInputButton
          size="sm"
          showSettings={false}
          disabled={chatMutation.isPending}
          onTranscription={(text) => setInput((prev) => prev ? `${prev} ${text}` : text)}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!input.trim() || chatMutation.isPending}
        >
          {chatMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Error display */}
      {chatMutation.isError && (
        <div className="text-xs text-destructive mt-1">
          {chatMutation.error instanceof Error
            ? chatMutation.error.message
            : "Failed to send message"}
        </div>
      )}
    </div>
  );
}
