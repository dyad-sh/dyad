import {
  Check,
  Copy,
  Download,
  RotateCw,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type MessageFeedback = "up" | "down" | null;

type ChatAgentMessageActionsProps = {
  messageId: string;
  content: string;
  isLastAssistant: boolean;
  isStreaming: boolean;
  feedback: MessageFeedback;
  onFeedback: (messageId: string, feedback: MessageFeedback) => void;
  onRegenerate?: () => void;
  /** Saves the picture or video this reply produced, when there is one. */
  onDownload?: () => void;
};

let activeSpeechUtterance: SpeechSynthesisUtterance | null = null;

function stopSpeech() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  activeSpeechUtterance = null;
}

function ActionIconButton({
  label,
  onClick,
  disabled,
  pressed,
  reaction,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Shapes the press feedback: thumbs lift or drop, the rest just pop. */
  reaction?: "up" | "down" | "copy" | "speak" | "regenerate";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "chat-agent-message-action-btn",
              pressed && "chat-agent-message-action-btn--pressed",
            )}
            aria-label={label}
            aria-pressed={pressed}
            data-reaction={reaction}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChatAgentMessageActions({
  messageId,
  content,
  isLastAssistant,
  isStreaming,
  feedback,
  onFeedback,
  onRegenerate,
  onDownload,
}: ChatAgentMessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    return () => {
      if (
        utteranceRef.current &&
        activeSpeechUtterance === utteranceRef.current
      ) {
        stopSpeech();
        setIsSpeaking(false);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable
    }
  };

  const handleFeedback = (value: MessageFeedback) => {
    const next = feedback === value ? null : value;
    onFeedback(messageId, next);
  };

  const handleReadAloud = useCallback(() => {
    if (!content.trim() || typeof window === "undefined") return;

    if (isSpeaking) {
      stopSpeech();
      setIsSpeaking(false);
      return;
    }

    if (!window.speechSynthesis) return;

    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(content);
    utteranceRef.current = utterance;
    activeSpeechUtterance = utterance;

    utterance.onend = () => {
      setIsSpeaking(false);
      if (activeSpeechUtterance === utterance) {
        activeSpeechUtterance = null;
      }
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      if (activeSpeechUtterance === utterance) {
        activeSpeechUtterance = null;
      }
    };

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [content, isSpeaking]);

  const hasText = Boolean(content.trim());
  // A generated picture or video is a real reply even with no words attached,
  // so it still deserves feedback and a way to keep the file.
  if (isStreaming || (!hasText && !onDownload)) {
    return null;
  }

  return (
    <div
      className="chat-agent-message-actions"
      data-testid="chat-agent-message-actions"
    >
      {/* Wrapped so the confirmation can sit against the button itself — a
          corner toast is easy to miss when your eyes are on the message. */}
      {hasText && (
        <span className="chat-copy-wrap">
          <ActionIconButton
            label={copied ? "Copied" : "Copy"}
            reaction="copy"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </ActionIconButton>
          {copied && (
            <span
              className="chat-copied-pill"
              role="status"
              aria-live="polite"
              data-testid="chat-copied-pill"
            >
              Copied
            </span>
          )}
        </span>
      )}

      <ActionIconButton
        label="Good response"
        reaction="up"
        onClick={() => handleFeedback("up")}
        pressed={feedback === "up"}
      >
        <ThumbsUp className="size-4" />
      </ActionIconButton>

      <ActionIconButton
        label="Bad response"
        reaction="down"
        onClick={() => handleFeedback("down")}
        pressed={feedback === "down"}
      >
        <ThumbsDown className="size-4" />
      </ActionIconButton>

      {onDownload && (
        <ActionIconButton label="Download" reaction="copy" onClick={onDownload}>
          <Download className="size-4" />
        </ActionIconButton>
      )}

      {isLastAssistant && onRegenerate && (
        <ActionIconButton
          label="Regenerate"
          reaction="regenerate"
          onClick={onRegenerate}
          disabled={isStreaming}
        >
          <RotateCw className="size-4" />
        </ActionIconButton>
      )}

      {hasText && (
        <ActionIconButton
          label={isSpeaking ? "Stop reading aloud" : "Read aloud"}
          reaction="speak"
          onClick={handleReadAloud}
          pressed={isSpeaking}
        >
          {isSpeaking ? (
            <VolumeX className="size-4" />
          ) : (
            <Volume2 className="size-4" />
          )}
        </ActionIconButton>
      )}
    </div>
  );
}
