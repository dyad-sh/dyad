/**
 * A2A Network Page — The Agentic Web Hub
 *
 * Tabs: Network Overview, My Agents, Agent Registry, Tasks, Messages
 * Browse agents, register your own, manage cross-agent tasks.
 */

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Network,
  Bot,
  Search,
  MessageSquare,
  CheckCircle,
  Clock,
  Activity,
  Globe,
  Zap,
  ShieldCheck,
  Users,
  Plus,
  Play,
  Pause,
  XCircle,
  ArrowRight,
  Loader2,
  Star,
  Code,
  FileText,
  Image,
  Cpu,
  Database,
  Workflow,
  BarChart3,
  Send,
  Filter,
  RefreshCw,
  ChevronRight,
  CircleDot,
  Radio,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentCard {
  agentId: string;
  name: string;
  description: string;
  version: string;
  capabilities: { id: string; name: string; category: string }[];
  pricing: { capabilityId: string; model: string; amount: string; currency: string }[];
  endpoints: { type: string; url: string; healthy: boolean }[];
  reputationScore: number;
  trustTier: string;
  totalTasksCompleted: number;
  avgResponseMs: number;
  uptimePercent: number;
  registeredAt: number;
}

interface A2ATask {
  id: string;
  threadId: string;
  requesterId: string;
  executorId: string;
  capabilityId: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  agreedPrice?: string;
  currency?: string;
  status: string;
  progress: number;
  createdAt: number;
  completedAt?: number;
}

interface A2ANetworkStats {
  totalRegisteredAgents: number;
  onlineAgents: number;
  totalTasksCompleted: number;
  totalValueTransacted: string;
  avgTaskLatencyMs: number;
  activeTasksNow: number;
  topCategories: { category: string; count: number }[];
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Network", icon: Globe },
  { id: "my-agents", label: "My Agents", icon: Bot },
  { id: "registry", label: "Agent Registry", icon: Search },
  { id: "tasks", label: "Tasks", icon: CheckCircle },
  { id: "messages", label: "Messages", icon: MessageSquare },
] as const;

type TabId = (typeof TABS)[number]["id"];

const invoke = window.electron?.ipcRenderer?.invoke;

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  "text-generation": FileText,
  "text-analysis": FileText,
  "image-generation": Image,
  "image-analysis": Image,
  "code-generation": Code,
  "code-review": Code,
  "data-processing": Database,
  "data-analysis": BarChart3,
  "web-scraping": Globe,
  "api-integration": Zap,
  "task-automation": Workflow,
  "conversation": MessageSquare,
  "search": Search,
  "custom": Cpu,
};

const STATUS_COLORS: Record<string, string> = {
  created: "bg-gray-500/15 text-gray-600",
  negotiating: "bg-yellow-500/15 text-yellow-600",
  accepted: "bg-blue-500/15 text-blue-600",
  running: "bg-purple-500/15 text-purple-600",
  completed: "bg-green-500/15 text-green-600",
  failed: "bg-red-500/15 text-red-600",
  cancelled: "bg-gray-500/15 text-gray-500",
};

const TIER_COLORS: Record<string, string> = {
  newcomer: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  contributor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  trusted: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  verified: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  elite: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
};

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string; icon: React.ElementType; color: string; sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── NetworkOverview ──────────────────────────────────────────────────────────

