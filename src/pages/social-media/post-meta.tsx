import type { SocialPostStatus } from "@/ipc/types/social_media";
import { cn } from "@/lib/utils";

export const POST_STATUS_META: Record<
  SocialPostStatus,
  { label: string; dot: string; text: string; chip: string }
> = {
  draft: {
    label: "Draft",
    dot: "bg-slate-400",
    text: "text-slate-300",
    chip: "border-slate-400/25 bg-slate-400/10 text-slate-200",
  },
  scheduled: {
    label: "Scheduled",
    dot: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]",
    text: "text-amber-300",
    chip: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  },
  posting: {
    label: "Posting…",
    dot: "bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(0,229,255,0.7)]",
    text: "text-cyan-300",
    chip: "border-cyan-400/30 bg-cyan-500/10 text-cyan-200",
  },
  posted: {
    label: "Published",
    dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]",
    text: "text-emerald-300",
    chip: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  },
  failed: {
    label: "Failed",
    dot: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]",
    text: "text-rose-300",
    chip: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  },
};

export function PostStatusBadge({
  status,
  className,
}: {
  status: SocialPostStatus;
  className?: string;
}) {
  const meta = POST_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        meta.chip,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

/** The moment a post occupies on the calendar. */
export function postCalendarTime(post: {
  scheduledFor?: number | null;
  postedAt?: number | null;
  createdAt: number;
}): number {
  return post.postedAt ?? post.scheduledFor ?? post.createdAt;
}
