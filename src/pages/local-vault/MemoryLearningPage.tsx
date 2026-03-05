// =============================================================================
// Memory & Learning Page — Multi-Armed Bandit dashboard
// View arms, reward history, stats, and manage learning configs
// =============================================================================

import { useState, useCallback } from "react";
import {
  useMABArms,
  useMABStats,
  useRecentRewardEvents,
  useRewardHistory,
  useCreateArm,
  useDeleteArm,
  useResetArm,
  useRecordReward,
  useSelectArm,
  useApplyDecay,
  useMABContextKeys,
} from "../../hooks/useMABLearning";
import type { MABArm, MABDomain, MABRewardEvent } from "../../types/mab_types";
import { VaultNav, VaultLockGate } from "./VaultNav";
import {
  Brain,
  Plus,
  Trash2,
  RotateCcw,
  Zap,
  TrendingUp,
  Target,
  BarChart3,
  Clock,
  X,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  RefreshCw,
  Activity,
  Layers,
  AlertTriangle,
  Shield,
  History,
} from "lucide-react";

// ---- Domain config ----
const DOMAIN_OPTIONS: Array<{ value: MABDomain; label: string; color: string }> = [
  { value: "model_selection", label: "Model Selection", color: "text-blue-500" },
  { value: "connector_strategy", label: "Connector Strategy", color: "text-green-500" },
  { value: "transform_pipeline", label: "Transform Pipeline", color: "text-purple-500" },
  { value: "prompt_template", label: "Prompt Template", color: "text-orange-500" },
  { value: "ui_layout", label: "UI Layout", color: "text-pink-500" },
  { value: "response_style", label: "Response Style", color: "text-cyan-500" },
  { value: "tool_selection", label: "Tool Selection", color: "text-yellow-500" },
  { value: "workflow_routing", label: "Workflow Routing", color: "text-emerald-500" },
  { value: "custom", label: "Custom", color: "text-gray-500" },
];

function domainLabel(d: MABDomain): string {
  return DOMAIN_OPTIONS.find((o) => o.value === d)?.label ?? d;
}

function domainColor(d: MABDomain): string {
  return DOMAIN_OPTIONS.find((o) => o.value === d)?.color ?? "text-muted-foreground";
}

// ---- Main page ----

