import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarClock,
  CalendarPlus,
  BarChart3,
  CheckCircle2,
  Circle,
  CircleCheck,
  FileText,
  Loader2,
  Plus,
  Send,
} from "lucide-react";
import { useAtom } from "jotai";

import { ParticleBackground } from "@/components/home/ParticleBackground";
import { SocialConnectDialog } from "@/components/social/SocialConnectDialog";
import { XProfileInsightsCard } from "@/components/social/XProfileInsightsCard";
import {
  SOCIAL_PLATFORM_META,
  SocialPlatformIcon,
} from "@/components/social/social-platform-meta";
import { useSocialConnections, useSocialPosts } from "@/hooks/useSocialMedia";
import type { SocialPlatform, SocialPost } from "@/ipc/types/social_media";
import { cn } from "@/lib/utils";
import { showError } from "@/lib/toast";
import { ContentCalendar } from "./ContentCalendar";
import { PostComposerModal } from "./PostComposerModal";
import { PostDetailsModal } from "./PostDetailsModal";
import { POST_STATUS_META, postCalendarTime } from "./post-meta";
import { TaskComposerModal } from "./TaskComposerModal";
import { plannerTasksAtom } from "@/atoms/plannerAtoms";
import {
  sortPlannerTasks,
  upsertPlannerTask,
  type PlannerTask,
} from "@/lib/planner_tasks";

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Send;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/85 px-4 py-3 shadow-sm backdrop-blur-xl">
      <span
        className="grid size-9 place-items-center rounded-xl border border-border/60"
        style={{ background: `${accent}1a`, color: accent }}
      >
        <Icon className="size-4.5" />
      </span>
      <div className="leading-tight">
        <p className="text-xl font-semibold tabular-nums text-foreground">
          {value}
        </p>
        <p className="font-jarvis-ui text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
}

function ConnectionChip({
  platform,
  connected,
  label,
  onConnect,
}: {
  platform: SocialPlatform;
  connected: boolean;
  label?: string;
  onConnect: () => void;
}) {
  const meta = SOCIAL_PLATFORM_META[platform];
  return (
    <button
      type="button"
      onClick={connected ? undefined : onConnect}
      title={
        connected
          ? `${meta.label} connected${label ? ` as ${label}` : ""} — manage in Settings → Plugins → Integrations`
          : `Connect ${meta.label}`
      }
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        connected
          ? "cursor-default border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
          : "border-border bg-card/70 text-muted-foreground hover:border-primary/45 hover:text-foreground",
      )}
      data-testid={`connection-chip-${platform}`}
    >
      <SocialPlatformIcon platform={platform} className="size-3.5" />
      {connected
        ? (label ?? `${meta.label} connected`)
        : `Connect ${meta.label}`}
      {connected && <CheckCircle2 className="size-3.5 text-emerald-500" />}
    </button>
  );
}

function QueueItem({
  post,
  onClick,
}: {
  post: SocialPost;
  onClick: () => void;
}) {
  const status = POST_STATUS_META[post.status];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-xl border border-border/60 bg-muted/35 p-2.5 text-left transition hover:border-primary/35 hover:bg-accent/60"
    >
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border",
          SOCIAL_PLATFORM_META[post.platform].iconWrapClass,
        )}
      >
        <SocialPlatformIcon platform={post.platform} className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs leading-snug text-foreground/90">
          {post.content.replace(/\s+/g, " ")}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px]",
              status.text,
            )}
          >
            <span className={cn("size-1.5 rounded-full", status.dot)} />
            {status.label}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {format(postCalendarTime(post), "MMM d · HH:mm")}
          </span>
        </span>
      </span>
    </button>
  );
}

function TaskQueueItem({
  task,
  onClick,
  onToggle,
}: {
  task: PlannerTask;
  onClick: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/35 p-2.5">
      <button
        type="button"
        onClick={onToggle}
        className="mt-0.5 text-violet-500 transition hover:text-foreground"
        aria-label={task.completed ? "Mark task incomplete" : "Complete task"}
      >
        {task.completed ? (
          <CircleCheck className="size-4" />
        ) : (
          <Circle className="size-4" />
        )}
      </button>
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn(
            "block truncate text-xs leading-snug text-foreground/90",
            task.completed && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              task.priority === "high"
                ? "bg-rose-400"
                : task.priority === "medium"
                  ? "bg-violet-400"
                  : "bg-slate-400",
            )}
          />
          {format(task.dueAt, "MMM d · HH:mm")} · {task.priority}
        </span>
      </button>
    </div>
  );
}

