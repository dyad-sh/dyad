import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";

/**
 * A model's working, kept apart from its answer.
 *
 * Collapsed by default: the reply is what was asked for, and the reasoning is
 * available for anyone who wants to check it rather than something to read
 * past. While it is still arriving the header pulses, which is also the
 * clearest signal that the model has started and is not stalled.
 */
export function ReasoningBlock({
  reasoning,
  streaming,
}: {
  reasoning: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!reasoning.trim()) return null;

  return (
    <div className="chat-reasoning" data-testid="chat-reasoning">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="chat-reasoning-toggle"
      >
        <Brain
          className={
            streaming ? "size-3.5 animate-pulse text-cyan-300" : "size-3.5"
          }
        />
        <span>{streaming ? "Thinking…" : "Thought process"}</span>
        <ChevronRight
          className={
            open ? "size-3.5 rotate-90 transition" : "size-3.5 transition"
          }
        />
      </button>

      {open && <div className="chat-reasoning-body">{reasoning}</div>}
    </div>
  );
}
