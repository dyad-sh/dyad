/**
 * DAO Governance Page — By the People, For the People
 *
 * Tabs: Overview, Proposals, Voting, Delegation, Treasury
 * Full governance lifecycle: propose, discuss, vote, execute.
 */

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Landmark,
  Vote,
  FileText,
  Users,
  Wallet,
  Plus,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Shield,
  BarChart3,
  Loader2,
  ArrowRight,
  Scale,
  Gavel,
  PiggyBank,
  Send,
  Eye,
  TrendingUp,
  Star,
  MessageSquare,
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Lock,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Proposal {
  id: string;
  title: string;
  summary: string;
  description: string;
  proposalType: string;
  proposerId: string;
  proposerName?: string;
  votingStartsAt: number;
  votingEndsAt: number;
  quorumRequired: number;
  approvalThreshold: number;
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
  totalVoters: number;
  quorumReached: boolean;
  executionPayload?: any;
  status: string;
  commentCount: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

interface VotingPower {
  userId: string;
  ownStake: string;
  delegatedToMe: string;
  totalPower: string;
  delegatedToOthers: string;
  effectivePower: string;
  votesParticipated: number;
  proposalsCreated: number;
}

interface GovernanceStats {
  totalProposals: number;
  activeProposals: number;
  passedProposals: number;
  rejectedProposals: number;
  executedProposals: number;
  totalVotesCast: number;
  uniqueVoters: number;
  avgTurnoutPercent: number;
  totalDelegations: number;
  treasuryValue: string;
}

interface TreasuryStats {
  totalValue: string;
  balances: { currency: string; balance: string; network: string }[];
  totalInflow30d: string;
  totalOutflow30d: string;
  netFlow30d: string;
  recentTransactions: any[];
}

interface Delegation {
  id: string;
  delegatorId: string;
  delegateId: string;
  scope: string;
  amount: string;
  active: boolean;
  createdAt: number;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview", icon: Landmark },
  { id: "proposals", label: "Proposals", icon: FileText },
  { id: "voting", label: "My Votes", icon: Vote },
  { id: "delegation", label: "Delegation", icon: Users },
  { id: "treasury", label: "Treasury", icon: Wallet },
] as const;

type TabId = (typeof TABS)[number]["id"];

const invoke = window.electron?.ipcRenderer?.invoke;

const PROPOSAL_TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  parameter_change: { label: "Parameter Change", icon: Zap, color: "text-blue-500" },
  treasury_spend: { label: "Treasury Spend", icon: Wallet, color: "text-green-500" },
  grant: { label: "Grant", icon: PiggyBank, color: "text-yellow-500" },
  upgrade: { label: "Platform Upgrade", icon: TrendingUp, color: "text-purple-500" },
  policy: { label: "Policy Change", icon: FileText, color: "text-orange-500" },
  model_approval: { label: "Model Approval", icon: Star, color: "text-pink-500" },
  slash_appeal: { label: "Slash Appeal", icon: Shield, color: "text-red-500" },
  agent_certification: { label: "Agent Certification", icon: CheckCircle, color: "text-cyan-500" },
  feature_request: { label: "Feature Request", icon: MessageSquare, color: "text-indigo-500" },
  emergency: { label: "Emergency", icon: AlertTriangle, color: "text-red-600" },
  general: { label: "General", icon: Landmark, color: "text-gray-500" },
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  pending_review: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  active: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  passed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  executed: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  expired: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  cancelled: "bg-gray-100 text-gray-500",
  vetoed: "bg-red-100 text-red-700",
};

