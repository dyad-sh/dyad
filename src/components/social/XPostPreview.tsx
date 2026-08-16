import {
  BadgeCheck,
  BarChart3,
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Share,
} from "lucide-react";

import type { SocialPostMetrics } from "@/ipc/types/social_media";
import { cn } from "@/lib/utils";
import { XLogoIcon } from "./social-platform-meta";

function compactNumber(value: number | undefined): string {
  if (!value) return "";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function Avatar({ name, src }: { name: string; src?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={`${name} profile`}
        className="size-11 shrink-0 rounded-full object-cover ring-1 ring-black/10"
      />
    );
  }
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 via-indigo-500 to-fuchsia-500 text-sm font-bold text-white shadow-lg">
      {name.trim().charAt(0).toUpperCase() || "X"}
    </span>
  );
}

function EngagementItem({
  icon: Icon,
  value,
  tone,
}: {
  icon: typeof MessageCircle;
  value?: number;
  tone: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", tone)}>
      <span className="grid size-7 place-items-center rounded-full transition-colors hover:bg-current/10">
        <Icon className="size-[17px]" strokeWidth={1.8} />
      </span>
      {value !== undefined && (
        <span className="text-[11px] tabular-nums">
          {compactNumber(value) || "0"}
        </span>
      )}
    </span>
  );
}

/** A faithful, reusable X post surface for composing and planner details. */
export function XPostPreview({
  displayName,
  username,
  profileImageUrl,
  verified,
  content,
  image,
  metrics,
  timestamp = "now",
  className,
  compact = false,
}: {
  displayName?: string;
  username?: string;
  profileImageUrl?: string;
  verified?: boolean;
  content: string;
  image?: string | null;
  metrics?: SocialPostMetrics | null;
  timestamp?: string;
  className?: string;
  compact?: boolean;
}) {
  const name = displayName || username || "Your profile";
  const handle = username ? `@${username.replace(/^@/, "")}` : "@you";

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-zinc-200 bg-white text-[#0f1419] shadow-[0_18px_60px_rgba(15,23,42,0.13)] dark:border-white/12 dark:bg-[#050505] dark:text-[#e7e9ea] dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)]",
        className,
      )}
      data-testid="x-post-preview"
    >
      <div className={cn("p-4", compact && "p-3.5")}>
        <div className="flex gap-3">
          <Avatar name={name} src={profileImageUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1 text-[14px] leading-5">
              <span className="truncate font-bold">{name}</span>
              {verified && (
                <BadgeCheck
                  className="size-4 shrink-0 fill-[#1d9bf0] text-white dark:text-black"
                  aria-label="Verified"
                />
              )}
              <span className="truncate text-[#536471] dark:text-[#71767b]">
                {handle}
              </span>
              <span className="text-[#536471] dark:text-[#71767b]">·</span>
              <span className="shrink-0 text-[#536471] dark:text-[#71767b]">
                {timestamp}
              </span>
              <MoreHorizontal className="ml-auto size-4 shrink-0 text-[#536471] dark:text-[#71767b]" />
            </div>

            <p
              className={cn(
                "mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-5.5",
                !content && "text-[#536471] dark:text-[#71767b]",
              )}
            >
              {content || "Your post will appear here as you create it."}
            </p>

            {image && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 dark:border-white/12">
                <img
                  src={image}
                  alt="Post attachment preview"
                  className={cn(
                    "w-full object-cover",
                    compact ? "max-h-56" : "max-h-80",
                  )}
                />
              </div>
            )}

            <div className="mt-3 flex max-w-md items-center justify-between text-[#536471] dark:text-[#71767b]">
              <EngagementItem
                icon={MessageCircle}
                value={metrics?.replies}
                tone="hover:text-[#1d9bf0]"
              />
              <EngagementItem
                icon={Repeat2}
                value={metrics?.reposts}
                tone="hover:text-[#00ba7c]"
              />
              <EngagementItem
                icon={Heart}
                value={metrics?.likes}
                tone="hover:text-[#f91880]"
              />
              <EngagementItem
                icon={BarChart3}
                value={metrics?.impressions}
                tone="hover:text-[#1d9bf0]"
              />
              <span className="flex items-center">
                <Bookmark className="size-[17px]" strokeWidth={1.8} />
                <Share className="ml-4 size-[17px]" strokeWidth={1.8} />
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/80 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400 dark:border-white/8 dark:bg-white/[0.025] dark:text-white/25">
        <span>Live X preview</span>
        <XLogoIcon className="size-3" />
      </div>
    </article>
  );
}
