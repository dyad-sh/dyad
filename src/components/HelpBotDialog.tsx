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

interface HelpBotDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpBotDialog({ isOpen, onClose }: HelpBotDialogProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [streaming, setStreaming] = useState(false);
  const assistantBufferRef = useRef("");

  const sessionId = useMemo(() => uuidv4(), []);

  useEffect(() => {
    if (!isOpen) {
      setMessages([]);
      setInput("");
      assistantBufferRef.current = "";
    }
  }, [isOpen]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" },
    ]);
    assistantBufferRef.current = "";
    setInput("");
    setStreaming(true);

    IpcClient.getInstance().startHelpChat(sessionId, trimmed, {
      onChunk: (delta) => {
        assistantBufferRef.current += delta;
        setMessages((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
            next[lastIdx] = {
              role: "assistant",
              content: assistantBufferRef.current,
            };
          }
          return next;
        });
      },
      onEnd: () => {
        setStreaming(false);
      },
      onError: () => {
        setStreaming(false);
      },
    });
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
                  <div
                    key={i}
                    className={m.role === "user" ? "text-right" : "text-left"}
                  >
                    <div
                      className={
                        "inline-block rounded-lg px-3 py-2 " +
                        (m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted")
                      }
                    >
                      {m.content}
                    </div>
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
