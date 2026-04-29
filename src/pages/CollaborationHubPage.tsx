/**
 * Collaboration Hub Page
 *
 * Slack-for-agents: shared channels, DMs, subscriptions, and structured
 * handoff tasks. Polled every 4s via TanStack Query (no socket plumbing
 * for v1). Resilient to an empty DB and to a missing IPC bridge — the
 * client wrappers return safe stubs.
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Hash,
  Lock,
  Plus,
  Send,
  Users,
  ListChecks,
  MessageSquare,
  Sparkles,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  CircleDot,
  AlertCircle,
  Bot,
  Loader2,
  Archive,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  CollaborationHubClient,
  type CollabChannel,
  type CollabChannelVisibility,
  type CollabMessage,
  type CollabMessageKind,
  type CollabSubscription,
  type CollabTask,
  type CollabTaskPriority,
  type CollabTaskStatus,
} from "@/ipc/collaboration_hub_client";

// =============================================================================
// Constants
// =============================================================================

const POLL_INTERVAL_MS = 4_000;

const AGENT_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
];

function colorForAgent(agentId: number | null | undefined): string {
  if (agentId == null) return "#64748b"; // slate for system / unknown
  const n = ((agentId % AGENT_PALETTE.length) + AGENT_PALETTE.length) % AGENT_PALETTE.length;
  return AGENT_PALETTE[n];
}

function formatRelativeTime(unixSec: number): string {
  if (!unixSec) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSec));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

function statusIcon(status: CollabTaskStatus) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "rejected":
    case "cancelled":
      return <XCircle className="h-3.5 w-3.5 text-rose-500" />;
    case "in_progress":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />;
    case "accepted":
      return <CircleDot className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <AlertCircle className="h-3.5 w-3.5 text-slate-500" />;
  }
}

const KIND_LABEL: Record<CollabMessageKind, string> = {
  chat: "chat",
  handoff: "handoff",
  result: "result",
  system: "system",
  mention: "mention",
};

const KIND_VARIANT: Record<CollabMessageKind, "default" | "secondary" | "outline" | "destructive"> = {
  chat: "secondary",
  handoff: "default",
  result: "outline",
  system: "outline",
  mention: "default",
};

// =============================================================================
// Page
// =============================================================================

export function CollaborationHubPage() {
  const queryClient = useQueryClient();
  const [selectedChannelId, setSelectedChannelId] = React.useState<number | null>(null);
  const [postingAgentIdInput, setPostingAgentIdInput] = React.useState<string>("1");
  const postingAgentId = Number.parseInt(postingAgentIdInput, 10) || 1;

  // ---- channels ----
  const channelsQuery = useQuery<CollabChannel[]>({
    queryKey: ["collab", "channels"],
    queryFn: () => CollaborationHubClient.listChannels({ includeArchived: false }),
    refetchInterval: POLL_INTERVAL_MS,
    initialData: [],
  });
  const channels = channelsQuery.data ?? [];

  // Auto-select first channel once loaded
  React.useEffect(() => {
    if (selectedChannelId == null && channels.length > 0) {
      setSelectedChannelId(channels[0].id);
    }
  }, [channels, selectedChannelId]);

  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? null;

  // ---- messages for selected channel ----
  const messagesQuery = useQuery<CollabMessage[]>({
    queryKey: ["collab", "messages", selectedChannelId],
    queryFn: () =>
      selectedChannelId == null
        ? Promise.resolve([])
        : CollaborationHubClient.listMessages({ channelId: selectedChannelId, limit: 100 }),
    refetchInterval: POLL_INTERVAL_MS,
    enabled: selectedChannelId != null,
    initialData: [],
  });
  const messages = messagesQuery.data ?? [];

  // ---- subscriptions for selected channel ----
  const subsQuery = useQuery<CollabSubscription[]>({
    queryKey: ["collab", "subs", "channel", selectedChannelId],
    queryFn: () =>
      selectedChannelId == null
        ? Promise.resolve([])
        : CollaborationHubClient.listSubscriptionsForChannel(selectedChannelId),
    refetchInterval: POLL_INTERVAL_MS,
    enabled: selectedChannelId != null,
    initialData: [],
  });
  const subscriptions = subsQuery.data ?? [];

  // ---- tasks for selected channel ----
  const tasksQuery = useQuery<CollabTask[]>({
    queryKey: ["collab", "tasks", "channel", selectedChannelId],
    queryFn: () =>
      selectedChannelId == null
        ? Promise.resolve([])
        : CollaborationHubClient.listTasks({ channelId: selectedChannelId, limit: 50 }),
    refetchInterval: POLL_INTERVAL_MS,
    enabled: selectedChannelId != null,
    initialData: [],
  });
  const tasks = tasksQuery.data ?? [];

  // ---- mutations ----
  const seedDefaults = useMutation({
    mutationFn: async () => {
      const defaults = [
        {
          name: "general",
          description: "Catch-all coordination",
          topic: "Default channel for cross-agent chatter",
        },
        { name: "alerts", description: "System & monitoring signals", topic: "🚨 alerts" },
        {
          name: "handoffs",
          description: "Inter-agent task delegation",
          topic: "Use this channel to request work from other agents",
        },
      ];
      const created: CollabChannel[] = [];
      for (const d of defaults) {
        try {
          const c = await CollaborationHubClient.createChannel({
            name: d.name,
            description: d.description,
            topic: d.topic,
            visibility: "public",
          });
          if (c) created.push(c);
        } catch (err) {
          // Channel may already exist (unique constraint) — keep going
          console.warn(`Skipped default channel "${d.name}":`, err);
        }
      }
      return created;
    },
    onSuccess: (created) => {
      toast.success(
        created.length ? `Seeded ${created.length} default channel(s)` : "Default channels already exist",
      );
      queryClient.invalidateQueries({ queryKey: ["collab", "channels"] });
    },
    onError: (err: unknown) => {
      toast.error(`Failed to seed channels: ${(err as Error)?.message ?? err}`);
    },
  });

  const createChannel = useMutation({
    mutationFn: async (params: {
      name: string;
      description?: string;
      visibility: CollabChannelVisibility;
    }) =>
      CollaborationHubClient.createChannel({
        name: params.name,
        description: params.description,
        visibility: params.visibility,
        createdByAgentId: postingAgentId,
      }),
    onSuccess: (channel) => {
      if (channel) {
        toast.success(`Channel #${channel.name} created`);
        setSelectedChannelId(channel.id);
      }
      queryClient.invalidateQueries({ queryKey: ["collab", "channels"] });
    },
    onError: (err: unknown) => {
      toast.error(`Failed to create channel: ${(err as Error)?.message ?? err}`);
    },
  });

  const postMessage = useMutation({
    mutationFn: (params: { content: string; kind: CollabMessageKind }) =>
      CollaborationHubClient.postMessage({
        channelId: selectedChannelId ?? undefined,
        fromAgentId: postingAgentId,
        kind: params.kind,
        content: params.content,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collab", "messages", selectedChannelId] });
    },
    onError: (err: unknown) => {
      toast.error(`Failed to post message: ${(err as Error)?.message ?? err}`);
    },
  });

  const createHandoff = useMutation({
    mutationFn: (params: {
      title: string;
      description?: string;
      assigneeId: number;
      priority: CollabTaskPriority;
    }) =>
      CollaborationHubClient.createTask({
        fromAgentId: postingAgentId,
        toAgentId: params.assigneeId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        channelId: selectedChannelId,
      }),
    onSuccess: (task) => {
      if (task) toast.success(`Handoff "${task.title}" created`);
      queryClient.invalidateQueries({ queryKey: ["collab", "messages", selectedChannelId] });
      queryClient.invalidateQueries({ queryKey: ["collab", "tasks", "channel", selectedChannelId] });
    },
    onError: (err: unknown) => {
      toast.error(`Failed to create handoff: ${(err as Error)?.message ?? err}`);
    },
  });

  const updateTask = useMutation({
    mutationFn: (params: { id: number; status: CollabTaskStatus }) =>
      CollaborationHubClient.updateTaskStatus(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collab", "tasks", "channel", selectedChannelId] });
      queryClient.invalidateQueries({ queryKey: ["collab", "messages", selectedChannelId] });
    },
    onError: (err: unknown) => {
      toast.error(`Failed to update task: ${(err as Error)?.message ?? err}`);
    },
  });

  // ---- empty state ----
  if (!channelsQuery.isLoading && channels.length === 0) {
    return <EmptyState onSeed={() => seedDefaults.mutate()} seeding={seedDefaults.isPending} />;
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Collaboration Hub</h1>
            <p className="text-xs text-muted-foreground">
              Inter-agent channels, handoffs, and async coordination
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Post as agent</span>
            <Input
              type="number"
              min={1}
              value={postingAgentIdInput}
              onChange={(e) => setPostingAgentIdInput(e.target.value)}
              className="h-8 w-20 text-xs"
            />
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: colorForAgent(postingAgentId) }}
              aria-hidden
            />
          </div>
          <Link
            to="/collaboration/activity"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Activity className="h-3.5 w-3.5" />
            Activity feed
          </Link>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail */}
        <aside className="flex w-64 flex-col border-r">
          <ChannelList
            channels={channels}
            selectedId={selectedChannelId}
            onSelect={setSelectedChannelId}
            onCreate={(p) => createChannel.mutate(p)}
            creating={createChannel.isPending}
          />
        </aside>

        {/* Center stream */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {selectedChannel ? (
            <>
              <ChannelHeader channel={selectedChannel} memberCount={subscriptions.length} />
              <MessageStream messages={messages} loading={messagesQuery.isLoading} />
              <Composer
                channelName={selectedChannel.name}
                postingAgentId={postingAgentId}
                onPost={(content, kind) => postMessage.mutate({ content, kind })}
                onCreateHandoff={(p) => createHandoff.mutate(p)}
                posting={postMessage.isPending || createHandoff.isPending}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {channelsQuery.isLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading channels…
                </span>
              ) : (
                "Select a channel to start"
              )}
            </div>
          )}
        </main>

        {/* Right rail */}
        <aside className="flex w-72 flex-col border-l">
          <RightRail
            subscriptions={subscriptions}
            tasks={tasks}
            onUpdateTask={(id, status) => updateTask.mutate({ id, status })}
          />
        </aside>
      </div>
    </div>
  );
}

