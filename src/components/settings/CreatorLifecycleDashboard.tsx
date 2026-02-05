/**
 * Creator Lifecycle Dashboard
 *
 * Visualizes the full Create → Verify → Use → Receipts → Rewards → Reputation → Better Create loop.
 * Shows:
 *   - Stage progression pipeline
 *   - Reputation score + tier badge
 *   - Rewards summary
 *   - Usage activity
 *   - Feedback list
 *   - Global stats
 */

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sparkles,
  ShieldCheck,
  Activity,
  Receipt,
  Trophy,
  Star,
  Lightbulb,
  RefreshCw,
  ChevronDown,
  TrendingUp,
  Flame,
  Zap,
  Award,
  BarChart3,
  Users,
  Package,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreatorLifecycle } from "@/hooks/useCreatorLifecycle";
import type { TrustTier } from "@/ipc/lifecycle_client";

// =============================================================================
// CONSTANTS
// =============================================================================

const LIFECYCLE_STAGES = [
  { key: "created", label: "Create", icon: Sparkles, color: "text-blue-500" },
  { key: "verified", label: "Verify", icon: ShieldCheck, color: "text-green-500" },
  { key: "published", label: "Publish", icon: Package, color: "text-purple-500" },
  { key: "inUse", label: "Use", icon: Activity, color: "text-orange-500" },
  { key: "receipted", label: "Receipt", icon: Receipt, color: "text-cyan-500" },
  { key: "rewarded", label: "Reward", icon: Trophy, color: "text-yellow-500" },
] as const;

const TIER_CONFIG: Record<
  TrustTier,
  { label: string; color: string; bg: string; icon: typeof Star }
> = {
  newcomer: {
    label: "Newcomer",
    color: "text-gray-500",
    bg: "bg-gray-500/10",
    icon: Users,
  },
  contributor: {
    label: "Contributor",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    icon: TrendingUp,
  },
  trusted: {
    label: "Trusted",
    color: "text-green-500",
    bg: "bg-green-500/10",
    icon: ShieldCheck,
  },
  verified: {
    label: "Verified",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    icon: Award,
  },
  elite: {
    label: "Elite",
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    icon: Trophy,
  },
};

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

/** Pipeline stage indicator */
function StageIndicator({
  stage,
  active,
  completed,
}: {
  stage: (typeof LIFECYCLE_STAGES)[number];
  active: boolean;
  completed: boolean;
}) {
  const Icon = stage.icon;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all",
          completed
            ? `${stage.color} border-current bg-current/10`
            : active
              ? "border-primary text-primary animate-pulse"
              : "border-muted text-muted-foreground",
        )}
      >
        {completed ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>
      <span
        className={cn(
          "text-xs font-medium",
          completed
            ? stage.color
            : active
              ? "text-primary"
              : "text-muted-foreground",
        )}
      >
        {stage.label}
      </span>
    </div>
  );
}

