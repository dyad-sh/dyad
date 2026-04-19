/**
 * Tokenomics Dashboard — The Economic Heart of Sovereign AI
 *
 * Tabs: Overview, Staking, Rewards & Earnings, Billing, Vesting, Fee Config
 * Shows network-wide stats, personal earnings, staking positions, billing.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Coins,
  TrendingUp,
  Shield,
  Wallet,
  Clock,
  BarChart3,
  Zap,
  Users,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Settings,
  PiggyBank,
  CreditCard,
  Gift,
  Flame,
  Star,
  Award,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Plus,
  ExternalLink,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface TokenomicsStats {
  totalStaked: string;
  totalRewardsDistributed: string;
  totalBurned: string;
  totalFeesCollected: string;
  activeStakers: number;
  activeRewardRecipients: number;
  currentAPY: Record<string, number>;
  dailyRewardsRate: string;
}

interface StakePosition {
  id: string;
  stakerId: string;
  stakeType: string;
  amount: string;
  currency: string;
  status: string;
  accumulatedRewards: string;
  rewardRate: number;
  createdAt: number;
}

interface EarningsSummary {
  totalEarnings: string;
  pendingRewards: string;
  claimableRewards: string;
  bySource: Record<string, string>;
}

interface RewardRule {
  id: string;
  trigger: string;
  amount: string;
  currency: string;
  multiplier: number;
  maxPerDay: number;
  enabled: boolean;
  description: string;
}

// ── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "staking", label: "Staking", icon: Lock },
  { id: "earnings", label: "Earnings", icon: DollarSign },
  { id: "reputation", label: "Reputation", icon: Star },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "config", label: "Fee Config", icon: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

const invoke = window.electron?.ipcRenderer?.invoke;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatJOY(wei: string): string {
  const n = Number(BigInt(wei || "0")) / 1e6;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M JOY`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K JOY`;
  return `${n.toFixed(0)} JOY`;
}

function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

const STAKE_TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  compute_provider: { label: "Compute Provider", icon: Zap, color: "text-blue-500" },
  validator: { label: "Validator", icon: Shield, color: "text-purple-500" },
  creator: { label: "Creator", icon: Gift, color: "text-green-500" },
  curator: { label: "Curator", icon: Star, color: "text-yellow-500" },
  governance: { label: "Governance", icon: Users, color: "text-pink-500" },
};

const TIER_COLORS: Record<string, string> = {
  newcomer: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  contributor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  trusted: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  verified: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  elite: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
};

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, subValue, icon: Icon, color, trend }: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  color: string;
  trend?: "up" | "down";
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <div className="flex items-end gap-2">
        <span className="text-xl font-bold">{value}</span>
        {trend && (
          <span className={cn("text-xs flex items-center", trend === "up" ? "text-green-500" : "text-red-500")}>
            {trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          </span>
        )}
      </div>
      {subValue && <span className="text-xs text-muted-foreground">{subValue}</span>}
    </div>
  );
}

// ── OverviewTab ──────────────────────────────────────────────────────────────

function OverviewTab({ stats, loading }: { stats: TokenomicsStats | null; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (!stats) return <EmptyState message="No tokenomics data yet" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Staked" value={formatJOY(stats.totalStaked)} icon={Lock} color="text-blue-500" trend="up" />
        <StatCard label="Total Rewards" value={formatJOY(stats.totalRewardsDistributed)} icon={Gift} color="text-green-500" trend="up" />
        <StatCard label="Total Burned" value={formatJOY(stats.totalBurned)} icon={Flame} color="text-orange-500" />
        <StatCard label="Active Stakers" value={stats.activeStakers.toString()} icon={Users} color="text-purple-500" />
      </div>

      {/* APY Rates */}
      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-500" /> Current APY Rates
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(stats.currentAPY).map(([type, bps]) => {
            const meta = STAKE_TYPE_META[type];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <div key={type} className="rounded-lg bg-muted/50 p-3 text-center">
                <Icon className={cn("h-5 w-5 mx-auto mb-1", meta.color)} />
                <div className="text-lg font-bold text-green-600 dark:text-green-400">{bpsToPercent(bps)}</div>
                <div className="text-xs text-muted-foreground">{meta.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Revenue Split */}
      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-purple-500" /> Revenue Split Model
        </h3>
        <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
          <div className="bg-green-500 flex items-center justify-center text-xs font-bold text-white" style={{ width: "70%" }}>70% Creator</div>
          <div className="bg-blue-500 flex items-center justify-center text-xs font-bold text-white" style={{ width: "15%" }}>15%</div>
          <div className="bg-purple-500 flex items-center justify-center text-xs font-bold text-white" style={{ width: "5%" }}>5%</div>
          <div className="bg-gray-500 flex items-center justify-center text-xs font-bold text-white" style={{ width: "5%" }}>5%</div>
          <div className="bg-orange-500 flex items-center justify-center text-xs font-bold text-white" style={{ width: "5%" }}>5%</div>
        </div>
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Creator</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Compute</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> Validator</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" /> Platform</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> Burn</span>
        </div>
      </div>
    </div>
  );
}

