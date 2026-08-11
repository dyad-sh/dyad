import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JarvisTranscriptEntry } from "@/hooks/useJarvisSession";

const ROLE_LABELS: Record<JarvisTranscriptEntry["role"], string> = {
  user: "You",
  assistant: "Meta Human OS",
  tool: "Tool",
  system: "System",
};

export function JarvisTranscriptDrawer({
  entries,
  onClear,
  defaultOpen = false,
}: {
  entries: JarvisTranscriptEntry[];
  onClear: () => void;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyEntry = async (entry: JarvisTranscriptEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard unavailable — nothing useful to tell the user here.
    }
  };

  return (
    <section className="jarvis-panel rounded-xl">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          aria-expanded={isOpen}
          className="flex flex-1 items-center gap-2 px-3 py-2.5 text-left focus-visible:ring-1 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
        >
          {isOpen ? (
            <ChevronDown className="size-3.5 text-cyan-300/60" />
          ) : (
            <ChevronRight className="size-3.5 text-cyan-300/60" />
          )}
          <span className="font-jarvis-ui text-xs tracking-widest text-cyan-300/70 uppercase">
            Transcript
          </span>
          <span className="ml-2 font-mono text-[10px] text-cyan-100/30">
            {entries.length}
          </span>
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear transcript"
            className="mr-2 rounded p-1.5 text-cyan-200/50 hover:bg-cyan-400/10 hover:text-cyan-100 focus-visible:ring-1 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="max-h-72 overflow-y-auto border-t border-cyan-400/10 px-3 py-2">
          {entries.length === 0 ? (
            <p className="py-2 text-xs text-cyan-100/35">
              The conversation transcript will appear here.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {entries.map((entry) => (
                <li key={entry.id} className="group">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "font-jarvis-ui text-[10px] tracking-widest uppercase",
                        entry.role === "user"
                          ? "text-cyan-100/45"
                          : "text-cyan-300/70",
                      )}
                    >
                      {ROLE_LABELS[entry.role]}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyEntry(entry)}
                      aria-label={`Copy ${ROLE_LABELS[entry.role]} message`}
                      className="ml-auto rounded p-1 text-cyan-200/0 transition-colors group-hover:text-cyan-200/50 hover:bg-cyan-400/10 hover:text-cyan-100 focus-visible:text-cyan-200/70 focus-visible:ring-1 focus-visible:ring-cyan-400/50 focus-visible:outline-none"
                    >
                      <Copy className="size-3" />
                    </button>
                    {copiedId === entry.id && (
                      <span className="text-[10px] text-cyan-300/70">
                        Copied
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed whitespace-pre-wrap text-cyan-50/80">
                    {entry.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