function NetworkOverview() {
  const [stats, setStats] = useState<A2ANetworkStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setStats(await invoke("a2a:get-network-stats")); } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return <LoadingState />;
  if (!stats) return <EmptyState msg="No network data yet. Register your first agent to get started." />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Registered Agents" value={stats.totalRegisteredAgents.toString()} icon={Bot} color="text-blue-500" />
        <StatCard label="Online Now" value={stats.onlineAgents.toString()} icon={Radio} color="text-green-500" />
        <StatCard label="Tasks Completed" value={stats.totalTasksCompleted.toString()} icon={CheckCircle} color="text-purple-500" />
        <StatCard label="Active Tasks" value={stats.activeTasksNow.toString()} icon={Activity} color="text-orange-500" />
        <StatCard label="Avg Latency" value={`${stats.avgTaskLatencyMs}ms`} icon={Clock} color="text-yellow-500" />
        <StatCard label="Value Transacted" value={stats.totalValueTransacted || "0 JOY"} icon={Zap} color="text-pink-500" />
      </div>

      {/* Top Categories */}
      {stats.topCategories.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">Top Agent Categories</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {stats.topCategories.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.category] ?? Cpu;
              return (
                <div key={cat.category} className="rounded-lg bg-muted/50 p-3 text-center">
                  <Icon className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-sm font-bold">{cat.count}</div>
                  <div className="text-xs text-muted-foreground capitalize">{cat.category.replace(/-/g, " ")}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl border bg-gradient-to-br from-blue-500/5 to-purple-500/5 p-6">
        <h3 className="text-sm font-semibold mb-4">🌐 How the Agentic Web Works</h3>
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { step: "1", title: "Register", desc: "Register your agent with capabilities and pricing", icon: Plus },
            { step: "2", title: "Discover", desc: "Other agents find yours through the decentralized registry", icon: Search },
            { step: "3", title: "Negotiate", desc: "Agents negotiate price, scope, and terms automatically", icon: MessageSquare },
            { step: "4", title: "Execute", desc: "Tasks run, payments flow, reputation builds", icon: Zap },
          ].map((s) => (
            <div key={s.step} className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                <s.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MyAgentsTab ──────────────────────────────────────────────────────────────

function MyAgentsTab() {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [regName, setRegName] = useState("");
  const [regDesc, setRegDesc] = useState("");
  const [regCategory, setRegCategory] = useState("text-generation");

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    setLoading(true);
    try { setAgents(await invoke("a2a:get-my-agents") ?? []); } catch { setAgents([]); }
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!regName || !regDesc) return;
    try {
      await invoke("a2a:register-agent", {
        name: regName,
        description: regDesc,
        ownerDid: "did:joy:local-user",
        capabilities: [{ id: "cap-1", name: regName, description: regDesc, category: regCategory }],
        pricing: [{ capabilityId: "cap-1", model: "free", amount: "0", currency: "JOY" }],
        endpoints: [{ type: "http", url: "http://localhost:18793", priority: 1, healthy: true, lastChecked: Date.now() }],
      });
      setShowRegister(false);
      setRegName("");
      setRegDesc("");
      loadAgents();
    } catch (err) { console.error(err); }
  };

  const handleDeregister = async (agentId: string) => {
    try {
      await invoke("a2a:deregister-agent", agentId);
      loadAgents();
    } catch (err) { console.error(err); }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Your Registered Agents</h3>
        <Button size="sm" onClick={() => setShowRegister(!showRegister)}>
          <Plus className="h-4 w-4 mr-1" /> Register Agent
        </Button>
      </div>

      {showRegister && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h4 className="text-sm font-medium">Register Agent to A2A Network</h4>
          <input
            type="text"
            placeholder="Agent name"
            value={regName}
            onChange={(e) => setRegName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <textarea
            placeholder="What does this agent do?"
            value={regDesc}
            onChange={(e) => setRegDesc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm h-20 resize-none"
          />
          <div className="flex gap-2 flex-wrap">
            {Object.keys(CATEGORY_ICONS).map((cat) => (
              <button
                key={cat}
                onClick={() => setRegCategory(cat)}
                className={cn(
                  "text-xs px-2 py-1 rounded-full border transition-all",
                  regCategory === cat ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/20",
                )}
              >
                {cat.replace(/-/g, " ")}
              </button>
            ))}
          </div>
          <Button onClick={handleRegister} disabled={!regName || !regDesc}>
            <Network className="h-4 w-4 mr-1" /> Register
          </Button>
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState msg="No agents registered yet. Register your agents to join the agentic web." />
      ) : (
        <div className="grid gap-4">
          {agents.map((agent) => (
            <AgentCardComponent key={agent.agentId} agent={agent} onDeregister={handleDeregister} showActions />
          ))}
        </div>
      )}
    </div>
  );
}

// ── RegistryTab ──────────────────────────────────────────────────────────────

function RegistryTab() {
  const [agents, setAgents] = useState<{ agents: any[]; total: number }>({ agents: [], total: 0 });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { searchAgents(); }, []);

  const searchAgents = async () => {
    setLoading(true);
    try {
      const result = await invoke("a2a:search-agents", { query, limit: 50 });
      setAgents(result ?? { agents: [], total: 0 });
    } catch { setAgents({ agents: [], total: 0 }); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search agents by name, capability, or category..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchAgents()}
            className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm"
          />
        </div>
        <Button onClick={searchAgents}>
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{agents.total} agents found</p>

      {loading ? <LoadingState /> : (
        <div className="grid gap-4">
          {agents.agents.map((entry: any) => (
            <AgentCardComponent key={entry.agentId} agent={entry.card ?? entry} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── TasksTab ─────────────────────────────────────────────────────────────────

function TasksTab() {
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => { loadTasks(); }, []);

  const loadTasks = async () => {
    setLoading(true);
    try { setTasks(await invoke("a2a:get-tasks") ?? []); } catch { setTasks([]); }
    setLoading(false);
  };

  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Cross-Agent Tasks</h3>
        <div className="flex gap-1">
          {["all", "running", "completed", "failed"].map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState msg="No tasks yet. Tasks appear when agents request work from each other." />
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => (
            <div key={task.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={cn("text-xs", STATUS_COLORS[task.status] ?? STATUS_COLORS.created)}>
                      {task.status}
                    </Badge>
                    <span className="text-sm font-medium">{task.capabilityId}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {task.requesterId.slice(0, 20)}... → {task.executorId.slice(0, 20)}...
                  </div>
                </div>

                {task.status === "running" && (
                  <div className="w-24">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-purple-500 transition-all" style={{ width: `${task.progress}%` }} />
                    </div>
                    <div className="text-xs text-center text-muted-foreground mt-1">{task.progress}%</div>
                  </div>
                )}

                {task.agreedPrice && (
                  <div className="text-right">
                    <div className="text-sm font-bold">{task.agreedPrice} {task.currency}</div>
                    <div className="text-xs text-muted-foreground">agreed</div>
                  </div>
                )}

                <span className="text-xs text-muted-foreground">
                  {new Date(task.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MessagesTab ──────────────────────────────────────────────────────────────

function MessagesTab() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-gradient-to-br from-blue-500/5 to-purple-500/5 p-8 text-center">
        <MessageSquare className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
        <h3 className="text-lg font-semibold mb-2">Agent Messages</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          View A2A protocol messages between your agents and the network.
          Messages appear automatically when tasks are created, negotiated, and completed.
        </p>
      </div>
    </div>
  );
}

// ── AgentCardComponent ───────────────────────────────────────────────────────

function AgentCardComponent({ agent, onDeregister, showActions }: {
  agent: AgentCard;
  onDeregister?: (id: string) => void;
  showActions?: boolean;
}) {
  const tierColor = TIER_COLORS[agent.trustTier] ?? TIER_COLORS.newcomer;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Bot className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{agent.name}</span>
            <Badge className="text-xs" variant="outline">v{agent.version}</Badge>
            <Badge className={cn("text-xs", tierColor)}>{agent.trustTier}</Badge>
            <CircleDot className="h-3 w-3 text-green-500" />
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{agent.description}</p>

          {/* Capabilities */}
          <div className="flex gap-1 mt-2 flex-wrap">
            {agent.capabilities.map((cap) => (
              <span key={cap.id} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {cap.category.replace(/-/g, " ")}
              </span>
            ))}
          </div>

          {/* Stats row */}
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> {agent.totalTasksCompleted} tasks
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {agent.avgResponseMs}ms avg
            </span>
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" /> {agent.uptimePercent}% uptime
            </span>
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" /> {agent.reputationScore}
            </span>
          </div>
        </div>

        {showActions && onDeregister && (
          <Button size="sm" variant="outline" className="text-red-500" onClick={() => onDeregister(agent.agentId)}>
            <XCircle className="h-3 w-3 mr-1" /> Remove
          </Button>
        )}
      </div>
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
      <Network className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-muted-foreground">{msg}</p>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function A2ANetworkPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
            <Network className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Agentic Web (A2A Network)</h1>
            <p className="text-sm text-muted-foreground">Agents discover, negotiate, and transact with each other autonomously</p>
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
        {activeTab === "overview" && <NetworkOverview />}
        {activeTab === "my-agents" && <MyAgentsTab />}
        {activeTab === "registry" && <RegistryTab />}
        {activeTab === "tasks" && <TasksTab />}
        {activeTab === "messages" && <MessagesTab />}
      </div>
    </div>
  );
}
