import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Reconnects the reader to live output.
 *
 * Following stops the moment they scroll up, and the response keeps streaming
 * below them. This is how they opt back in — rather than being dragged down
 * mid-sentence — and it says how much has arrived while they were reading.
 *
 * Collapsed to an arrow so it never covers the conversation; the label is
 * revealed on hover, where the intent is already clear.
 */
export function JumpToLatestButton({
  visible,
  onClick,
  pendingCount = 0,
  isStreaming = false,
  label = "Jump to Live",
  className,
}: {
  visible: boolean;
  onClick: () => void;
  /** How much arrived below the reader; shown as a badge past a few. */
  pendingCount?: number;
  /** Adds the rotating ring while output is still arriving. */
  isStreaming?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Kept mounted so it fades rather than pops, and taken out of the tab
      // order and the accessibility tree while hidden.
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={pendingCount > 0 ? `${label} — ${pendingCount} new` : label}
      className={cn("chat-jump-latest", visible && "is-visible", className)}
      data-testid="chat-jump-to-latest"
    >
      <span className="chat-jump-arrow">
        <ChevronDown className="size-4" />
        {/* Turns only while the AI is still writing, so it reads as live. */}
        {isStreaming && (
          <span className="chat-jump-ring" data-testid="chat-jump-ring" />
        )}
      </span>

      {/* Revealed on hover: the arrow alone is enough at rest. */}
      <span className="chat-jump-label">{label}</span>

      {pendingCount > 0 && (
        <span className="chat-jump-badge" data-testid="chat-jump-badge">
          {pendingCount > 9 ? "9+" : pendingCount}
        </span>
      )}
    </button>
  );
}
