import { BrainCircuit, Database, Loader2, Search, Wrench } from "lucide-react";

function displayActivity(activeTool?: string | null) {
  if (!activeTool) {
    return {
      label: "Thinking",
      Icon: BrainCircuit,
      kind: "thinking" as const,
    };
  }
  if (activeTool === "Searching the web") {
    return { label: "Using Web Search", Icon: Search, kind: "tool" as const };
  }
  if (activeTool === "Accessing local knowledge base") {
    return { label: "Using RAG", Icon: Database, kind: "tool" as const };
  }
  if (activeTool === "Recalling memory") {
    return { label: "Using Memory", Icon: Database, kind: "tool" as const };
  }
  return { label: activeTool, Icon: Wrench, kind: "tool" as const };
}

export function ChatAgentActivityIndicator({
  activeTool,
}: {
  activeTool?: string | null;
}) {
  const activity = displayActivity(activeTool);
  const ActivityIcon = activity.Icon;
  return (
    <div
      className="flex min-w-0 items-center gap-2 text-sm text-cyan-100/70"
      role="status"
      aria-live="polite"
    >
      <span
        className="relative grid size-7 shrink-0 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/8 text-cyan-300"
        data-activity-kind={activity.kind}
      >
        {activity.kind === "thinking" ? (
          <span
            className="chat-agent-knowledge-typing"
            aria-hidden
            data-testid="thinking-indicator"
          >
            <i />
            <i />
            <i />
          </span>
        ) : (
          <ActivityIcon className="size-3.5" aria-hidden />
        )}
        {activity.kind === "tool" ? (
          <Loader2
            className="absolute -right-1 -bottom-1 size-3 animate-spin rounded-full bg-[#07111f] p-0.5 text-cyan-200"
            aria-hidden
            data-testid="tool-activity-spinner"
          />
        ) : null}
      </span>
      <span className="truncate font-jarvis-ui">{activity.label}…</span>
    </div>
  );
}
