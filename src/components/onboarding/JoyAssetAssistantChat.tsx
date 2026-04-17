import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { aiProviderService } from "@/services/aiProviderService";

export type AssetAssistantContext =
  | "description"
  | "trainingData"
  | "useCases"
  | "limitations"
  | "ethicalConsiderations"
  | "license";

interface JoyAssetAssistantChatProps {
  isOpen: boolean;
  onClose: () => void;
  onUseResponse: (response: string) => void;
  context: AssetAssistantContext;
  assetName?: string;
  assetType?: string;
  assetDescription?: string;
}

const contextPrompts: Record<AssetAssistantContext, string> = {
  description:
    "Write a professional, compelling marketplace description for this AI asset. Be specific about capabilities, architecture, and use-cases. Keep it under 200 words.",
  trainingData:
    "Describe the training data used for this AI asset. Include data sources, size, quality, and any preprocessing steps.",
  useCases:
    "List 5-8 specific, practical use-cases for this AI asset. Be concrete and include target audiences.",
  limitations:
    "Honestly describe the known limitations of this AI asset. Include edge cases, failure modes, and areas for improvement.",
  ethicalConsiderations:
    "Describe ethical considerations for using this AI asset. Include bias risks, misuse potential, and recommended safeguards.",
  license:
    "Suggest appropriate license terms for this AI asset based on its type and intended use. Consider commercial vs open-source trade-offs.",
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function JoyAssetAssistantChat({
  isOpen,
  onClose,
  onUseResponse,
  context,
  assetName,
  assetType,
  assetDescription,
}: JoyAssetAssistantChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      handleAutoPrompt();
    }
  }, [isOpen, context]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleAutoPrompt() {
    const prompt = `Asset: ${assetName ?? "Unnamed"} (${assetType ?? "AI Model"})\n${assetDescription ? `Current description: ${assetDescription}\n` : ""}Task: ${contextPrompts[context]}`;

    setMessages([{ role: "user", content: prompt }]);
    setLoading(true);

    const res = await aiProviderService.chat({
      message: prompt,
      systemPrompt:
        "You are Joy, an expert AI marketplace consultant. Help creators write excellent asset listings. Be specific, professional, and actionable. Return only the requested content — no preamble.",
    });

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: res.response ?? "Sorry, I couldn't generate a suggestion right now." },
    ]);
    setLoading(false);
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    const res = await aiProviderService.chat({
      message: userMsg,
      systemPrompt:
        "You are Joy, an expert AI marketplace consultant. Help the creator refine their asset listing. Return only the requested content.",
    });

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: res.response ?? "Sorry, something went wrong." },
    ]);
    setLoading(false);
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Joy Asset Assistant — {context}
          </DialogTitle>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 py-2 min-h-[200px] max-h-[400px]">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "assistant"
                  ? "bg-muted text-foreground"
                  : "bg-primary/10 text-primary ml-8"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking...
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Joy to refine..."
            className="min-h-[40px] max-h-[80px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button size="icon" onClick={handleSend} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {lastAssistant && (
          <Button
            className="w-full"
            onClick={() => {
              onUseResponse(lastAssistant.content);
              onClose();
            }}
          >
            Use This Response
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
