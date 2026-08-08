import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarPlus,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { SocialPlatformIcon } from "@/components/social/social-platform-meta";
import type { SocialPlatform, SocialPost } from "@/ipc/types/social_media";
import { cn } from "@/lib/utils";
import type { PlannerTask } from "@/lib/planner_tasks";
import { POST_STATUS_META, postCalendarTime } from "./post-meta";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS_PER_DAY = 3;

function buildMonthGrid(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days: Date[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

function PostChip({
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={post.content}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] leading-none transition hover:brightness-125",
        status.chip,
      )}
      data-testid={`calendar-post-${post.id}`}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
      <SocialPlatformIcon
        platform={post.platform}
        className="size-3 shrink-0"
      />
      <span className="truncate">
        {format(postCalendarTime(post), "HH:mm")} ·{" "}
        {post.content.replace(/\s+/g, " ")}
      </span>
    </button>
  );
}

function TaskChip({
  task,
  onClick,
}: {
  task: PlannerTask;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={task.title}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] leading-none transition hover:brightness-125",
        task.completed
          ? "border-emerald-400/20 bg-emerald-500/8 text-emerald-200/55 line-through"
          : task.priority === "high"
            ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
            : "border-violet-400/25 bg-violet-500/10 text-violet-100",
      )}
      data-testid={`calendar-task-${task.id}`}
    >
      <CheckSquare2 className="size-3 shrink-0" />
      <span className="truncate">
        {format(task.dueAt, "HH:mm")} · {task.title}
      </span>
    </button>
  );
}

/**
 * Master month view of the content planner: every created and planned post
 * shows on its day. Clicking a day opens the AI composer for that date;
 * clicking a post chip opens its details.
 */
export function ContentCalendar({
  posts,
  tasks,
  onSelectDay,
  onSelectPost,
  onSelectTask,
}: {
  posts: SocialPost[];
  tasks: PlannerTask[];
  onSelectDay: (day: Date) => void;
  onSelectPost: (post: SocialPost) => void;
  onSelectTask: (task: PlannerTask) => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [calendarFilter, setCalendarFilter] = useState<
    SocialPlatform | "tasks" | "all"
  >("all");

  const days = useMemo(() => buildMonthGrid(month), [month]);

  const itemsByDay = useMemo(() => {
    const map = new Map<
      string,
      Array<
        | { kind: "post"; post: SocialPost; time: number }
        | { kind: "task"; task: PlannerTask; time: number }
      >
    >();
    if (calendarFilter !== "tasks") {
      for (const post of posts) {
        if (calendarFilter !== "all" && post.platform !== calendarFilter) {
          continue;
        }
        const time = postCalendarTime(post);
        const key = format(time, "yyyy-MM-dd");
        map.set(key, [...(map.get(key) ?? []), { kind: "post", post, time }]);
      }
    }
    if (calendarFilter === "all" || calendarFilter === "tasks") {
      for (const task of tasks) {
        const key = format(task.dueAt, "yyyy-MM-dd");
        map.set(key, [
          ...(map.get(key) ?? []),
          { kind: "task", task, time: task.dueAt },
        ]);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.time - b.time);
    }
    return map;
  }, [calendarFilter, posts, tasks]);

  const filterOptions: Array<{
    id: SocialPlatform | "tasks" | "all";
    label: string;
  }> = [
    { id: "all", label: "All" },
    { id: "tasks", label: "Tasks" },
    { id: "facebook", label: "Facebook" },
    { id: "x", label: "X" },
  ];

  return (
    <div
      className="flex min-h-0 flex-1 flex-col rounded-2xl border border-cyan-400/12 bg-[rgba(8,20,40,0.5)] shadow-[0_0_24px_rgba(0,229,255,0.05),inset_0_1px_0_0_rgba(0,229,255,0.08)] backdrop-blur-xl"
      data-testid="content-calendar"
    >
      {/* Calendar toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-cyan-400/10 px-4 py-3">
        <h2 className="font-jarvis-display text-lg font-semibold tracking-wide text-white">
          {format(month, "MMMM yyyy")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-cyan-400/40 hover:text-white"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonth(startOfMonth(new Date()))}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition hover:border-cyan-400/40 hover:text-white"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-cyan-400/40 hover:text-white"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {filterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setCalendarFilter(option.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition",
                calendarFilter === option.id
                  ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"
                  : "border-white/10 bg-white/5 text-white/55 hover:text-white/80",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-cyan-400/10">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-2 py-1.5 text-center font-jarvis-ui text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/45"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid flex-1 grid-cols-7 auto-rows-fr">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayItems = itemsByDay.get(key) ?? [];
          const inMonth = isSameMonth(day, month);
          const today = isToday(day);
          const overflow = dayItems.length - MAX_CHIPS_PER_DAY;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDay(day)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectDay(day);
                }
              }}
              className={cn(
                "group relative flex min-h-24 flex-col gap-1 border-b border-r border-cyan-400/8 p-1.5 text-left align-top transition last:border-r-0 hover:bg-cyan-500/5",
                !inMonth && "bg-black/20",
                today && "bg-cyan-500/8",
              )}
              data-testid={`calendar-day-${key}`}
            >
              <div className="flex items-center justify-between">
                <CalendarPlus className="size-3.5 text-cyan-300/0 transition group-hover:text-cyan-300/70" />
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-xs tabular-nums",
                    today
                      ? "bg-cyan-400 font-semibold text-[#04101f] shadow-[0_0_12px_rgba(0,229,255,0.6)]"
                      : inMonth
                        ? "text-white/75"
                        : "text-white/25",
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="flex min-h-0 flex-col gap-1">
                {dayItems
                  .slice(0, MAX_CHIPS_PER_DAY)
                  .map((item) =>
                    item.kind === "post" ? (
                      <PostChip
                        key={`post-${item.post.id}`}
                        post={item.post}
                        onClick={() => onSelectPost(item.post)}
                      />
                    ) : (
                      <TaskChip
                        key={`task-${item.task.id}`}
                        task={item.task}
                        onClick={() => onSelectTask(item.task)}
                      />
                    ),
                  )}
                {overflow > 0 && (
                  <span className="px-1 text-[10px] text-cyan-300/60">
                    +{overflow} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 border-t border-cyan-400/10 px-4 py-2">
        {(
          Object.entries(POST_STATUS_META) as Array<
            [
              keyof typeof POST_STATUS_META,
              (typeof POST_STATUS_META)[keyof typeof POST_STATUS_META],
            ]
          >
        ).map(([status, meta]) => (
          <span
            key={status}
            className="inline-flex items-center gap-1.5 text-[11px] text-white/45"
          >
            <span className={cn("size-1.5 rounded-full", meta.dot)} />
            {meta.label}
          </span>
        ))}
        <span className="ml-auto hidden text-[11px] text-white/30 md:block">
          Click a day to add a task
        </span>
      </div>
    </div>
  );
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}
