import {
  Activity,
  BadgeCheck,
  BarChart3,
  Loader2,
  RefreshCcw,
  TrendingUp,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import type {
  SocialConnectionsStatus,
  SocialPost,
} from "@/ipc/types/social_media";
import { cn } from "@/lib/utils";
import { XLogoIcon } from "./social-platform-meta";

function formatCount(value: number | undefined): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("en", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5">
      <p className="text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

export function XProfileInsightsCard({
  profile,
  posts,
  onRefresh,
  refreshing,
}: {
  profile: SocialConnectionsStatus["x"];
  posts: SocialPost[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const now = Date.now();
  const recentPosts = posts.filter(
    (post) =>
      post.platform === "x" &&
      post.status === "posted" &&
      (post.postedAt ?? 0) >= now - 30 * 24 * 60 * 60 * 1000,
  );
  const measured = recentPosts.filter((post) => post.metrics);
  const averageEngagement = measured.length
    ? Math.round(
        measured.reduce(
          (sum, post) =>
            sum +
            (post.metrics?.likes ?? 0) +
            (post.metrics?.reposts ?? 0) +
            (post.metrics?.replies ?? 0),
          0,
        ) / measured.length,
      )
    : null;
  const followerRatio =
    profile.followersCount !== undefined && profile.followingCount
      ? profile.followersCount / profile.followingCount
      : null;
  const name = profile.displayName || profile.username || "X profile";

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/90 p-5 text-card-foreground shadow-xl backdrop-blur-2xl">
      <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-sky-500/12 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/3 size-64 rounded-full bg-violet-500/10 blur-3xl" />

      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-stretch">
        <div className="flex min-w-0 flex-1 gap-4">
          {profile.profileImageUrl ? (
            <img
              src={profile.profileImageUrl}
              alt={`${name} profile`}
              className="size-16 shrink-0 rounded-2xl object-cover ring-1 ring-border shadow-xl"
            />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white text-black shadow-xl">
              <XLogoIcon className="size-6" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold text-foreground">
                {name}
              </h2>
              {profile.verified && (
                <BadgeCheck className="size-5 fill-sky-500 text-card" />
              )}
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                Connected
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              @{profile.username ?? "you"}
              {profile.verifiedType && profile.verifiedType !== "none"
                ? ` · ${profile.verifiedType} verified`
                : ""}
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/80">
              {profile.bio ||
                "Add a bio on X to give your AI workspace more audience context."}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span>
                <strong className="font-semibold text-foreground">
                  {formatCount(profile.followingCount)}
                </strong>{" "}
                Following
              </span>
              <span>
                <strong className="font-semibold text-foreground">
                  {formatCount(profile.followersCount)}
                </strong>{" "}
                Followers
              </span>
              <span>
                <strong className="font-semibold text-foreground">
                  {formatCount(profile.postCount)}
                </strong>{" "}
                Posts
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="Refresh X profile insights"
            onClick={onRefresh}
            disabled={refreshing}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
          </Button>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[29rem]">
          <MiniMetric
            label="Followers"
            value={formatCount(profile.followersCount)}
          />
          <MiniMetric label="30d posts" value={`+${recentPosts.length}`} />
          <MiniMetric
            label="Avg. engagement"
            value={averageEngagement === null ? "—" : String(averageEngagement)}
          />
          <MiniMetric
            label="Audience ratio"
            value={
              followerRatio === null ? "—" : `${followerRatio.toFixed(1)}×`
            }
          />
        </div>
      </div>

      <div className="relative mt-5 grid gap-2 border-t border-border/60 pt-4 sm:grid-cols-3">
        <InsightLine
          icon={Activity}
          label="Recent activity"
          value={
            recentPosts.length
              ? `${recentPosts.length} published in the last 30 days`
              : "Ready for your next post"
          }
          tone="text-sky-500"
        />
        <InsightLine
          icon={TrendingUp}
          label="Growth signal"
          value={
            recentPosts.length >= 4
              ? "Consistent publishing cadence"
              : "Publish weekly to build momentum"
          }
          tone="text-emerald-500"
        />
        <InsightLine
          icon={measured.length ? BarChart3 : Users}
          label="Audience insight"
          value={
            measured.length
              ? `${measured.length} posts have live performance data`
              : "Refresh published posts to compare engagement"
          }
          tone="text-violet-500"
        />
      </div>

      {profile.profileSyncedAt && (
        <p className="relative mt-3 text-right text-[10px] text-muted-foreground/75">
          Profile synced {formatDistanceToNow(profile.profileSyncedAt)} ago
        </p>
      )}
    </section>
  );
}

function InsightLine({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
      <span
        className={cn(
          "grid size-8 place-items-center rounded-lg bg-muted/60",
          tone,
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="block truncate text-xs text-foreground/75">
          {value}
        </span>
      </span>
    </div>
  );
}