function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function formatJOY(wei: string): string {
  const n = Number(BigInt(wei || "0")) / 1e6;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function timeRemaining(endMs: number): string {
  const diff = endMs - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m left`;
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

// ── OverviewTab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const [stats, setStats] = useState<GovernanceStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setStats(await invoke("governance:get-stats")); } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingState />;
  if (!stats) return <EmptyState msg="No governance data yet." />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <StatCard label="Total Proposals" value={stats.totalProposals.toString()} icon={FileText} color="text-blue-500" />
        <StatCard label="Active Votes" value={stats.activeProposals.toString()} icon={Vote} color="text-green-500" />
        <StatCard label="Executed" value={stats.executedProposals.toString()} icon={Gavel} color="text-purple-500" />
        <StatCard label="Unique Voters" value={stats.uniqueVoters.toString()} icon={Users} color="text-orange-500" />
        <StatCard label="Treasury" value={`${formatJOY(stats.treasuryValue)} JOY`} icon={PiggyBank} color="text-yellow-500" />
      </div>

      {/* Governance principles */}
      <div className="rounded-xl border bg-gradient-to-br from-purple-500/5 to-pink-500/5 p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Landmark className="h-5 w-5 text-purple-500" />
          Sovereign AI Governance
        </h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-card border">
            <Scale className="h-6 w-6 text-blue-500 mb-2" />
            <h4 className="font-medium text-sm">Token-Weighted Voting</h4>
            <p className="text-xs text-muted-foreground mt-1">Your voting power scales with your stake. More skin in the game = more say.</p>
          </div>
          <div className="p-4 rounded-lg bg-card border">
            <Users className="h-6 w-6 text-green-500 mb-2" />
            <h4 className="font-medium text-sm">Delegation</h4>
            <p className="text-xs text-muted-foreground mt-1">Delegate your votes to experts. Revoke anytime. Stay in control.</p>
          </div>
          <div className="p-4 rounded-lg bg-card border">
            <Lock className="h-6 w-6 text-purple-500 mb-2" />
            <h4 className="font-medium text-sm">Timelock Execution</h4>
            <p className="text-xs text-muted-foreground mt-1">Passed proposals wait before executing. Time to review and react.</p>
          </div>
        </div>
      </div>

      {/* Recent proposals preview */}
      {stats.recentProposals && stats.recentProposals.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3">Recent Proposals</h3>
          <div className="space-y-2">
            {(stats.recentProposals as Proposal[]).slice(0, 5).map((p) => (
              <ProposalRow key={p.id} proposal={p} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ProposalsTab ─────────────────────────────────────────────────────────────

function ProposalsTab() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [propType, setPropType] = useState<string>("general");

  useEffect(() => { loadProposals(); }, [filter]);

  const loadProposals = async () => {
    setLoading(true);
    try {
      const filters: Record<string, unknown> = {};
      if (filter !== "all") filters.status = filter;
      const result = await invoke("governance:list-proposals", filters);
      setProposals(result?.proposals ?? []);
    } catch { setProposals([]); }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!title || !summary || !description) return;
    try {
      await invoke("governance:create-proposal", {
        title,
        summary,
        description,
        proposalType: propType,
        proposerId: "local-user",
        proposerName: "Creator",
        tags: [propType],
      });
      setShowCreate(false);
      setTitle("");
      setSummary("");
      setDescription("");
      loadProposals();
    } catch (err) { console.error(err); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 flex-wrap">
          {["all", "active", "pending_review", "passed", "executed", "rejected"].map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "pending_review" ? "Review" : f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-1" /> New Proposal
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h4 className="font-semibold">Create Proposal</h4>

          <div className="flex gap-2 flex-wrap">
            {Object.entries(PROPOSAL_TYPE_META).map(([key, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={key}
                  onClick={() => setPropType(key)}
                  className={cn(
                    "flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-all",
                    propType === key ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/20",
                  )}
                >
                  <Icon className={cn("h-3 w-3", meta.color)} />
                  {meta.label}
                </button>
              );
            })}
          </div>

          <input
            type="text"
            placeholder="Proposal title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <input
            type="text"
            placeholder="One-line summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <textarea
            placeholder="Full description (supports markdown)..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm h-32 resize-y"
          />
          <Button onClick={handleCreate} disabled={!title || !summary || !description}>
            <Send className="h-4 w-4 mr-1" /> Submit Proposal
          </Button>
        </div>
      )}

      {loading ? <LoadingState /> : proposals.length === 0 ? (
        <EmptyState msg="No proposals yet. Be the first to shape the platform's future." />
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => <ProposalRow key={p.id} proposal={p} />)}
        </div>
      )}
    </div>
  );
}

// ── ProposalRow ──────────────────────────────────────────────────────────────

function ProposalRow({ proposal: p, compact }: { proposal: Proposal; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [voting, setVoting] = useState(false);

  const meta = PROPOSAL_TYPE_META[p.proposalType] ?? PROPOSAL_TYPE_META.general;
  const Icon = meta.icon;
  const statusColor = STATUS_COLORS[p.status] ?? STATUS_COLORS.draft;

  const totalDecisive = BigInt(p.votesFor || "0") + BigInt(p.votesAgainst || "0");
  const forPct = totalDecisive > 0 ? Number((BigInt(p.votesFor || "0") * BigInt(100)) / totalDecisive) : 0;
  const againstPct = totalDecisive > 0 ? 100 - forPct : 0;

  const handleVote = async (choice: string) => {
    setVoting(true);
    try {
      await invoke("governance:cast-vote", {
        proposalId: p.id,
        voterId: "local-user",
        voterName: "Creator",
        choice,
      });
    } catch (err) { console.error(err); }
    setVoting(false);
  };

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="p-4 cursor-pointer" onClick={() => !compact && setExpanded(!expanded)}>
        <div className="flex items-start gap-3">
          <Icon className={cn("h-5 w-5 mt-0.5", meta.color)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{p.title}</span>
              <Badge className={cn("text-xs", statusColor)}>{p.status.replace(/_/g, " ")}</Badge>
              <Badge variant="outline" className="text-xs">{meta.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{p.summary}</p>

            {/* Vote bar */}
            {p.totalVoters > 0 && (
              <div className="mt-2">
                <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
                  <div className="bg-green-500 transition-all" style={{ width: `${forPct}%` }} />
                  <div className="bg-red-500 transition-all" style={{ width: `${againstPct}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span className="text-green-600">{forPct}% For</span>
                  <span>{p.totalVoters} voters</span>
                  <span className="text-red-600">{againstPct}% Against</span>
                </div>
              </div>
            )}
          </div>

          <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
            {p.status === "active" ? (
              <span className="text-blue-600 font-medium">{timeRemaining(p.votingEndsAt)}</span>
            ) : (
              new Date(p.createdAt).toLocaleDateString()
            )}
          </div>

          {!compact && (expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-4 bg-muted/20">
          {/* Full description */}
          <div className="text-sm whitespace-pre-wrap">{p.description}</div>

          {/* Vote buttons */}
          {p.status === "active" && (
            <div className="flex gap-2">
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={voting} onClick={() => handleVote("for")}>
                <ThumbsUp className="h-4 w-4 mr-1" /> Vote For
              </Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={voting} onClick={() => handleVote("against")}>
                <ThumbsDown className="h-4 w-4 mr-1" /> Vote Against
              </Button>
              <Button size="sm" variant="outline" disabled={voting} onClick={() => handleVote("abstain")}>
                <Minus className="h-4 w-4 mr-1" /> Abstain
              </Button>
            </div>
          )}

          {/* Execution info */}
          {p.status === "passed" && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500 inline mr-1" />
              This proposal passed. Awaiting execution after timelock period.
            </div>
          )}

          {/* Meta */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Proposer: {p.proposerName ?? p.proposerId.slice(0, 12) + "..."}</span>
            <span>Quorum: {bpsToPercent(p.quorumRequired)}</span>
            <span>Threshold: {bpsToPercent(p.approvalThreshold)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── VotingTab ────────────────────────────────────────────────────────────────

function VotingTab() {
  const [power, setPower] = useState<VotingPower | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setPower(await invoke("governance:get-voting-power", "local-user")); } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingState />;
  if (!power) return <EmptyState msg="No voting power yet. Stake tokens to participate in governance." />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Own Stake" value={formatJOY(power.ownStake)} icon={Lock} color="text-blue-500" />
        <StatCard label="Delegated to Me" value={formatJOY(power.delegatedToMe)} icon={Users} color="text-green-500" />
        <StatCard label="Effective Power" value={formatJOY(power.effectivePower)} icon={Zap} color="text-purple-500" />
        <StatCard label="Votes Cast" value={power.votesParticipated.toString()} icon={Vote} color="text-orange-500" />
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-semibold mb-3">Voting Power Breakdown</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
            <span className="text-sm">Your Staked Tokens</span>
            <span className="font-bold">{formatJOY(power.ownStake)} JOY</span>
          </div>
          <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
            <span className="text-sm">+ Delegated to You</span>
            <span className="font-bold text-green-600">+{formatJOY(power.delegatedToMe)} JOY</span>
          </div>
          <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
            <span className="text-sm">- Delegated to Others</span>
            <span className="font-bold text-red-600">-{formatJOY(power.delegatedToOthers)} JOY</span>
          </div>
          <div className="flex justify-between items-center p-3 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-sm font-semibold">= Effective Voting Power</span>
            <span className="font-bold text-lg">{formatJOY(power.effectivePower)} JOY</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DelegationTab ────────────────────────────────────────────────────────────

function DelegationTab() {
  const [delegations, setDelegations] = useState<{ delegated: Delegation[]; received: Delegation[] }>({ delegated: [], received: [] });
  const [loading, setLoading] = useState(true);
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegateTo, setDelegateTo] = useState("");
  const [delegateAmount, setDelegateAmount] = useState("");

  useEffect(() => { loadDelegations(); }, []);

  const loadDelegations = async () => {
    setLoading(true);
    try { setDelegations(await invoke("governance:get-delegations", "local-user")); } catch {}
    setLoading(false);
  };

  const handleDelegate = async () => {
    if (!delegateTo || !delegateAmount) return;
    try {
      await invoke("governance:delegate", {
        delegatorId: "local-user",
        delegateId: delegateTo,
        amount: delegateAmount,
      });
      setShowDelegate(false);
      loadDelegations();
    } catch (err) { console.error(err); }
  };

  const handleRevoke = async (id: string) => {
    try {
      await invoke("governance:revoke-delegation", id, "local-user");
      loadDelegations();
    } catch (err) { console.error(err); }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Delegation</h3>
        <Button size="sm" onClick={() => setShowDelegate(!showDelegate)}>
          <Plus className="h-4 w-4 mr-1" /> Delegate
        </Button>
      </div>

      {showDelegate && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h4 className="text-sm font-medium">Delegate Voting Power</h4>
          <input
            type="text"
            placeholder="Delegate's DID or wallet address"
            value={delegateTo}
            onChange={(e) => setDelegateTo(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <input
            type="text"
            placeholder="Amount to delegate"
            value={delegateAmount}
            onChange={(e) => setDelegateAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <Button onClick={handleDelegate} disabled={!delegateTo || !delegateAmount}>
            <Send className="h-4 w-4 mr-1" /> Delegate
          </Button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-semibold mb-3">Delegated by You</h4>
          {delegations.delegated.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outgoing delegations.</p>
          ) : (
            <div className="space-y-2">
              {delegations.delegated.map((d) => (
                <div key={d.id} className="p-3 rounded-lg border bg-card flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">To: {d.delegateId.slice(0, 16)}...</span>
                    <div className="text-xs text-muted-foreground">{formatJOY(d.amount)} JOY</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleRevoke(d.id)}>Revoke</Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-3">Delegated to You</h4>
          {delegations.received.length === 0 ? (
            <p className="text-sm text-muted-foreground">No incoming delegations.</p>
          ) : (
            <div className="space-y-2">
              {delegations.received.map((d) => (
                <div key={d.id} className="p-3 rounded-lg border bg-card">
                  <span className="text-sm font-medium">From: {d.delegatorId.slice(0, 16)}...</span>
                  <div className="text-xs text-muted-foreground">{formatJOY(d.amount)} JOY</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TreasuryTab ──────────────────────────────────────────────────────────────

function TreasuryTab() {
  const [treasury, setTreasury] = useState<TreasuryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setTreasury(await invoke("governance:get-treasury-stats")); } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingState />;
  if (!treasury) return <EmptyState msg="Treasury data loading..." />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Value" value={`${formatJOY(treasury.totalValue)} JOY`} icon={PiggyBank} color="text-yellow-500" />
        <StatCard label="Inflow (30d)" value={`+${formatJOY(treasury.totalInflow30d)}`} icon={TrendingUp} color="text-green-500" />
        <StatCard label="Outflow (30d)" value={`-${formatJOY(treasury.totalOutflow30d)}`} icon={Wallet} color="text-red-500" />
        <StatCard
          label="Net Flow"
          value={`${BigInt(treasury.netFlow30d) >= 0 ? "+" : ""}${formatJOY(treasury.netFlow30d)}`}
          icon={BarChart3}
          color={BigInt(treasury.netFlow30d) >= 0 ? "text-green-500" : "text-red-500"}
        />
      </div>

      {/* Balances */}
      {treasury.balances.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3">Token Balances</h3>
          <div className="space-y-2">
            {treasury.balances.map((b) => (
              <div key={b.currency} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{b.currency}</span>
                  <Badge variant="outline" className="text-xs">{b.network}</Badge>
                </div>
                <span className="text-lg font-bold">{formatJOY(b.balance)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {treasury.recentTransactions.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3">Recent Transactions</h3>
          <div className="space-y-2">
            {treasury.recentTransactions.map((txn: any) => (
              <div key={txn.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={txn.type === "deposit" || txn.type === "fee_collection" ? "default" : "destructive"} className="text-xs">
                    {txn.type}
                  </Badge>
                  <span className="text-muted-foreground">{txn.description}</span>
                </div>
                <span className={cn("font-medium", txn.type === "deposit" || txn.type === "fee_collection" ? "text-green-600" : "text-red-600")}>
                  {txn.type === "deposit" || txn.type === "fee_collection" ? "+" : "-"}{formatJOY(txn.amount)} {txn.currency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────

function LoadingState() {
  return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="text-center py-16">
      <Landmark className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-muted-foreground">{msg}</p>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function GovernancePage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600">
            <Landmark className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">DAO Governance</h1>
            <p className="text-sm text-muted-foreground">Community-driven decisions. Propose, vote, delegate, and shape the future of Sovereign AI.</p>
          </div>
        </div>
      </div>

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
                  activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "proposals" && <ProposalsTab />}
        {activeTab === "voting" && <VotingTab />}
        {activeTab === "delegation" && <DelegationTab />}
        {activeTab === "treasury" && <TreasuryTab />}
      </div>
    </div>
  );
}
