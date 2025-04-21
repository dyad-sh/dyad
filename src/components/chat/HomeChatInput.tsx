import { SendIcon, StopCircleIcon, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/ModelPicker";
import { useSettings } from "@/hooks/useSettings";
import { homeChatInputValueAtom } from "@/atoms/chatAtoms"; // Use a different atom for home input
import { useAtom } from "jotai";
import { useStreamChat } from "@/hooks/useStreamChat";

export function HomeChatInput({ onSubmit }: { onSubmit: () => void }) {
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings, updateSettings, isAnyProviderSetup } = useSettings();
  const { streamMessage, isStreaming, setIsStreaming } = useStreamChat({
    hasChatId: false,
  }); // eslint-disable-line @typescript-eslint/no-unused-vars
  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "0px";
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${scrollHeight + 4}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [inputValue]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  if (!settings) {
    return null; // Or loading state
  }

  return (
    <>
      <div className="p-4">
        <div className="flex flex-col space-y-2 border border-border rounded-lg bg-(--background-lighter) shadow-sm">
          <div className="flex items-start space-x-2 ">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask Dyad to build..."
              className="flex-1 p-2 focus:outline-none overflow-y-auto min-h-[40px] max-h-[200px]"
              style={{ resize: "none" }}
              disabled={isStreaming} // Should ideally reflect if *any* stream is happening
            />
            {isStreaming ? (
              <button
                className="px-2 py-2 mt-1 mr-2 text-(--sidebar-accent-fg) rounded-lg opacity-50 cursor-not-allowed" // Indicate disabled state
                title="Cancel generation (unavailable here)"
              >
                <StopCircleIcon size={20} />
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={!inputValue.trim() || !isAnyProviderSetup()}
                className="px-2 py-2 mt-1 mr-2 hover:bg-(--background-darkest) text-(--sidebar-accent-fg) rounded-lg disabled:opacity-50"
                title="Start new chat"
              >
                <SendIcon size={20} />
              </button>
            )}
          </div>
          <div className="px-2 pb-2">
            <ModelPicker
              selectedModel={settings.selectedModel}
              onModelSelect={(model) =>
                updateSettings({ selectedModel: model })
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}
