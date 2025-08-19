import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { v4 as uuidv4 } from "uuid";
import {
  ThinkingBlock,
  VanillaMarkdownParser,
} from "@/components/ThinkingBlock";
import ReactMarkdown from "react-markdown";

interface HelpBotDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

export function HelpBotDialog({ isOpen, onClose }: HelpBotDialogProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const assistantBufferRef = useRef("");
  const reasoningBufferRef = useRef("");
  const flushTimerRef = useRef<number | null>(null);
  const FLUSH_INTERVAL_MS = 100;

  const sessionId = useMemo(() => uuidv4(), []);

  useEffect(() => {
    if (!isOpen) {
      setMessages([]);
      setInput("");
      assistantBufferRef.current = "";
      reasoningBufferRef.current = "";
      if (flushTimerRef.current) {
        window.clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    }
  }, [isOpen]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "", reasoning: "" },
    ]);
    assistantBufferRef.current = "";
    reasoningBufferRef.current = "";
    setInput("");
    setStreaming(true);

    IpcClient.getInstance().startHelpChat(sessionId, trimmed, {
      onChunk: (delta) => {
        // Buffer assistant content; UI will flush on interval for smoothness
        assistantBufferRef.current += delta;
      },
      onReasoning: (delta) => {
        // Buffer reasoning content; UI will flush on interval for smoothness
        reasoningBufferRef.current += delta;
      },
      onEnd: () => {
        // Final flush then stop streaming
        setMessages((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
            next[lastIdx] = {
              ...next[lastIdx],
              content: assistantBufferRef.current,
              reasoning: reasoningBufferRef.current,
            };
          }
          return next;
        });
        setStreaming(false);
        if (flushTimerRef.current) {
          window.clearInterval(flushTimerRef.current);
          flushTimerRef.current = null;
        }
      },
      onError: () => {
        setStreaming(false);
        if (flushTimerRef.current) {
          window.clearInterval(flushTimerRef.current);
          flushTimerRef.current = null;
        }
      },
    });

    // Start smooth flush interval
    if (flushTimerRef.current) {
      window.clearInterval(flushTimerRef.current);
    }
    flushTimerRef.current = window.setInterval(() => {
      setMessages((prev) => {
        const next = [...prev];
        const lastIdx = next.length - 1;
        if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
          const current = next[lastIdx];
          // Only update if there's any new data to apply
          if (
            current.content !== assistantBufferRef.current ||
            current.reasoning !== reasoningBufferRef.current
          ) {
            next[lastIdx] = {
              ...current,
              content: assistantBufferRef.current,
              reasoning: reasoningBufferRef.current,
            };
          }
        }
        return next;
      });
    }, FLUSH_INTERVAL_MS);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dyad Help Bot</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 h-[480px]">
          <div className="flex-1 overflow-auto rounded-md border p-3 bg-(--background-lightest)">
            {messages.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Ask a question about using Dyad.
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m, i) => (
                  <div key={i}>
                    {m.role === "user" ? (
                      <div className="text-right">
                        <div className="inline-block rounded-lg px-3 py-2 bg-primary text-primary-foreground">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div className="text-left">
                        {/* Show thinking block if there's reasoning content */}
                        {(m.reasoning ||
                          (streaming && i === messages.length - 1)) && (
                          <ThinkingBlock
                            content={m.reasoning || ""}
                            isStreaming={streaming && i === messages.length - 1}
                          />
                        )}

                        {/* Show regular response content */}
                        {(m.content ||
                          (streaming && i === messages.length - 1)) && (
                          <div className="inline-block rounded-lg px-3 py-2 bg-muted prose dark:prose-invert prose-headings:mb-2 prose-p:my-1 prose-pre:my-0 max-w-none">
                            {m.content ? (
                              <VanillaMarkdownParser content={m.content} />
                            ) : streaming ? (
                              "..."
                            ) : (
                              ""
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 h-10 rounded-md border bg-background px-3 text-sm"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your question..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button onClick={handleSend} disabled={streaming || !input.trim()}>
              {streaming ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
