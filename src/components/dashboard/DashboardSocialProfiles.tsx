import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  CalendarClock,
  Loader2,
  RefreshCcw,
  Send,
  Users,
} from "lucide-react";

import {
  FacebookIcon,
  XLogoIcon,
} from "@/components/social/social-platform-meta";
import type {
  SocialConnectionsStatus,
  SocialPost,
} from "@/ipc/types/social_media";

function compactCount(value: number | undefined): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function SocialMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="border-l border-cyan-300/14 px-3 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-lg font-semibold text-cyan-50 tabular-nums">
          {value}
        </p>
        <Icon className="size-3.5 text-cyan-300/45" />
      </div>
      <p className="mt-1 text-[9px] font-semibold tracking-[0.16em] text-cyan-100/35 uppercase">
        {label}
      </p>
    </div>
  );
}

export function DashboardSocialProfiles({
  connections,
  posts,
  refreshing,
  onRefreshX,
}: {
  connections: SocialConnectionsStatus | undefined;
  posts: SocialPost[];
  refreshing: boolean;
  onRefreshX: () => void;
}) {
  const x = connections?.x;
  const facebook = connections?.facebook;
  const now = Date.now();
  const xPosts = posts.filter((post) => post.platform === "x");
  const recentPublished = xPosts.filter(
    (post) =>
      post.status === "posted" &&
      (post.postedAt ?? 0) >= now - 30 * 24 * 60 * 60 * 1000,
  );
  const scheduled = xPosts.filter((post) => post.status === "scheduled");
  const engagement = recentPublished.reduce(
    (sum, post) =>
      sum +
      (post.metrics?.likes ?? 0) +
      (post.metrics?.reposts ?? 0) +
      (post.metrics?.replies ?? 0) +
      (post.metrics?.quotes ?? 0),
    0,
  );
  const displayName = x?.displayName || x?.username || "X profile";

  return (
    <section
      className="relative h-full overflow-hidden px-2 py-1"
      data-testid="dashboard-social-profiles"
    >
      <div className="pointer-events-none absolute -top-20 -right-16 size-48 rounded-full bg-sky-400/8 blur-3xl" />
      <header className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.22em] text-cyan-100/40 uppercase">
            Social intelligence
          </p>
          <h2 className="mt-1 text-sm font-semibold text-cyan-50/90">
            Connected profiles
          </h2>
        </div>
        <Link
          to="/planner"
          className="inline-flex items-center gap-1 text-[10px] font-medium text-cyan-300/65 transition-colors hover:text-cyan-200"
        >
          Open studio <ArrowUpRight className="size-3" />
        </Link>
      </header>

      {x?.connected ? (
        <>
          <div className="relative mt-4 flex items-start gap-3">
            {x.profileImageUrl ? (
              <img
                src={x.profileImageUrl}
                alt={`${displayName} profile`}
                className="size-14 shrink-0 rounded-2xl border border-cyan-300/20 object-cover shadow-[0_10px_28px_rgba(0,0,0,0.35)]"
              />
            ) : (
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-cyan-300/15 bg-white text-black">
                <XLogoIcon className="size-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-base font-semibold text-cyan-50">
                  {displayName}
                </h3>
                {x.verified && (
                  <BadgeCheck className="size-4 shrink-0 fill-sky-400 text-[#03101d]" />
                )}
              </div>
              <p className="text-xs text-cyan-100/45">@{x.username}</p>
              <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-cyan-50/55">
                {x.bio || "Connected and ready to publish."}
              </p>
            </div>
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-cyan-300/12 text-cyan-100/45 transition-colors hover:border-cyan-300/30 hover:text-cyan-200 disabled:opacity-50"
              onClick={onRefreshX}
              disabled={refreshing}
              title="Refresh X profile"
            >
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
            </button>
          </div>

          <div className="relative mt-5 grid grid-cols-2 gap-y-4">
            <SocialMetric
              icon={Users}
              label="Followers"
              value={compactCount(x.followersCount)}
            />
            <SocialMetric
              icon={Send}
              label="30d published"
              value={String(recentPublished.length)}
            />
            <SocialMetric
              icon={CalendarClock}
              label="Scheduled"
              value={String(scheduled.length)}
            />
            <SocialMetric
              icon={BarChart3}
              label="Engagement"
              value={compactCount(engagement)}
            />
          </div>

          <div className="relative mt-3 flex items-center justify-between border-t border-cyan-400/10 pt-3 text-[10px]">
            <span className="inline-flex items-center gap-1.5 text-emerald-300/70">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.8)]" />
              X publishing online
            </span>
            <span className="text-cyan-100/30">
              {compactCount(x.followingCount)} following ·{" "}
              {compactCount(x.postCount)} posts
            </span>
          </div>
        </>
      ) : (
        <div className="relative mt-4 border-y border-dashed border-cyan-300/14 py-5 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-xl bg-white text-black">
            <XLogoIcon className="size-4" />
          </span>
          <p className="mt-2 text-xs font-medium text-cyan-50/75">
            Connect X to see audience and publishing stats
          </p>
          <Link
            to="/planner"
            className="mt-2 inline-flex text-[10px] font-semibold text-cyan-300/70 hover:text-cyan-200"
          >
            Connect a social account
          </Link>
        </div>
      )}

      {facebook?.connected && (
        <div className="relative mt-3 flex items-center gap-2 border-t border-blue-400/10 px-1 pt-3 text-[10px] text-blue-200/65">
          <FacebookIcon className="size-3.5" />
          <span className="truncate">
            Facebook · {facebook.pageName || "Page connected"}
          </span>
          <span className="ml-auto size-1.5 rounded-full bg-emerald-400" />
        </div>
      )}
    </section>
  );
}