export default function MemoryLearningPage() {
  const { data: arms = [], isLoading: armsLoading } = useMABArms();
  const { data: stats } = useMABStats();
  const { data: recentEvents = [] } = useRecentRewardEvents();
  const { data: contextKeys = [] } = useMABContextKeys();

  const createArm = useCreateArm();
  const deleteArm = useDeleteArm();
  const resetArm = useResetArm();
  const recordReward = useRecordReward();
  const selectArm = useSelectArm();
  const applyDecay = useApplyDecay();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedArm, setSelectedArm] = useState<MABArm | null>(null);
  const [filterDomain, setFilterDomain] = useState<MABDomain | "">("");
  const [filterContext, setFilterContext] = useState("");

  // Confirmation state
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete" | "reset";
    armId: string;
    armName: string;
  } | null>(null);

  // ---- New Arm Form State ----
  const [newDomain, setNewDomain] = useState<MABDomain>("model_selection");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newContextKey, setNewContextKey] = useState("");

  const handleCreateArm = () => {
    if (!newName || !newContextKey) return;
    createArm.mutate({
      domain: newDomain,
      name: newName,
      description: newDescription || undefined,
      contextKey: newContextKey,
    });
    setShowAddDialog(false);
    setNewName("");
    setNewDescription("");
    setNewContextKey("");
  };

  // ---- Quick reward buttons ----
  const handleQuickReward = (armId: string, reward: number) => {
    recordReward.mutate({
      armId,
      reward,
      source: "user",
      feedback: reward >= 0.7 ? "User thumbs up" : "User thumbs down",
    });
  };

  // ---- Confirmed destructive actions ----
  const handleConfirmedAction = useCallback(() => {
    if (!confirmAction) return;
    if (confirmAction.type === "delete") {
      deleteArm.mutate(confirmAction.armId);
    } else {
      resetArm.mutate(confirmAction.armId);
    }
    setConfirmAction(null);
  }, [confirmAction, deleteArm, resetArm]);

  // ---- Selection test ----
  const [selectionResult, setSelectionResult] = useState<string | null>(null);
  const handleTestSelect = async (contextKey: string) => {
    selectArm.mutate(
      { contextKey },
      {
        onSuccess: (result) => {
          setSelectionResult(
            `Selected "${result.arm.name}" (sample: ${result.sampledValue.toFixed(3)}, ` +
            `exploration: ${(result.explorationRatio * 100).toFixed(0)}%)`
          );
        },
      }
    );
  };

  // ---- Filtered arms ----
  const filteredArms = arms.filter((a) => {
    if (filterDomain && a.domain !== filterDomain) return false;
    if (filterContext && a.contextKey !== filterContext) return false;
    return true;
  });

  return (
    <VaultLockGate>
      <div className="h-full overflow-y-auto p-6 space-y-6">
        <VaultNav />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="w-7 h-7 text-primary" />
              Memory &amp; Learning
            </h1>
            <p className="text-muted-foreground mt-1">
              Multi-armed bandit learning — the app continuously improves by remembering what works
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => applyDecay.mutate(undefined)}
              className="px-3 py-2 rounded-lg border text-sm flex items-center gap-1.5 hover:bg-muted"
              title="Apply time-decay to old arms"
            >
              <RefreshCw className="w-4 h-4" />
              Decay
            </button>
            <button
              onClick={() => setShowAddDialog(true)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm flex items-center gap-2 hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" />
              Add Arm
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<Layers className="w-5 h-5" />}
              label="Total Arms"
              value={stats.totalArms}
            />
            <StatCard
              icon={<Target className="w-5 h-5" />}
              label="Total Pulls"
              value={stats.totalPulls}
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="Total Reward"
              value={stats.totalReward.toFixed(1)}
            />
            <StatCard
              icon={<BarChart3 className="w-5 h-5" />}
              label="Avg Reward"
              value={
                stats.totalPulls > 0
                  ? (stats.totalReward / stats.totalPulls).toFixed(3)
                  : "—"
              }
            />
          </div>
        )}

        {/* Domain breakdown */}
        {stats && Object.keys(stats.domainBreakdown).length > 0 && (
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
              Learning by Domain
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(stats.domainBreakdown).map(([domain, data]) => (
                <div
                  key={domain}
                  className="flex items-center gap-3 p-2 rounded-lg bg-muted/30"
                >
                  <Sparkles className={`w-4 h-4 ${domainColor(domain as MABDomain)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {domainLabel(domain as MABDomain)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {data.arms} arms · {data.pulls} pulls · avg {data.avgReward.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filterDomain}
            onChange={(e) => setFilterDomain(e.target.value as MABDomain | "")}
            className="px-3 py-1.5 rounded-lg border bg-background text-sm"
          >
            <option value="">All Domains</option>
            {DOMAIN_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <select
            value={filterContext}
            onChange={(e) => setFilterContext(e.target.value)}
            className="px-3 py-1.5 rounded-lg border bg-background text-sm"
          >
            <option value="">All Context Keys</option>
            {contextKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {filterContext && (
            <button
              onClick={() => handleTestSelect(filterContext)}
              className="px-3 py-1.5 rounded-lg border bg-primary/10 text-primary text-sm flex items-center gap-1.5 hover:bg-primary/20"
            >
              <Zap className="w-3.5 h-3.5" />
              Test Selection
            </button>
          )}
        </div>

        {selectionResult && (
          <div className="p-3 rounded-lg bg-green-500/10 text-green-700 dark:text-green-300 text-sm flex items-center gap-2">
            <Zap className="w-4 h-4" />
            {selectionResult}
            <button
              onClick={() => setSelectionResult(null)}
              className="ml-auto p-1 hover:bg-green-500/20 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Arms table */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">
            Arms ({filteredArms.length})
          </h2>
          {armsLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="w-10 h-10 mx-auto mb-2 animate-pulse opacity-30" />
              Loading arms…
            </div>
          ) : filteredArms.length === 0 ? (
            <div className="text-center py-12 border rounded-lg text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No learning arms configured</p>
              <p className="text-sm">
                Add arms to start continuous learning — each arm is a strategy the system can choose
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredArms.map((arm) => (
                <ArmCard
                  key={arm.id}
                  arm={arm}
                  onQuickReward={handleQuickReward}
                  onReset={() => setConfirmAction({ type: "reset", armId: arm.id, armName: arm.name })}
                  onDelete={() => setConfirmAction({ type: "delete", armId: arm.id, armName: arm.name })}
                  onSelect={() => setSelectedArm(arm)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Recent reward events */}
        {recentEvents.length > 0 && (
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Recent Reward Events
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {recentEvents.map((evt) => (
                <RewardEventRow key={evt.id} event={evt} arms={arms} />
              ))}
            </div>
          </div>
        )}

        {/* Add Arm Dialog */}
        {showAddDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-background border rounded-xl max-w-lg w-full p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Add Learning Arm
                </h2>
                <button
                  onClick={() => setShowAddDialog(false)}
                  className="p-1 rounded hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Domain</label>
                  <select
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value as MABDomain)}
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                  >
                    {DOMAIN_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Name</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., GPT-4o, Claude Sonnet 4, Llama 3.1 8B"
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">
                    Context Key{" "}
                    <span className="text-muted-foreground font-normal">
                      (groups competing arms)
                    </span>
                  </label>
                  <input
                    value={newContextKey}
                    onChange={(e) => setNewContextKey(e.target.value)}
                    placeholder="e.g., chat-model-select, code-gen-model"
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description (optional)</label>
                  <input
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Brief description of what this arm does"
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowAddDialog(false)}
                  className="px-4 py-2 rounded-lg border text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateArm}
                  disabled={!newName || !newContextKey}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                >
                  Create Arm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Arm Detail Dialog */}
        {selectedArm && (
          <ArmDetailDialog
            arm={selectedArm}
            onClose={() => setSelectedArm(null)}
          />
        )}

        {/* Confirmation Dialog */}
        {confirmAction && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-background border rounded-xl max-w-sm w-full p-6 space-y-4">
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-lg font-bold">
                  {confirmAction.type === "delete"
                    ? "Delete Arm"
                    : "Reset Arm"}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {confirmAction.type === "delete"
                  ? `This will permanently delete "${confirmAction.armName}" and all its reward history. This cannot be undone.`
                  : `This will reset "${confirmAction.armName}" to its uninformed prior (α=1, β=1) and delete all reward history.`}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2 rounded-lg border text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmedAction}
                  className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium"
                >
                  {confirmAction.type === "delete" ? "Delete" : "Reset"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Competing Arms — grouped by context key */}
        {filterContext && filteredArms.length > 1 && (
          <div className="border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Competing Arms — {filterContext}
            </h3>
            <div className="space-y-2">
              {[...filteredArms]
                .sort((a, b) => b.meanReward - a.meanReward)
                .map((arm, i) => (
                  <div key={arm.id} className="flex items-center gap-3 text-sm py-1.5">
                    <span className="w-5 text-center font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{arm.name}</div>
                    </div>
                    <BetaBar alpha={arm.alpha} beta={arm.beta} />
                    <div className="w-16 text-right">
                      <span className="font-mono text-xs">
                        {(arm.meanReward * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-20 text-right">
                      <ConfidenceBadge confidence={arm.confidence} />
                    </div>
                    <span className="text-xs text-muted-foreground w-14 text-right">
                      {arm.pulls} pulls
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </VaultLockGate>
  );
}

// ---- Sub-components ----

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="border rounded-lg p-4 flex items-center gap-3">
      <div className="text-primary">{icon}</div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function ArmCard({
  arm,
  onQuickReward,
  onReset,
  onDelete,
  onSelect,
}: {
  arm: MABArm;
  onQuickReward: (armId: string, reward: number) => void;
  onReset: () => void;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const rewardPercent = Math.round(arm.meanReward * 100);

  return (
    <div
      className="border rounded-lg p-4 flex items-center gap-4 hover:bg-muted/30 cursor-pointer"
      onClick={onSelect}
    >
      {/* Visual indicator */}
      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center relative">
        <Brain className={`w-5 h-5 ${domainColor(arm.domain)}`} />
        <div
          className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-background border flex items-center justify-center"
          title={`${rewardPercent}% mean reward`}
        >
          <span className="text-[9px] font-bold">{rewardPercent}</span>
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium flex items-center gap-2">
          {arm.name}
          {!arm.isActive && (
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              inactive
            </span>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          {domainLabel(arm.domain)} · ctx: {arm.contextKey}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
          <span>{arm.pulls} pulls</span>
          <span>α={arm.alpha.toFixed(1)} β={arm.beta.toFixed(1)}</span>
          <span>mean: {(arm.meanReward * 100).toFixed(1)}%</span>
          <ConfidenceBadge confidence={arm.confidence} />
        </div>
      </div>

      {/* Beta distribution bar */}
      <div className="w-24 hidden md:block">
        <BetaBar alpha={arm.alpha} beta={arm.beta} />
      </div>

      {/* Quick reward buttons */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onQuickReward(arm.id, 1.0)}
          className="p-1.5 rounded hover:bg-green-500/10 text-green-600"
          title="Reward (1.0)"
        >
          <ThumbsUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => onQuickReward(arm.id, 0.0)}
          className="p-1.5 rounded hover:bg-red-500/10 text-red-500"
          title="Penalize (0.0)"
        >
          <ThumbsDown className="w-4 h-4" />
        </button>
        <button
          onClick={onReset}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
          title="Reset arm"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          title="Delete arm"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function BetaBar({ alpha, beta }: { alpha: number; beta: number }) {
  const mean = alpha / (alpha + beta);
  const width = Math.max(4, Math.min(100, Math.round(mean * 100)));
  const confidence = Math.min(1, (alpha + beta - 2) / 20); // How much data we have

  return (
    <div className="space-y-1">
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${width}%`,
            backgroundColor: `hsl(${Math.round(mean * 120)}, 70%, 50%)`,
            opacity: 0.4 + confidence * 0.6,
          }}
        />
      </div>
      <div className="text-[10px] text-center text-muted-foreground">
        {(mean * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function RewardEventRow({
  event,
  arms,
}: {
  event: MABRewardEvent;
  arms: MABArm[];
}) {
  const arm = arms.find((a) => a.id === event.armId);
  const isPositive = event.reward >= 0.5;

  return (
    <div className="flex items-center gap-3 text-sm py-1 px-2 rounded hover:bg-muted/30">
      <div
        className={`w-2 h-2 rounded-full ${
          isPositive ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <span className="text-muted-foreground text-xs min-w-[60px]">
        {new Date(event.createdAt).toLocaleTimeString()}
      </span>
      <span className="font-medium truncate">
        {arm?.name ?? event.armId.slice(0, 8)}
      </span>
      <span
        className={`text-xs font-mono ${
          isPositive ? "text-green-600" : "text-red-500"
        }`}
      >
        {event.reward.toFixed(2)}
      </span>
      {event.feedback && (
        <span className="text-xs text-muted-foreground truncate">
          {event.feedback}
        </span>
      )}
      <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground ml-auto">
        {event.source}
      </span>
    </div>
  );
}

function ArmDetailDialog({
  arm,
  onClose,
}: {
  arm: MABArm;
  onClose: () => void;
}) {
  const { data: rewardHistory = [] } = useRewardHistory(arm.id, 30);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background border rounded-xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Brain className={`w-5 h-5 ${domainColor(arm.domain)}`} />
            {arm.name}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {arm.description && (
          <p className="text-sm text-muted-foreground">{arm.description}</p>
        )}

        <div className="space-y-3">
          <DetailRow label="Domain" value={domainLabel(arm.domain)} />
          <DetailRow label="Context Key" value={arm.contextKey} />
          <DetailRow label="Pulls" value={String(arm.pulls)} />
          <DetailRow label="Alpha (α)" value={arm.alpha.toFixed(2)} />
          <DetailRow label="Beta (β)" value={arm.beta.toFixed(2)} />
          <DetailRow
            label="Mean Reward"
            value={`${(arm.meanReward * 100).toFixed(1)}%`}
          />
          <DetailRow
            label="Win Rate"
            value={arm.pulls > 0 ? `${(arm.winRate * 100).toFixed(1)}%` : "—"}
          />
          <DetailRow
            label="Confidence"
            value={`${(arm.confidence * 100).toFixed(0)}%`}
          />
          <DetailRow label="Total Reward" value={arm.totalReward.toFixed(2)} />
          <DetailRow label="Active" value={arm.isActive ? "Yes" : "No"} />
          <DetailRow
            label="Last Reward"
            value={arm.lastRewardAt ? new Date(arm.lastRewardAt).toLocaleString() : "Never"}
          />
          <DetailRow
            label="Created"
            value={new Date(arm.createdAt).toLocaleString()}
          />
          <DetailRow
            label="Updated"
            value={new Date(arm.updatedAt).toLocaleString()}
          />

          {/* Beta distribution visualization */}
          <div>
            <div className="text-sm font-medium mb-2">Posterior Distribution</div>
            <div className="h-6 rounded bg-muted overflow-hidden relative">
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${Math.round(arm.meanReward * 100)}%`,
                  backgroundColor: `hsl(${Math.round(arm.meanReward * 120)}, 70%, 50%)`,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center text-xs font-mono">
                Beta(α={arm.alpha.toFixed(1)}, β={arm.beta.toFixed(1)})
              </div>
            </div>
          </div>

          {/* Reward History */}
          {rewardHistory.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <History className="w-4 h-4" />
                Recent Rewards ({rewardHistory.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {rewardHistory.map((evt) => (
                  <div key={evt.id} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-muted/30">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        evt.reward >= 0.5 ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <span className="text-muted-foreground min-w-[60px]">
                      {new Date(evt.createdAt).toLocaleTimeString()}
                    </span>
                    <span className={`font-mono ${evt.reward >= 0.5 ? "text-green-600" : "text-red-500"}`}>
                      {evt.reward.toFixed(2)}
                    </span>
                    <span className="bg-muted px-1 py-0.5 rounded text-muted-foreground ml-auto">
                      {evt.source}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {arm.metadataJson && Object.keys(arm.metadataJson).length > 0 && (
            <div>
              <div className="text-sm font-medium mb-1">Metadata</div>
              <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                {JSON.stringify(arm.metadataJson, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border text-sm hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let color = "text-muted-foreground bg-muted";
  if (pct >= 80) color = "text-green-700 bg-green-500/10 dark:text-green-400";
  else if (pct >= 40) color = "text-amber-700 bg-amber-500/10 dark:text-amber-400";
  else if (pct > 0) color = "text-red-600 bg-red-500/10 dark:text-red-400";

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${color}`}>
      {pct > 0 ? `${pct}% conf` : "new"}
    </span>
  );
}