/**
 * Social Media Agent — the content calendar is the master view of every
 * created and planned post. Day clicks open the AI composer (copy + Nano
 * Banana image), and everything lands in the planner queue.
 */
export default function SocialMediaAgentPage() {
  const { connections, refreshXProfile, isRefreshingXProfile } =
    useSocialConnections();
  const { posts, isLoading } = useSocialPosts();
  const [tasks, setTasks] = useAtom(plannerTasksAtom);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDate, setComposerDate] = useState<Date>(() => new Date());
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskDate, setTaskDate] = useState<Date>(() => new Date());
  const [selectedTask, setSelectedTask] = useState<PlannerTask | null>(null);
  const [connectPlatform, setConnectPlatform] = useState<SocialPlatform | null>(
    null,
  );

  const counts = useMemo(
    () => ({
      scheduled: posts.filter(
        (p) => p.status === "scheduled" || p.status === "posting",
      ).length,
      posted: posts.filter((p) => p.status === "posted").length,
      drafts: posts.filter((p) => p.status === "draft").length,
      engagement: posts.reduce(
        (total, post) =>
          total +
          (post.metrics?.likes ?? 0) +
          (post.metrics?.reposts ?? 0) +
          (post.metrics?.replies ?? 0),
        0,
      ),
      openTasks: tasks.filter((task) => !task.completed).length,
      completedTasks: tasks.filter((task) => task.completed).length,
    }),
    [posts, tasks],
  );

  const queue = useMemo(
    () =>
      posts
        .filter((p) => p.status === "scheduled" || p.status === "posting")
        .sort(
          (a, b) =>
            (a.scheduledFor ?? a.createdAt) - (b.scheduledFor ?? b.createdAt),
        )
        .slice(0, 10),
    [posts],
  );

  const history = useMemo(
    () =>
      posts
        .filter((p) => p.status !== "scheduled" && p.status !== "posting")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10),
    [posts],
  );

  const upcomingTasks = useMemo(
    () =>
      sortPlannerTasks(tasks)
        .filter((task) => !task.completed)
        .slice(0, 8),
    [tasks],
  );

  const completedTasks = useMemo(
    () =>
      [...tasks]
        .filter((task) => task.completed)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5),
    [tasks],
  );

  const openComposer = (day: Date) => {
    setComposerDate(day);
    setComposerOpen(true);
  };

  const openDetails = (post: SocialPost) => {
    setSelectedPost(post);
    setDetailsOpen(true);
  };

  const openTask = (day: Date, task: PlannerTask | null = null) => {
    setTaskDate(day);
    setSelectedTask(task);
    setTaskOpen(true);
  };

  const saveTask = (task: PlannerTask) => {
    setTasks((current) => upsertPlannerTask(current, task));
  };

  const deleteTask = (id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
  };

  const toggleTask = (task: PlannerTask) => {
    saveTask({
      ...task,
      completed: !task.completed,
      updatedAt: Date.now(),
    });
  };

  return (
    <div
      className="agent-os social-studio no-app-region-drag relative flex min-h-0 w-full flex-1 overflow-hidden text-foreground"
      data-testid="planner-page"
    >
      <ParticleBackground className="z-0" />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-y-auto p-5 sm:p-6">
        {/* Header */}
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl border border-border/70 bg-card text-foreground shadow-sm">
            <SocialPlatformIcon platform="x" className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-jarvis-display text-2xl font-semibold tracking-tight text-foreground">
              Social Studio
            </h1>
            <p className="font-jarvis-ui text-xs tracking-wide text-muted-foreground">
              Create with AI, publish beautifully, learn what resonates
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ConnectionChip
              platform="facebook"
              connected={connections?.facebook.connected ?? false}
              label={connections?.facebook.pageName}
              onConnect={() => setConnectPlatform("facebook")}
            />
            <ConnectionChip
              platform="x"
              connected={connections?.x.connected ?? false}
              label={
                connections?.x.username
                  ? `@${connections.x.username}`
                  : undefined
              }
              onConnect={() => setConnectPlatform("x")}
            />
            <button
              type="button"
              onClick={() => openTask(new Date())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3.5 py-2 text-sm font-medium text-white shadow-[0_0_18px_rgba(0,229,255,0.35)] transition-opacity hover:opacity-90"
              data-testid="new-task-button"
            >
              <Plus className="size-4" />
              Add task
            </button>
            <button
              type="button"
              onClick={() => openComposer(new Date())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition hover:bg-primary/15"
              data-testid="new-post-button"
            >
              <CalendarPlus className="size-4" />
              Create X post
            </button>
          </div>
        </header>

        {connections?.x.connected && (
          <div className="mb-5">
            <XProfileInsightsCard
              profile={connections.x}
              posts={posts}
              refreshing={isRefreshingXProfile}
              onRefresh={() => {
                void refreshXProfile().catch(showError);
              }}
            />
          </div>
        )}

        {/* Stats */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Scheduled"
            value={counts.scheduled}
            icon={CalendarClock}
            accent="#fbbf24"
          />
          <StatCard
            label="Published"
            value={counts.posted}
            icon={CircleCheck}
            accent="#34d399"
          />
          <StatCard
            label="Drafts"
            value={counts.drafts}
            icon={FileText}
            accent="#38bdf8"
          />
          <StatCard
            label="Engagement"
            value={counts.engagement}
            icon={BarChart3}
            accent="#c084fc"
          />
        </div>

        {/* Calendar (master view) + planner rail */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
          <div className="flex min-h-[560px] min-w-0 flex-1 flex-col">
            {isLoading ? (
              <div className="flex flex-1 items-center justify-center rounded-2xl border border-border/70 bg-card/85">
                <Loader2 className="size-6 animate-spin text-primary/70" />
              </div>
            ) : (
              <ContentCalendar
                posts={posts}
                tasks={tasks}
                onSelectDay={(day) => openTask(day)}
                onSelectPost={openDetails}
                onSelectTask={(task) => openTask(new Date(task.dueAt), task)}
              />
            )}
          </div>

          {/* Planner queue */}
          <aside className="w-full shrink-0 space-y-4 xl:w-80">
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm backdrop-blur-xl">
              <h2 className="font-jarvis-ui text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Up next
              </h2>
              <div className="mt-3 space-y-2">
                {upcomingTasks.length === 0 && queue.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing scheduled. Click a day to add your first task.
                  </p>
                ) : (
                  <>
                    {upcomingTasks.map((task) => (
                      <TaskQueueItem
                        key={task.id}
                        task={task}
                        onClick={() => openTask(new Date(task.dueAt), task)}
                        onToggle={() => toggleTask(task)}
                      />
                    ))}
                    {queue.map((post) => (
                      <QueueItem
                        key={post.id}
                        post={post}
                        onClick={() => openDetails(post)}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm backdrop-blur-xl">
              <h2 className="font-jarvis-ui text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Recent activity
              </h2>
              <div className="mt-3 space-y-2">
                {history.length === 0 && completedTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Completed tasks and social activity appear here.
                  </p>
                ) : (
                  <>
                    {completedTasks.map((task) => (
                      <TaskQueueItem
                        key={task.id}
                        task={task}
                        onClick={() => openTask(new Date(task.dueAt), task)}
                        onToggle={() => toggleTask(task)}
                      />
                    ))}
                    {history.map((post) => (
                      <QueueItem
                        key={post.id}
                        post={post}
                        onClick={() => openDetails(post)}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Modals */}
      <PostComposerModal
        open={composerOpen}
        onOpenChange={setComposerOpen}
        initialDate={composerDate}
      />
      <PostDetailsModal
        post={selectedPost}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
      <TaskComposerModal
        open={taskOpen}
        task={selectedTask}
        initialDate={taskDate}
        onOpenChange={(open) => {
          setTaskOpen(open);
          if (!open) setSelectedTask(null);
        }}
        onSave={saveTask}
        onDelete={deleteTask}
      />
      {connectPlatform && (
        <SocialConnectDialog
          platform={connectPlatform}
          open={connectPlatform != null}
          onOpenChange={(o) => !o && setConnectPlatform(null)}
        />
      )}
    </div>
  );
}