export default CollaborationHubPage;

// =============================================================================
// Sub-components
// =============================================================================

function EmptyState({ onSeed, seeding }: { onSeed: () => void; seeding: boolean }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Card className="max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Collaboration Hub</CardTitle>
              <p className="text-xs text-muted-foreground">No channels yet</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Channels let your agents coordinate, share context, and hand off work to each
            other. Seed the defaults to get started — you can always create more later.
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              <span className="font-mono">#general</span> — catch-all coordination
            </li>
            <li>
              <span className="font-mono">#alerts</span> — system & monitoring signals
            </li>
            <li>
              <span className="font-mono">#handoffs</span> — inter-agent task delegation
            </li>
          </ul>
          <Button onClick={onSeed} disabled={seeding} className="w-full">
            {seeding ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Seeding…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Seed default channels
              </span>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelList({
  channels,
  selectedId,
  onSelect,
  onCreate,
  creating,
}: {
  channels: CollabChannel[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: (params: {
    name: string;
    description?: string;
    visibility: CollabChannelVisibility;
  }) => void;
  creating: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [visibility, setVisibility] = React.useState<CollabChannelVisibility>("public");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, description: description.trim() || undefined, visibility });
    setName("");
    setDescription("");
    setVisibility("public");
    setOpen(false);
  };

  return (
    <>
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Channels
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setOpen(true)}
          aria-label="Create channel"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <ul className="space-y-0.5 p-2">
          {channels.map((channel) => {
            const active = channel.id === selectedId;
            const Icon = channel.visibility === "private" ? Lock : Hash;
            return (
              <li key={channel.id}>
                <button
                  type="button"
                  onClick={() => onSelect(channel.id)}
                  className={[
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    active
                      ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                      : "hover:bg-muted",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{channel.name}</span>
                  {channel.archived ? (
                    <Archive className="ml-auto h-3 w-3 opacity-50" />
                  ) : null}
                </button>
              </li>
            );
          })}
          {channels.length === 0 ? (
            <li className="px-2 py-3 text-xs text-muted-foreground">No channels</li>
          ) : null}
        </ul>
      </ScrollArea>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create channel</DialogTitle>
            <DialogDescription>
              Channels organize agent collaboration around a topic.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="sales-ops"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Visibility</label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as CollabChannelVisibility)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChannelHeader({
  channel,
  memberCount,
}: {
  channel: CollabChannel;
  memberCount: number;
}) {
  const Icon = channel.visibility === "private" ? Lock : Hash;
  return (
    <div className="flex items-center justify-between border-b px-6 py-3">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-semibold">{channel.name}</div>
          <div className="text-xs text-muted-foreground">
            {channel.topic ?? channel.description ?? "No topic set"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        {memberCount} subscribed
      </div>
    </div>
  );
}

function MessageStream({
  messages,
  loading,
}: {
  messages: CollabMessage[];
  loading: boolean;
}) {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  // Auto-scroll to bottom on new messages
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-4">
      {loading && messages.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading messages…
        </div>
      ) : messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
          <MessageSquare className="mb-2 h-8 w-8 opacity-40" />
          <p>No messages yet</p>
          <p className="text-xs">Be the first to post in this channel.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: CollabMessage }) {
  const color = colorForAgent(message.fromAgentId);
  const initial =
    message.fromAgentId == null ? "·" : String(message.fromAgentId).slice(0, 2);

  return (
    <li className="flex items-start gap-3">
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase text-white"
        style={{ backgroundColor: color }}
        aria-label={`agent ${message.fromAgentId ?? "system"}`}
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2 text-xs">
          <span className="font-medium">
            {message.fromAgentId == null ? "system" : `agent #${message.fromAgentId}`}
          </span>
          <Badge variant={KIND_VARIANT[message.kind]} className="h-4 px-1.5 text-[10px]">
            {KIND_LABEL[message.kind]}
          </Badge>
          {message.toAgentId != null ? (
            <span className="text-muted-foreground">
              → agent #{message.toAgentId}
            </span>
          ) : null}
          <span className="text-muted-foreground">{formatRelativeTime(message.createdAt)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-snug">
          {message.content}
        </div>
      </div>
    </li>
  );
}

function Composer({
  channelName,
  postingAgentId,
  onPost,
  onCreateHandoff,
  posting,
}: {
  channelName: string;
  postingAgentId: number;
  onPost: (content: string, kind: CollabMessageKind) => void;
  onCreateHandoff: (params: {
    title: string;
    description?: string;
    assigneeId: number;
    priority: CollabTaskPriority;
  }) => void;
  posting: boolean;
}) {
  const [kind, setKind] = React.useState<"chat" | "handoff">("chat");
  const [text, setText] = React.useState("");
  // Handoff-specific fields
  const [assigneeIdInput, setAssigneeIdInput] = React.useState("2");
  const [priority, setPriority] = React.useState<CollabTaskPriority>("normal");

  const submit = () => {
    if (kind === "chat") {
      const content = text.trim();
      if (!content) return;
      onPost(content, "chat");
      setText("");
      return;
    }
    // handoff
    const title = text.trim();
    if (!title) return;
    const assigneeId = Number.parseInt(assigneeIdInput, 10);
    if (!assigneeId || assigneeId <= 0) {
      toast.error("Provide a valid assignee agent id");
      return;
    }
    if (assigneeId === postingAgentId) {
      toast.error("Assignee must differ from poster");
      return;
    }
    onCreateHandoff({ title, assigneeId, priority });
    setText("");
  };

  return (
    <div className="border-t px-6 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as "chat" | "handoff")}>
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chat">💬 chat</SelectItem>
            <SelectItem value="handoff">🤝 handoff</SelectItem>
          </SelectContent>
        </Select>
        {kind === "handoff" ? (
          <>
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="number"
              min={1}
              value={assigneeIdInput}
              onChange={(e) => setAssigneeIdInput(e.target.value)}
              className="h-7 w-20 text-xs"
              placeholder="agent id"
            />
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as CollabTaskPriority)}
            >
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="normal">normal</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="urgent">urgent</SelectItem>
              </SelectContent>
            </Select>
          </>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: colorForAgent(postingAgentId) }}
            aria-hidden
          />
          posting as agent #{postingAgentId}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            kind === "chat"
              ? `Message #${channelName}…`
              : "Handoff title (e.g. ‘draft Q3 forecast’)…"
          }
          className="min-h-[44px] flex-1 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button onClick={submit} disabled={posting || !text.trim()}>
          {posting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function RightRail({
  subscriptions,
  tasks,
  onUpdateTask,
}: {
  subscriptions: CollabSubscription[];
  tasks: CollabTask[];
  onUpdateTask: (id: number, status: CollabTaskStatus) => void;
}) {
  return (
    <Tabs defaultValue="members" className="flex flex-1 flex-col">
      <TabsList className="m-2 grid grid-cols-2">
        <TabsTrigger value="members" className="text-xs">
          <Users className="mr-1.5 h-3.5 w-3.5" />
          Members
        </TabsTrigger>
        <TabsTrigger value="tasks" className="text-xs">
          <ListChecks className="mr-1.5 h-3.5 w-3.5" />
          Tasks ({tasks.length})
        </TabsTrigger>
      </TabsList>
      <TabsContent value="members" className="flex-1 overflow-y-auto px-3 pb-3">
        {subscriptions.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">No subscribers yet</div>
        ) : (
          <ul className="space-y-1.5">
            {subscriptions.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: colorForAgent(s.agentId) }}
                  aria-hidden
                />
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs">agent #{s.agentId}</span>
                {s.muted ? (
                  <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">
                    muted
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="tasks" className="flex-1 overflow-y-auto px-3 pb-3">
        {tasks.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            No handoffs in this channel yet
          </div>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t.id} className="rounded-md border p-2">
                <div className="flex items-center gap-1.5 text-xs">
                  {statusIcon(t.status)}
                  <span className="font-medium">{t.title}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {formatRelativeTime(t.updatedAt)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: colorForAgent(t.fromAgentId) }}
                    aria-hidden
                  />
                  agent #{t.fromAgentId}
                  <span>→</span>
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: colorForAgent(t.toAgentId) }}
                    aria-hidden
                  />
                  agent #{t.toAgentId}
                  <Separator orientation="vertical" className="mx-1 h-3" />
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">
                    {t.priority}
                  </Badge>
                </div>
                {t.description ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">{t.description}</p>
                ) : null}
                {t.status !== "done" && t.status !== "cancelled" ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => onUpdateTask(t.id, "accepted")}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => onUpdateTask(t.id, "rejected")}
                        >
                          Reject
                        </Button>
                      </>
                    ) : null}
                    {t.status === "accepted" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => onUpdateTask(t.id, "in_progress")}
                      >
                        Start
                      </Button>
                    ) : null}
                    {(t.status === "accepted" || t.status === "in_progress") ? (
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => onUpdateTask(t.id, "done")}
                      >
                        Complete
                      </Button>
                    ) : null}
                    {t.status !== "rejected" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => onUpdateTask(t.id, "cancelled")}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

// Avoid unused import lint
void Clock;
