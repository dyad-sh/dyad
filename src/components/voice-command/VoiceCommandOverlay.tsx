/**
 * VoiceCommandOverlay
 *
 * Always-available floating voice command button.
 * Speak a command and JoyCreate executes it — build apps, manage email,
 * create workflows, generate media, navigate, and more.
 *
 * Local voice models (Whisper STT, Piper TTS) are used by default.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Mic,
  MicOff,
  X,
  Loader2,
  Zap,
  ChevronUp,
  Keyboard,
} from "lucide-react";
import { useVoiceCommand } from "@/hooks/useVoiceCommand";
import type { VoiceCommandState } from "@/hooks/useVoiceCommand";
import { cn } from "@/lib/utils";

// ── Component ───────────────────────────────────────────────────────────────

export function VoiceCommandOverlay() {
  const {
    state,
    transcript,
    lastResult,
    feedbackMessage,
    startCommand,
    stopCommand,
    cancelCommand,
    executeTextCommand,
  } = useVoiceCommand();

  const [expanded, setExpanded] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl+Shift+V toggles voice command
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "V") {
        e.preventDefault();
        if (state === "idle") {
          startCommand();
        } else if (state === "listening") {
          stopCommand();
        } else {
          cancelCommand();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [state, startCommand, stopCommand, cancelCommand]);

  // Auto-expand when active
  useEffect(() => {
    if (state !== "idle") {
      setExpanded(true);
    }
  }, [state]);

  // Focus text input when shown
  useEffect(() => {
    if (showTextInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showTextInput]);

  const handleMicClick = useCallback(() => {
    if (state === "idle") {
      setShowTextInput(false);
      startCommand();
    } else if (state === "listening") {
      stopCommand();
    } else {
      cancelCommand();
    }
  }, [state, startCommand, stopCommand, cancelCommand]);

  const handleTextSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (textInput.trim()) {
        executeTextCommand(textInput.trim());
        setTextInput("");
        setShowTextInput(false);
      }
    },
    [textInput, executeTextCommand]
  );

  const handleClose = useCallback(() => {
    cancelCommand();
    setExpanded(false);
    setShowTextInput(false);
    setTextInput("");
  }, [cancelCommand]);

  // Don't render expanded panel in idle with no content
  const showPanel = expanded && (state !== "idle" || showTextInput);

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start gap-2">
      {/* ── Expanded Panel ───────────────────────────────────────────── */}
      {showPanel && (
        <div className="bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl p-3 w-80 animate-in slide-in-from-bottom-2 fade-in duration-200">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                Voice Command
              </span>
              <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                Local Models
              </span>
            </div>
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Status Area */}
          <div className="min-h-[48px] flex items-center justify-center">
            <StatusDisplay
              state={state}
              transcript={transcript}
              feedbackMessage={feedbackMessage}
              intentLabel={lastResult?.description}
            />
          </div>

          {/* Text Input Mode */}
          {showTextInput && state === "idle" && (
            <form onSubmit={handleTextSubmit} className="mt-2">
              <div className="flex gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type a command..."
                  className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  type="submit"
                  disabled={!textInput.trim()}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  Go
                </button>
              </div>
            </form>
          )}

          {/* Hint */}
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Ctrl+Shift+V to toggle</span>
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <Keyboard className="h-3 w-3" />
              {showTextInput ? "Voice" : "Type"}
            </button>
          </div>
        </div>
      )}

      {/* ── Floating Action Button ───────────────────────────────────── */}
      <div className="relative">
        {/* Pulse ring when listening */}
        {state === "listening" && (
          <>
            <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
            <div className="absolute -inset-1 rounded-full bg-primary/20 animate-pulse" />
          </>
        )}

        <button
          onClick={handleMicClick}
          onMouseEnter={() => state === "idle" && setExpanded(true)}
          className={cn(
            "relative flex items-center justify-center rounded-full shadow-lg transition-all duration-200",
            "w-12 h-12",
            state === "idle" &&
              "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-110",
            state === "listening" &&
              "bg-red-500 text-white hover:bg-red-600 scale-110",
            state === "processing" &&
              "bg-amber-500 text-white cursor-wait",
            state === "executing" &&
              "bg-blue-500 text-white cursor-wait",
            state === "feedback" &&
              "bg-green-500 text-white"
          )}
          title={getButtonTitle(state)}
        >
          <MicButtonIcon state={state} />
        </button>

        {/* Collapsed mini label */}
        {!showPanel && state === "idle" && (
          <button
            onClick={() => setExpanded(true)}
            className="absolute -top-1 -right-1 bg-muted/90 backdrop-blur-sm border border-border rounded-full p-0.5 shadow-sm"
          >
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function MicButtonIcon({ state }: { state: VoiceCommandState }) {
  switch (state) {
    case "idle":
      return <Mic className="h-5 w-5" />;
    case "listening":
      return <MicOff className="h-5 w-5 animate-pulse" />;
    case "processing":
      return <Loader2 className="h-5 w-5 animate-spin" />;
    case "executing":
      return <Zap className="h-5 w-5 animate-pulse" />;
    case "feedback":
      return <Mic className="h-5 w-5" />;
    default:
      return <Mic className="h-5 w-5" />;
  }
}

function StatusDisplay({
  state,
  transcript,
  feedbackMessage,
  intentLabel,
}: {
  state: VoiceCommandState;
  transcript: string;
  feedbackMessage: string;
  intentLabel?: string;
}) {
  switch (state) {
    case "listening":
      return (
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-1 bg-red-400 rounded-full animate-pulse"
                style={{
                  height: `${12 + Math.random() * 16}px`,
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            Listening... speak your command
          </span>
        </div>
      );

    case "processing":
      return (
        <div className="flex flex-col items-center gap-1">
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <span className="text-xs text-muted-foreground">
            {transcript ? `"${transcript}"` : "Processing..."}
          </span>
        </div>
      );

    case "executing":
      return (
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-xs font-medium text-blue-400">
            {intentLabel || "Executing..."}
          </span>
          {transcript && (
            <span className="text-[10px] text-muted-foreground line-clamp-2">
              "{transcript}"
            </span>
          )}
        </div>
      );

    case "feedback":
      return (
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-xs font-medium text-green-400">
            {feedbackMessage}
          </span>
        </div>
      );

    default:
      return (
        <span className="text-xs text-muted-foreground">
          Say something like "Build me an app" or "Go to settings"
        </span>
      );
  }
}

function getButtonTitle(state: VoiceCommandState): string {
  switch (state) {
    case "idle":
      return "Voice Command (Ctrl+Shift+V)";
    case "listening":
      return "Click to stop listening";
    case "processing":
      return "Processing your command...";
    case "executing":
      return "Executing...";
    case "feedback":
      return "Done";
    default:
      return "Voice Command";
  }
}
