import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Loader2, CheckCircle2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getAllChats } from "@/lib/chat";
import type { ChatSummary } from "@/lib/schemas";
import { useAtomValue } from "jotai";
import {
  isStreamingByIdAtom,
  recentStreamChatIdsAtom,
} from "@/atoms/chatAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";

export function ChatActivityButton() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="no-app-region-drag flex items-center justify-center p-1.5 rounded-md text-sm hover:bg-[var(--background-darkest)] transition-colors"
          title="Recent chat activity"
          data-testid="chat-activity-button"
        >
          <Bell size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0 max-h-[50vh] overflow-y-auto"
      >
        <ChatActivityList onSelect={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function ChatActivityList({ onSelect }: { onSelect?: () => void }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);
  const navigate = useNavigate();
  const recentStreamChatIds = useAtomValue(recentStreamChatIdsAtom);
  const apps = useLoadApps();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const all = await getAllChats();
        if (!mounted) return;
        const recent = recentStreamChatIds
          .map((id) => all.find((c) => c.id === id))
          .filter((c) => c !== undefined);
        // Sort recent first
        setChats(
          [...recent].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          ),
        );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [recentStreamChatIds]);

  const rows = useMemo(() => chats.slice(0, 10), [chats]);

  if (loading) {
    return (
      <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" />
        Loading activity…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">No recent chats</div>
    );
  }

  return (
    <div className="py-1" data-testid="chat-activity-list">
      {rows.map((c) => {
        const inProgress = isStreamingById.get(c.id) === true;
        return (
          <button
            key={c.id}
            className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 rounded-md hover:bg-[var(--background-darker)] dark:hover:bg-[var(--background-lighter)] transition-colors"
            onClick={() => {
              onSelect?.();
              navigate({ to: "/chat", search: { id: c.id } });
            }}
            data-testid={`chat-activity-list-item-${c.id}`}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {c.title ?? `Chat #${c.id}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {apps.apps.find((a) => a.id === c.appId)?.name}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {inProgress ? (
                <div className="flex items-center text-purple-600">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : (
                <div className="flex items-center text-emerald-600">
                  <CheckCircle2 size={16} />
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