// ── StakingTab ───────────────────────────────────────────────────────────────

function StakingTab() {
  const [stakes, setStakes] = useState<StakePosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<string>("creator");
  const [createAmount, setCreateAmount] = useState("");

  useEffect(() => {
    loadStakes();
  }, []);

  const loadStakes = async () => {
    setLoading(true);
    try {
      const result = await invoke("tokenomics:get-stakes");
      setStakes(result ?? []);
    } catch { setStakes([]); }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!createAmount) return;
    try {
      await invoke("tokenomics:create-stake", "local-user", createType, createAmount, "JOY");
      setShowCreate(false);
      setCreateAmount("");
      loadStakes();
    } catch (err) {
      console.error("Create stake failed:", err);
    }
  };

  const handleUnstake = async (id: string) => {
    try {
      await invoke("tokenomics:unstake", id);
      loadStakes();
    } catch (err) { console.error(err); }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Your Staking Positions</h3>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-1" /> New Stake
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h4 className="text-sm font-medium">Create New Stake</h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(STAKE_TYPE_META).map(([key, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={key}
                  onClick={() => setCreateType(key)}
                  className={cn(
                    "rounded-lg p-3 text-center border-2 transition-all",
                    createType === key ? "border-primary bg-primary/10" : "border-transparent bg-muted/50 hover:bg-muted",
                  )}
                >
                  <Icon className={cn("h-5 w-5 mx-auto mb-1", meta.color)} />
                  <div className="text-xs font-medium">{meta.label}</div>
                  <div className="text-xs text-muted-foreground">{bpsToPercent(STAKE_TYPE_META[key] ? 1200 : 500)} APY</div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Amount (JOY)"
              value={createAmount}
              onChange={(e) => setCreateAmount(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm"
            />
            <Button onClick={handleCreate} disabled={!createAmount}>
              <Lock className="h-4 w-4 mr-1" /> Stake
            </Button>
          </div>
        </div>
      )}

      {stakes.length === 0 ? (
        <EmptyState message="No staking positions yet. Stake tokens to earn rewards and secure the network." />
      ) : (
        <div className="space-y-3">
          {stakes.map((stake) => {
            const meta = STAKE_TYPE_META[stake.stakeType] ?? { label: stake.stakeType, icon: Coins, color: "text-gray-500" };
            const Icon = meta.icon;
            return (
              <div key={stake.id} className="rounded-xl border bg-card p-4 flex items-center gap-4">
                <div className={cn("p-2 rounded-lg bg-muted/50")}>
                  <Icon className={cn("h-6 w-6", meta.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{meta.label}</span>
                    <Badge variant={stake.status === "active" ? "default" : "secondary"} className="text-xs">
                      {stake.status}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatJOY(stake.amount)} staked • {bpsToPercent(stake.rewardRate)} APY
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-green-600">{formatJOY(stake.accumulatedRewards)}</div>
                  <div className="text-xs text-muted-foreground">earned</div>
                </div>
                {stake.status === "active" && (
                  <Button size="sm" variant="outline" onClick={() => handleUnstake(stake.id)}>
                    <Unlock className="h-3 w-3 mr-1" /> Unstake
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── EarningsTab ──────────────────────────────────────────────────────────────

function EarningsTab() {
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [period, setPeriod] = useState<string>("all_time");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEarnings();
  }, [period]);

  const loadEarnings = async () => {
    setLoading(true);
    try {
      const result = await invoke("tokenomics:get-earnings", "local-user", period);
      setEarnings(result);
    } catch { setEarnings(null); }
    setLoading(false);
  };

  if (loading) return <LoadingState />;
  if (!earnings) return <EmptyState message="No earnings yet. Create assets and share them to start earning." />;

  const sourceEntries = Object.entries(earnings.bySource).filter(([, v]) => v !== "0");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {["daily", "weekly", "monthly", "all_time"].map((p) => (
          <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
            {p === "all_time" ? "All Time" : p.charAt(0).toUpperCase() + p.slice(1)}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Earnings" value={formatJOY(earnings.totalEarnings)} icon={DollarSign} color="text-green-500" />
        <StatCard label="Pending" value={formatJOY(earnings.pendingRewards)} icon={Clock} color="text-yellow-500" />
        <StatCard label="Claimable" value={formatJOY(earnings.claimableRewards)} icon={CheckCircle} color="text-blue-500" />
      </div>

      {sourceEntries.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3">Earnings by Source</h3>
          <div className="space-y-2">
            {sourceEntries.map(([source, amount]) => (
              <div key={source} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <span className="text-sm font-medium capitalize">{source.replace(/_/g, " ")}</span>
                <span className="text-sm font-bold text-green-600">{formatJOY(amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ReputationTab ────────────────────────────────────────────────────────────

function ReputationTab() {
  const [rep, setRep] = useState<{ overallScore: number; tier: string; scores: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await invoke("tokenomics:get-reputation", "local-user");
        setRep(result);
      } catch { setRep(null); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingState />;
  if (!rep) return <EmptyState message="No reputation yet. Start creating and contributing to build your score." />;

  const tierColor = TIER_COLORS[rep.tier] ?? TIER_COLORS.newcomer;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 text-center">
        <div className="inline-flex items-center gap-2 mb-3">
          <Award className="h-8 w-8 text-yellow-500" />
          <span className="text-4xl font-bold">{rep.overallScore}</span>
          <span className="text-sm text-muted-foreground">/ 1000</span>
        </div>
        <div>
          <Badge className={cn("text-sm px-3 py-1", tierColor)}>{rep.tier.toUpperCase()}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {rep.tier === "elite" ? "Top-tier contributor! Maximum reward multiplier (2x)." :
           rep.tier === "verified" ? "Verified contributor. Reward multiplier: 1.5x" :
           rep.tier === "trusted" ? "Trusted member. Reward multiplier: 1.25x" :
           rep.tier === "contributor" ? "Active contributor. Reward multiplier: 1.1x" :
           "Welcome! Start contributing to level up and earn more."}
        </p>
      </div>

      {/* Component scores */}
      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-semibold mb-4">Score Breakdown</h3>
        <div className="space-y-3">
          {Object.entries(rep.scores).map(([key, value]) => (
            <div key={key}>
              <div className="flex justify-between text-sm mb-1">
                <span className="capitalize">{key}</span>
                <span className="font-medium">{value} / 1000</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all"
                  style={{ width: `${(value / 1000) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tier progression */}
      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-semibold mb-4">Tier Progression</h3>
        <div className="flex items-center gap-1">
          {["newcomer", "contributor", "trusted", "verified", "elite"].map((tier, i) => {
            const isActive = ["newcomer", "contributor", "trusted", "verified", "elite"].indexOf(rep.tier) >= i;
            return (
              <React.Fragment key={tier}>
                <div className={cn(
                  "flex-1 h-3 rounded-full transition-all",
                  isActive ? "bg-gradient-to-r from-blue-500 to-purple-500" : "bg-muted",
                )} />
                {i < 4 && <div className="w-1" />}
              </React.Fragment>
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>Newcomer</span>
          <span>Contributor</span>
          <span>Trusted</span>
          <span>Verified</span>
          <span>Elite</span>
        </div>
      </div>
    </div>
  );
}

// ── BillingTab ───────────────────────────────────────────────────────────────

function BillingTab() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await invoke("tokenomics:get-billing-accounts");
        setAccounts(result ?? []);
      } catch { setAccounts([]); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Billing Accounts</h3>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState message="No billing accounts. Create one to start using the API marketplace." />
      ) : (
        <div className="space-y-3">
          {accounts.map((acct: any) => (
            <div key={acct.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{acct.walletAddress?.slice(0, 10)}...</span>
                  <Badge variant={acct.status === "active" ? "default" : "destructive"} className="ml-2 text-xs">{acct.status}</Badge>
                </div>
                <span className="text-lg font-bold">{formatJOY(acct.creditBalance)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ConfigTab ────────────────────────────────────────────────────────────────

function ConfigTab() {
  const [rules, setRules] = useState<RewardRule[]>([]);
  const [feeSchedule, setFeeSchedule] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, f] = await Promise.all([
          invoke("tokenomics:get-reward-rules"),
          invoke("tokenomics:get-fee-schedule"),
        ]);
        setRules(r ?? []);
        setFeeSchedule(f);
      } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {feeSchedule && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Settings className="h-4 w-4" /> Fee Schedule
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">Marketplace Fee</div>
              <div className="font-bold">{bpsToPercent(feeSchedule.marketplaceSaleFee)}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">Creator Share</div>
              <div className="font-bold text-green-600">{bpsToPercent(feeSchedule.creatorShare)}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">Compute Share</div>
              <div className="font-bold text-blue-600">{bpsToPercent(feeSchedule.computeProviderShare)}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">Validator Share</div>
              <div className="font-bold text-purple-600">{bpsToPercent(feeSchedule.validatorShare)}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">Platform Share</div>
              <div className="font-bold">{bpsToPercent(feeSchedule.platformShare)}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="text-xs text-muted-foreground">Burn Rate</div>
              <div className="font-bold text-orange-600">{bpsToPercent(feeSchedule.burnShare)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-semibold mb-3">Reward Rules ({rules.length})</h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
              <div>
                <span className="text-sm font-medium capitalize">{rule.trigger.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground ml-2">— {rule.description}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{formatJOY(rule.amount)}</span>
                <Badge variant={rule.enabled ? "default" : "secondary"} className="text-xs">
                  {rule.enabled ? "Active" : "Off"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared components ────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-16">
      <Coins className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TokenomicsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [stats, setStats] = useState<TokenomicsStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await invoke("tokenomics:get-stats");
        setStats(result);
      } catch {}
      setLoading(false);
    })();
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-600">
            <Coins className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Token Economics</h1>
            <p className="text-sm text-muted-foreground">Staking, rewards, reputation, and the economic engine of Sovereign AI</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b px-6">
        <div className="flex gap-1 -mb-px">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "overview" && <OverviewTab stats={stats} loading={loading} />}
        {activeTab === "staking" && <StakingTab />}
        {activeTab === "earnings" && <EarningsTab />}
        {activeTab === "reputation" && <ReputationTab />}
        {activeTab === "billing" && <BillingTab />}
        {activeTab === "config" && <ConfigTab />}
      </div>
    </div>
  );
}