/** Score bar with label */
function ScoreBar({
  label,
  value,
  max = 1000,
  color = "bg-primary",
}: {
  label: string;
  value: number;
  max?: number;
  color?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

/** Reputation tier badge */
function TierBadge({ tier }: { tier: TrustTier }) {
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 px-2 py-1", config.color, config.bg)}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </Badge>
  );
}

// =============================================================================
// MAIN DASHBOARD
// =============================================================================

export function CreatorLifecycleDashboard() {
  const [actorId, setActorId] = useState("local-user");
  const [assetIdInput, setAssetIdInput] = useState("");
  const [activeAssetId, setActiveAssetId] = useState<string | undefined>();
  const [statsOpen, setStatsOpen] = useState(true);

  const {
    lifecycle,
    lifecycleLoading,
    reputation,
    reputationLoading,
    rewards,
    rewardsLoading,
    feedback,
    feedbackLoading,
    stats,
    statsLoading,
    recomputeReputation,
    autoGenerateFeedback,
    updateStreak,
    refetchAll,
  } = useCreatorLifecycle({
    assetId: activeAssetId,
    actorId,
  });

  function handleLookup() {
    if (assetIdInput.trim()) {
      setActiveAssetId(assetIdInput.trim());
    }
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Zap className="h-5 w-5 text-yellow-500" />
            Creator Lifecycle
          </h2>
          <p className="text-sm text-muted-foreground">
            Create → Verify → Use → Receipts → Rewards → Reputation → Better Create
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchAll()}
          className="gap-1"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Reputation + Rewards Row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Reputation Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Star className="h-4 w-4 text-yellow-500" />
                Reputation
              </CardTitle>
              {reputation && <TierBadge tier={reputation.tier} />}
            </div>
            <CardDescription>
              Your trust score across the network
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reputationLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : reputation ? (
              <div className="space-y-4">
                {/* Overall score */}
                <div className="text-center">
                  <span className="text-4xl font-bold">
                    {reputation.overallScore}
                  </span>
                  <span className="text-muted-foreground"> / 1000</span>
                </div>
                <Progress
                  value={(reputation.overallScore / 1000) * 100}
                  className="h-2"
                />

                {/* Component scores */}
                <div className="space-y-2">
                  <ScoreBar
                    label="Creation"
                    value={reputation.creationScore}
                    color="bg-blue-500"
                  />
                  <ScoreBar
                    label="Verification"
                    value={reputation.verificationScore}
                    color="bg-green-500"
                  />
                  <ScoreBar
                    label="Usage"
                    value={reputation.usageScore}
                    color="bg-orange-500"
                  />
                  <ScoreBar
                    label="Rewards"
                    value={reputation.rewardScore}
                    color="bg-yellow-500"
                  />
                  <ScoreBar
                    label="Consistency"
                    value={reputation.consistencyScore}
                    color="bg-purple-500"
                  />
                </div>

                {/* Streak */}
                {reputation.currentStreak > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-orange-500/10 px-3 py-2 text-sm">
                    <Flame className="h-4 w-4 text-orange-500" />
                    <span className="font-medium">
                      {reputation.currentStreak}-day streak
                    </span>
                    <span className="text-muted-foreground">
                      (best: {reputation.longestStreak})
                    </span>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      recomputeReputation.mutate({ actorId })
                    }
                    disabled={recomputeReputation.isPending}
                  >
                    {recomputeReputation.isPending ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    Recompute
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => updateStreak.mutate({ actorId })}
                    disabled={updateStreak.isPending}
                  >
                    <Flame className="mr-1 h-3 w-3" />
                    Check-in
                  </Button>
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No reputation data yet. Start creating!
              </p>
            )}
          </CardContent>
        </Card>

        {/* Rewards Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-yellow-500" />
              Rewards
            </CardTitle>
            <CardDescription>
              Earned from creating, verifying, and contributing
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rewardsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rewards ? (
              <div className="space-y-4">
                {/* Total rewards by currency */}
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(rewards.total).map(([currency, amount]) => (
                    <div
                      key={currency}
                      className="rounded-lg border p-3 text-center"
                    >
                      <div className="text-2xl font-bold">{amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {currency}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pending */}
                {Object.keys(rewards.pending).length > 0 && (
                  <div className="rounded-lg bg-yellow-500/10 p-3">
                    <div className="mb-1 flex items-center gap-1 text-xs font-medium text-yellow-600">
                      <Clock className="h-3 w-3" />
                      Pending
                    </div>
                    <div className="flex gap-3">
                      {Object.entries(rewards.pending).map(
                        ([currency, amount]) => (
                          <span key={currency} className="text-sm">
                            {amount} {currency}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                )}

                <div className="text-center text-sm text-muted-foreground">
                  {rewards.count} total reward transactions
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No rewards yet. Contribute to earn!
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Asset Lifecycle Lookup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Asset Lifecycle Inspector
          </CardTitle>
          <CardDescription>
            Look up any asset to see its full lifecycle progression
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search */}
          <div className="flex gap-2">
            <Input
              placeholder="Enter asset ID..."
              value={assetIdInput}
              onChange={(e) => setAssetIdInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              className="font-mono text-sm"
            />
            <Button onClick={handleLookup} disabled={!assetIdInput.trim()}>
              Inspect
            </Button>
          </div>

          {/* Lifecycle Pipeline */}
          {lifecycleLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : lifecycle ? (
            <div className="space-y-6">
              {/* Stage pipeline */}
              <div className="flex items-center justify-between px-4">
                {LIFECYCLE_STAGES.map((stage, i) => {
                  const completed =
                    lifecycle.stages[
                      stage.key as keyof typeof lifecycle.stages
                    ];
                  const prevCompleted =
                    i === 0 ||
                    lifecycle.stages[
                      LIFECYCLE_STAGES[i - 1].key as keyof typeof lifecycle.stages
                    ];
                  return (
                    <React.Fragment key={stage.key}>
                      {i > 0 && (
                        <div
                          className={cn(
                            "h-0.5 flex-1",
                            completed
                              ? "bg-primary"
                              : "bg-muted",
                          )}
                        />
                      )}
                      <StageIndicator
                        stage={stage}
                        active={prevCompleted && !completed}
                        completed={completed}
                      />
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-xl font-bold">
                    {lifecycle.usageCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Uses</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-xl font-bold">
                    {lifecycle.verificationCount}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Verifications
                  </div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-xl font-bold">
                    {lifecycle.rewardTotal}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Rewards (pts)
                  </div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-xl font-bold">
                    {lifecycle.feedbackCount}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Feedback
                  </div>
                </div>
              </div>

              {/* Auto-generate feedback */}
              {lifecycle.assetType && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    autoGenerateFeedback.mutate({
                      assetId: lifecycle.assetId,
                      assetType: lifecycle.assetType as
                        | "model"
                        | "dataset"
                        | "agent"
                        | "workflow"
                        | "prompt"
                        | "template"
                        | "plugin"
                        | "api",
                    })
                  }
                  disabled={autoGenerateFeedback.isPending}
                  className="gap-1"
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                  {autoGenerateFeedback.isPending
                    ? "Analyzing..."
                    : "Auto-Generate Feedback"}
                </Button>
              )}

              {/* Recent events */}
              {lifecycle.events.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Recent Events</h4>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {lifecycle.events.slice(0, 10).map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs"
                      >
                        <Badge variant="outline" className="text-xs">
                          {ev.stage}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(ev.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeAssetId ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No lifecycle data for this asset
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Feedback Section */}
      {feedback.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Improvement Feedback
            </CardTitle>
            <CardDescription>
              Suggestions to improve your asset and earn better reputation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {feedback.map((item) => (
                <div
                  key={item.id as string}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {item.title as string}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          (item.priority as string) === "critical" &&
                            "border-red-500 text-red-500",
                          (item.priority as string) === "high" &&
                            "border-orange-500 text-orange-500",
                        )}
                      >
                        {item.priority as string}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {item.feedbackType as string}
                      </Badge>
                    </div>
                    {typeof item.description === "string" &&
                      item.description && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                  </div>
                  {(item.status as string) === "resolved" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Global Stats */}
      <Collapsible open={statsOpen} onOpenChange={setStatsOpen}>
        <CollapsibleTrigger asChild>
          <Card className="cursor-pointer">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4" />
                  Global Lifecycle Stats
                </CardTitle>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    statsOpen && "rotate-180",
                  )}
                />
              </div>
            </CardHeader>
          </Card>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-1 border-t-0 rounded-t-none">
            <CardContent className="pt-4">
              {statsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : stats ? (
                <div className="space-y-4">
                  {/* Top-level counts */}
                  <div className="grid grid-cols-5 gap-3">
                    <div className="rounded-lg border p-3 text-center">
                      <div className="text-xl font-bold">
                        {stats.totalAssets}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Assets
                      </div>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <div className="text-xl font-bold">
                        {stats.totalUsageEvents}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Usage Events
                      </div>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <div className="text-xl font-bold">
                        {stats.totalVerifications}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Verifications
                      </div>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <div className="text-xl font-bold">
                        {stats.totalRewards}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Rewards
                      </div>
                    </div>
                    <div className="rounded-lg border p-3 text-center">
                      <div className="text-xl font-bold">
                        {stats.totalFeedback}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Feedback
                      </div>
                    </div>
                  </div>

                  {/* Stage distribution */}
                  {Object.keys(stats.stageDistribution).length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">
                        Stage Distribution
                      </h4>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(stats.stageDistribution).map(
                          ([stage, count]) => (
                            <div
                              key={stage}
                              className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs"
                            >
                              <span className="capitalize">{stage}</span>
                              <span className="font-mono font-bold">
                                {count}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  )}

                  {/* Recent activity */}
                  {stats.recentActivity.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Recent Activity</h4>
                      <div className="max-h-40 space-y-1 overflow-y-auto">
                        {stats.recentActivity.map((ev) => (
                          <div
                            key={ev.id}
                            className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {ev.stage}
                              </Badge>
                              <span className="font-mono text-muted-foreground">
                                {ev.assetId.slice(0, 8)}…
                              </span>
                            </div>
                            <span className="text-muted-foreground">
                              {new Date(ev.createdAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No lifecycle data yet
                </p>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default CreatorLifecycleDashboard;
