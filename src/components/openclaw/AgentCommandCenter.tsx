/**
 * Agent Command Center — Exhaustive Agent/SubAgent/Bot Management
 * 
 * This is the nerve center. Every agent, sub-agent, task bot, cron job,
 * and session lives here. You can see what's running, kill it, inspect
 * the outcome, and view the Celestia DA receipt.
 * 
 * Panels:
 * 1. Sessions Overview — all active/recent OpenClaw sessions
 * 2. Sub-Agent Monitor — spawned sub-agents with live status
 * 3. Cron & Scheduled Jobs — all scheduled tasks
 * 4. JoyCreate Agents — marketplace agents with deploy status
 * 5. Celestia DA Receipts — data availability proofs
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { OpenClawClient as openclawClient } from "@/ipc/openclaw_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Bot,
  Cpu,
  Activity,
  Zap,
  Clock,
  Play,
  Square,
  Pause,
  Trash2,
  RefreshCw,
  Search,
  Filter,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  MoreVertical,
  Terminal,
  Radio,
  Wifi,
  WifiOff,
  Shield,
  ShieldCheck,
  Hash,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  ExternalLink,
  Copy,
  Send,
  MessageSquare,
  Calendar,
  Timer,
  Layers,
  Network,
  Globe,
  Database,
  HardDrive,
  Workflow,
  Sparkles,
  TrendingUp,
  BarChart3,
  FileText,
  Settings,
  Power,
  RotateCcw,
  CircleDot,
  Satellite,
  Blocks,
  Receipt,
  Fingerprint,
  Lock,
  Unlock,
  Users,
  BrainCircuit,
  GitBranch,
  Package,
} from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

interface GatewaySession {
  sessionKey: string;
  kind: string;
  label?: string;
  model?: string;
  lastActivity?: string;
  messageCount?: number;
  status: "active" | "idle" | "completed" | "error";
  parentSession?: string;
  agentId?: string;
}

interface SubAgentInfo {
  id: string;
  label?: string;
  status: "running" | "completed" | "failed" | "killed";
  model?: string;
  task?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  tokensUsed?: number;
  result?: string;
  error?: string;
  parentSessionKey?: string;
}

interface CronJobInfo {
  id: string;
  name?: string;
  schedule: { kind: string; expr?: string; at?: string; everyMs?: number };
  payload: { kind: string; text?: string; message?: string };
  sessionTarget?: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  runCount?: number;
  lastStatus?: "success" | "failure";
}

interface JoyCreateAgentInfo {
  id: number;
  name: string;
  type: string;
  status: string;
  description?: string;
  modelId?: string;
  publishStatus?: string;
  deploymentStatus?: string;
  triggerCount?: number;
  lastActive?: string;
}

interface CelestiaReceipt {
  cid: string;
  height: number;
  namespace: string;
  commitment: string;
  data: {
    type: string;
    model?: string;
    issuer?: string;
    timestamp: number;
    inputHash?: string;
    outputHash?: string;
    tokensUsed?: number;
    paymentTx?: string;
  };
  proof?: {
    valid: boolean;
    inclusionProof?: string;
    shareProof?: string;
  };
  submittedAt: number;
  confirmedAt?: number;
  status: "pending" | "confirmed" | "failed";
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function formatRelativeTime(timestamp: string | number | undefined): string {
  if (!timestamp) return "";
  const date = typeof timestamp === "number"
    ? new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp)
    : new Date(timestamp);
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0) return "in the future";
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function truncate(str: string, len: number): string {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500",
  running: "bg-green-500",
  idle: "bg-yellow-500",
  completed: "bg-blue-500",
  success: "bg-green-500",
  failed: "bg-red-500",
  error: "bg-red-500",
  killed: "bg-orange-500",
  pending: "bg-yellow-500",
  confirmed: "bg-green-500",
  draft: "bg-gray-500",
  paused: "bg-yellow-500",
};

const STATUS_TEXT: Record<string, string> = {
  active: "text-green-400",
  running: "text-green-400",
  idle: "text-yellow-400",
  completed: "text-blue-400",
  success: "text-green-400",
  failed: "text-red-400",
  error: "text-red-400",
  killed: "text-orange-400",
  pending: "text-yellow-400",
  confirmed: "text-green-400",
  draft: "text-gray-400",
  paused: "text-yellow-400",
};

// ============================================================================
// 1. SESSIONS PANEL
// ============================================================================

interface SessionsPanelProps {
  sessions: GatewaySession[];
  isLoading: boolean;
  onRefresh: () => void;
  onViewSession: (session: GatewaySession) => void;
  onSendMessage: (sessionKey: string, message: string) => void;
}

function SessionsPanel({ sessions, isLoading, onRefresh, onViewSession, onSendMessage }: SessionsPanelProps) {
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState("all");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<string>("");
  const [sendMessage, setSendMessage] = useState("");

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (filterKind !== "all" && s.kind !== filterKind) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (s.sessionKey || "").toLowerCase().includes(q) ||
          (s.label || "").toLowerCase().includes(q) ||
          (s.agentId || "").toLowerCase().includes(q) ||
          (s.kind || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sessions, search, filterKind]);

  const kinds = useMemo(() => {
    const set = new Set(sessions.map((s) => s.kind));
    return Array.from(set).sort();
  }, [sessions]);

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const totalMessages = sessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Total Sessions</span>
              <MessageSquare className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-lg font-bold">{sessions.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Active Now</span>
              <Activity className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-lg font-bold text-green-400">{activeCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Session Types</span>
              <Layers className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-lg font-bold">{kinds.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Total Messages</span>
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-lg font-bold">{totalMessages.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <Input
            placeholder="Search sessions..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterKind} onValueChange={setFilterKind}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {kinds.map((k) => (
              <SelectItem key={k} value={k}>{k}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8" onClick={onRefresh}>
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Session List */}
      <ScrollArea className="max-h-[600px]">
        <div className="space-y-2">
          {filtered.map((session) => (
            <Card key={session.sessionKey} className="bg-muted/20 border-border/40 hover:bg-muted/40 transition-colors">
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  {/* Status indicator */}
                  <div className="mt-1">
                    <div className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[session.status] || "bg-gray-500"} ${
                      session.status === "active" ? "animate-pulse" : ""
                    }`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">
                        {session.label || session.sessionKey.slice(0, 20)}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {session.kind}
                      </Badge>
                      {session.agentId && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400 shrink-0">
                          <Bot className="w-2.5 h-2.5 mr-0.5" />
                          {session.agentId}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
                      {session.model && (
                        <span className="flex items-center gap-0.5">
                          <Cpu className="w-2.5 h-2.5" />
                          {truncate(session.model, 25)}
                        </span>
                      )}
                      {session.messageCount !== undefined && (
                        <span className="flex items-center gap-0.5">
                          <MessageSquare className="w-2.5 h-2.5" />
                          {session.messageCount} msgs
                        </span>
                      )}
                      {session.lastActivity && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {formatRelativeTime(session.lastActivity)}
                        </span>
                      )}
                    </div>

                    <div className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono truncate">
                      {session.sessionKey}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewSession(session)}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View History</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              setSendTarget(session.sessionKey);
                              setSendDialogOpen(true);
                            }}
                          >
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Send Message</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              navigator.clipboard.writeText(session.sessionKey);
                              toast.success("Session key copied");
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy Session Key</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground/50">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No sessions found</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Send Message Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send to Session</DialogTitle>
            <DialogDescription className="font-mono text-xs">{sendTarget}</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Message..."
            value={sendMessage}
            onChange={(e) => setSendMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && sendMessage.trim()) {
                onSendMessage(sendTarget, sendMessage);
                setSendMessage("");
                setSendDialogOpen(false);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              if (sendMessage.trim()) {
                onSendMessage(sendTarget, sendMessage);
                setSendMessage("");
                setSendDialogOpen(false);
              }
            }}>
              <Send className="w-3.5 h-3.5 mr-1.5" />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// 2. SUB-AGENT MONITOR
// ============================================================================

interface SubAgentMonitorProps {
  subAgents: SubAgentInfo[];
  isLoading: boolean;
  onRefresh: () => void;
  onKill: (id: string) => void;
  onSteer: (id: string, message: string) => void;
  onViewResult: (agent: SubAgentInfo) => void;
}

function SubAgentMonitor({ subAgents, isLoading, onRefresh, onKill, onSteer, onViewResult }: SubAgentMonitorProps) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [steerTarget, setSteerTarget] = useState<string>("");
  const [steerMessage, setSteerMessage] = useState("");
  const [steerDialogOpen, setSteerDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    return subAgents.filter((a) => {
      if (filterStatus !== "all" && a.status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (a.label || "").toLowerCase().includes(q) ||
          (a.task || "").toLowerCase().includes(q) ||
          (a.id || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [subAgents, search, filterStatus]);

  const runningCount = subAgents.filter((a) => a.status === "running").length;
  const completedCount = subAgents.filter((a) => a.status === "completed").length;
  const failedCount = subAgents.filter((a) => a.status === "failed").length;
  const totalTokens = subAgents.reduce((sum, a) => sum + (a.tokensUsed || 0), 0);

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Total</span>
              <Bot className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-lg font-bold">{subAgents.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Running</span>
              <Play className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-lg font-bold text-green-400">{runningCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Completed</span>
              <CheckCircle2 className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-lg font-bold text-blue-400">{completedCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Failed</span>
              <XCircle className="w-4 h-4 text-red-400" />
            </div>
            <div className="text-lg font-bold text-red-400">{failedCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Tokens</span>
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-lg font-bold">{totalTokens.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <Input
            placeholder="Search sub-agents..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="killed">Killed</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8" onClick={onRefresh}>
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Sub-Agent Cards */}
      <ScrollArea className="max-h-[600px]">
        <div className="space-y-2">
          {filtered.map((agent) => (
            <Card key={agent.id} className="bg-muted/20 border-border/40 hover:bg-muted/40 transition-colors">
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  {/* Status icon */}
                  <div className="mt-0.5">
                    {agent.status === "running" ? (
                      <Loader2 className="w-5 h-5 text-green-400 animate-spin" />
                    ) : agent.status === "completed" ? (
                      <CheckCircle2 className="w-5 h-5 text-blue-400" />
                    ) : agent.status === "failed" ? (
                      <XCircle className="w-5 h-5 text-red-400" />
                    ) : (
                      <Square className="w-5 h-5 text-orange-400" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">
                        {agent.label || `Sub-Agent ${agent.id.slice(0, 8)}`}
                      </span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                        STATUS_TEXT[agent.status] || "text-muted-foreground"
                      }`}>
                        {agent.status}
                      </Badge>
                      {agent.model && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/60">
                          {truncate(agent.model, 20)}
                        </Badge>
                      )}
                    </div>

                    {/* Task description */}
                    {agent.task && (
                      <p className="text-xs text-muted-foreground/80 line-clamp-2 mb-1">
                        {agent.task}
                      </p>
                    )}

                    {/* Metrics */}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {agent.durationMs ? formatDuration(agent.durationMs) : formatRelativeTime(agent.startedAt)}
                      </span>
                      {agent.tokensUsed !== undefined && agent.tokensUsed > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Zap className="w-2.5 h-2.5" />
                          {agent.tokensUsed.toLocaleString()} tok
                        </span>
                      )}
                      {agent.parentSessionKey && (
                        <span className="flex items-center gap-0.5 font-mono">
                          <GitBranch className="w-2.5 h-2.5" />
                          {agent.parentSessionKey.slice(0, 12)}
                        </span>
                      )}
                    </div>

                    {/* Error message */}
                    {agent.error && (
                      <div className="mt-1.5 p-1.5 rounded bg-red-500/10 text-red-400 text-[11px] border border-red-500/20">
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        {truncate(agent.error, 150)}
                      </div>
                    )}

                    {/* Result preview */}
                    {agent.result && agent.status === "completed" && (
                      <div className="mt-1.5 p-1.5 rounded bg-blue-500/5 text-[11px] text-muted-foreground/80 border border-blue-500/10">
                        <FileText className="w-3 h-3 inline mr-1 text-blue-400" />
                        {truncate(agent.result, 200)}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {agent.status === "running" && (
                      <>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setSteerTarget(agent.id);
                                  setSteerDialogOpen(true);
                                }}
                              >
                                <Send className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Steer Agent</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => onKill(agent.id)}
                              >
                                <Square className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Kill Agent</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </>
                    )}
                    {(agent.result || agent.error) && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewResult(agent)}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View Full Result</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground/50">
              <Bot className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No sub-agents found</p>
              <p className="text-xs mt-1">Sub-agents appear here when spawned from the main session</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Steer Dialog */}
      <Dialog open={steerDialogOpen} onOpenChange={setSteerDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Steer Sub-Agent</DialogTitle>
            <DialogDescription>Send guidance to the running sub-agent</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Guidance message..."
            value={steerMessage}
            onChange={(e) => setSteerMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && steerMessage.trim()) {
                onSteer(steerTarget, steerMessage);
                setSteerMessage("");
                setSteerDialogOpen(false);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSteerDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              if (steerMessage.trim()) {
                onSteer(steerTarget, steerMessage);
                setSteerMessage("");
                setSteerDialogOpen(false);
              }
            }}>
              Steer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// 3. CRON JOBS PANEL
// ============================================================================

interface CronJobsPanelProps {
  jobs: CronJobInfo[];
  isLoading: boolean;
  onRefresh: () => void;
  onToggle: (jobId: string, enabled: boolean) => void;
  onDelete: (jobId: string) => void;
  onRun: (jobId: string) => void;
}

function CronJobsPanel({ jobs, isLoading, onRefresh, onToggle, onDelete, onRun }: CronJobsPanelProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return jobs;
    const q = search.toLowerCase();
    return jobs.filter((j) =>
      (j.name || "").toLowerCase().includes(q) ||
      (j.payload.text || j.payload.message || "").toLowerCase().includes(q)
    );
  }, [jobs, search]);

  const enabledCount = jobs.filter((j) => j.enabled).length;

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Total Jobs</span>
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-lg font-bold">{jobs.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Active</span>
              <Play className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-lg font-bold text-green-400">{enabledCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Disabled</span>
              <Pause className="w-4 h-4 text-yellow-400" />
            </div>
            <div className="text-lg font-bold text-yellow-400">{jobs.length - enabledCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <Input
            placeholder="Search cron jobs..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={onRefresh}>
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Job List */}
      <ScrollArea className="max-h-[600px]">
        <div className="space-y-2">
          {filtered.map((job) => (
            <Card key={job.id} className={`border-border/40 transition-colors ${
              job.enabled ? "bg-muted/20 hover:bg-muted/40" : "bg-muted/10 opacity-60"
            }`}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  {/* Toggle */}
                  <div className="mt-1">
                    <Switch
                      checked={job.enabled}
                      onCheckedChange={(val) => onToggle(job.id, val)}
                      className="scale-75"
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">
                        {job.name || `Job ${job.id.slice(0, 8)}`}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {job.schedule.kind}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400">
                        {job.payload.kind}
                      </Badge>
                      {job.sessionTarget && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {job.sessionTarget}
                        </Badge>
                      )}
                    </div>

                    {/* Schedule expression */}
                    <div className="text-xs text-muted-foreground/70 font-mono mb-1">
                      {job.schedule.kind === "cron" && `📅 ${job.schedule.expr}`}
                      {job.schedule.kind === "every" && `🔄 Every ${formatDuration(job.schedule.everyMs || 0)}`}
                      {job.schedule.kind === "at" && `⏰ At ${job.schedule.at}`}
                    </div>

                    {/* Payload */}
                    <p className="text-[11px] text-muted-foreground/60 line-clamp-1">
                      {truncate(job.payload.text || job.payload.message || "", 100)}
                    </p>

                    {/* Run info */}
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/50">
                      {job.lastRun && (
                        <span>Last: {formatRelativeTime(job.lastRun)}</span>
                      )}
                      {job.nextRun && (
                        <span>Next: {formatRelativeTime(job.nextRun)}</span>
                      )}
                      {job.runCount !== undefined && (
                        <span>{job.runCount} runs</span>
                      )}
                      {job.lastStatus && (
                        <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                          job.lastStatus === "success" ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"
                        }`}>
                          {job.lastStatus}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRun(job.id)}>
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Run Now</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            onClick={() => onDelete(job.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete Job</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground/50">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No cron jobs found</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// 4. JOYCREATE AGENTS PANEL
// ============================================================================

interface JoyCreateAgentsPanelProps {
  agents: JoyCreateAgentInfo[];
  isLoading: boolean;
  onRefresh: () => void;
  onActivate: (agentId: number) => void;
  onViewAgent: (agentId: number) => void;
  onDeploy: (agentId: number) => void;
}

function JoyCreateAgentsPanel({ agents, isLoading, onRefresh, onActivate, onViewAgent, onDeploy }: JoyCreateAgentsPanelProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return agents;
    const q = search.toLowerCase();
    return agents.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      (a.description || "").toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q)
    );
  }, [agents, search]);

  const activeCount = agents.filter((a) => a.status === "active").length;
  const publishedCount = agents.filter((a) => a.publishStatus === "published").length;

  const typeIcons: Record<string, React.ReactNode> = {
    chatbot: <MessageSquare className="w-4 h-4 text-blue-400" />,
    task: <Workflow className="w-4 h-4 text-amber-400" />,
    "multi-agent": <Users className="w-4 h-4 text-purple-400" />,
    workflow: <GitBranch className="w-4 h-4 text-green-400" />,
    rag: <Database className="w-4 h-4 text-cyan-400" />,
  };

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Total Agents</span>
              <Bot className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-lg font-bold">{agents.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Active</span>
              <Play className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-lg font-bold text-green-400">{activeCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Published</span>
              <Package className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-lg font-bold text-purple-400">{publishedCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Draft</span>
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
            <div className="text-lg font-bold text-gray-400">{agents.length - activeCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <Input
            placeholder="Search agents..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={onRefresh}>
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Agent Grid */}
      <ScrollArea className="max-h-[600px]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((agent) => (
            <Card key={agent.id} className="bg-muted/20 border-border/40 hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => onViewAgent(agent.id)}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center shrink-0">
                    {typeIcons[agent.type] || <Bot className="w-5 h-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">{agent.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{agent.type}</Badge>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                        STATUS_TEXT[agent.status] || "text-gray-400"
                      }`}>
                        {agent.status}
                      </Badge>
                    </div>
                    {agent.description && (
                      <p className="text-[11px] text-muted-foreground/60 line-clamp-2">{agent.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/50">
                      {agent.modelId && (
                        <span className="flex items-center gap-0.5">
                          <Cpu className="w-2.5 h-2.5" />
                          {truncate(agent.modelId, 20)}
                        </span>
                      )}
                      {agent.publishStatus === "published" && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-500/30 text-green-400">
                          Published
                        </Badge>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <MoreVertical className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewAgent(agent.id); }}>
                        <Eye className="w-4 h-4 mr-2" /> View Details
                      </DropdownMenuItem>
                      {agent.status === "draft" && (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onActivate(agent.id); }}>
                          <Play className="w-4 h-4 mr-2" /> Activate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDeploy(agent.id); }}>
                        <Satellite className="w-4 h-4 mr-2" /> Deploy
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// 5. CELESTIA DA RECEIPTS PANEL
// ============================================================================

interface CelestiaPanelProps {
  receipts: CelestiaReceipt[];
  isLoading: boolean;
  onRefresh: () => void;
  onVerify: (cid: string) => void;
}

function CelestiaPanel({ receipts, isLoading, onRefresh, onVerify }: CelestiaPanelProps) {
  const [expandedCid, setExpandedCid] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return receipts;
    const q = search.toLowerCase();
    return receipts.filter((r) =>
      r.cid.toLowerCase().includes(q) ||
      (r.data.model || "").toLowerCase().includes(q) ||
      (r.data.issuer || "").toLowerCase().includes(q) ||
      r.data.type.toLowerCase().includes(q)
    );
  }, [receipts, search]);

  const confirmedCount = receipts.filter((r) => r.status === "confirmed").length;
  const pendingCount = receipts.filter((r) => r.status === "pending").length;
  const totalTokens = receipts.reduce((sum, r) => sum + (r.data.tokensUsed || 0), 0);

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Total Receipts</span>
              <Receipt className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-lg font-bold">{receipts.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Confirmed</span>
              <ShieldCheck className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-lg font-bold text-green-400">{confirmedCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Pending</span>
              <Loader2 className="w-4 h-4 text-yellow-400" />
            </div>
            <div className="text-lg font-bold text-yellow-400">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground/70">Tokens Tracked</span>
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-lg font-bold">{totalTokens.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Celestia Network Info */}
      <Card className="bg-gradient-to-r from-purple-500/5 to-blue-500/5 border-purple-500/20">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Satellite className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold">Celestia Data Availability</h3>
              <p className="text-[11px] text-muted-foreground/70">
                Every inference receipt is posted to Celestia for verifiable, tamper-proof provenance.
                Anyone can verify the computation happened as claimed.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="border-purple-500/30 text-purple-400">
                Mocha Testnet
              </Badge>
              <Badge variant="outline" className="border-green-500/30 text-green-400">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse" />
                Connected
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <Input
            placeholder="Search receipts (CID, model, issuer)..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={onRefresh}>
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Receipt List */}
      <ScrollArea className="max-h-[600px]">
        <div className="space-y-2">
          {filtered.map((receipt) => {
            const isExpanded = expandedCid === receipt.cid;
            return (
              <Card key={receipt.cid} className="bg-muted/20 border-border/40">
                <CardContent className="p-0">
                  <button
                    className="w-full text-left p-3 hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedCid(isExpanded ? null : receipt.cid)}
                  >
                    <div className="flex items-center gap-2">
                      {/* Status */}
                      <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[receipt.status] || "bg-gray-500"} ${
                        receipt.status === "pending" ? "animate-pulse" : ""
                      }`} />

                      {/* CID */}
                      <Hash className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                      <span className="text-xs font-mono text-muted-foreground/80 truncate flex-1">
                        {receipt.cid}
                      </span>

                      {/* Type & model badges */}
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {receipt.data.type}
                      </Badge>
                      {receipt.data.model && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400 shrink-0">
                          {truncate(receipt.data.model, 15)}
                        </Badge>
                      )}

                      {/* Verification */}
                      {receipt.proof?.valid && (
                        <ShieldCheck className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      )}

                      {/* Expand */}
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                      )}
                    </div>

                    {/* Summary row */}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/60 pl-4">
                      <span>Height: {receipt.height}</span>
                      <span>•</span>
                      <span>{formatRelativeTime(receipt.submittedAt)}</span>
                      {receipt.data.tokensUsed && (
                        <>
                          <span>•</span>
                          <span>{receipt.data.tokensUsed.toLocaleString()} tokens</span>
                        </>
                      )}
                      {receipt.data.paymentTx && (
                        <>
                          <span>•</span>
                          <span className="text-green-400">💰 Paid</span>
                        </>
                      )}
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-3 border-t border-border/30 pt-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-muted-foreground/70 block text-[11px]">CID</span>
                          <span className="font-mono text-[11px] break-all">{receipt.cid}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/70 block text-[11px]">Block Height</span>
                          <span className="font-mono text-[11px]">{receipt.height}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/70 block text-[11px]">Namespace</span>
                          <span className="font-mono text-[11px] break-all">{receipt.namespace}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/70 block text-[11px]">Commitment</span>
                          <span className="font-mono text-[11px] break-all">{truncate(receipt.commitment, 32)}</span>
                        </div>
                        {receipt.data.issuer && (
                          <div>
                            <span className="text-muted-foreground/70 block text-[11px]">Issuer</span>
                            <span className="font-mono text-[11px] break-all">{receipt.data.issuer}</span>
                          </div>
                        )}
                        {receipt.data.inputHash && (
                          <div>
                            <span className="text-muted-foreground/70 block text-[11px]">Input Hash</span>
                            <span className="font-mono text-[11px] break-all">{truncate(receipt.data.inputHash, 32)}</span>
                          </div>
                        )}
                        {receipt.data.outputHash && (
                          <div>
                            <span className="text-muted-foreground/70 block text-[11px]">Output Hash</span>
                            <span className="font-mono text-[11px] break-all">{truncate(receipt.data.outputHash, 32)}</span>
                          </div>
                        )}
                        {receipt.data.paymentTx && (
                          <div>
                            <span className="text-muted-foreground/70 block text-[11px]">Payment Tx</span>
                            <span className="font-mono text-[11px] break-all text-green-400">{truncate(receipt.data.paymentTx, 32)}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground/70 block text-[11px]">Submitted</span>
                          <span className="text-[11px]">{new Date(receipt.submittedAt).toLocaleString()}</span>
                        </div>
                        {receipt.confirmedAt && (
                          <div>
                            <span className="text-muted-foreground/70 block text-[11px]">Confirmed</span>
                            <span className="text-[11px]">{new Date(receipt.confirmedAt).toLocaleString()}</span>
                          </div>
                        )}
                      </div>

                      {/* Proof section */}
                      {receipt.proof && (
                        <div className="p-2 rounded bg-muted/30 border border-border/30">
                          <div className="flex items-center gap-2 mb-1.5">
                            <Shield className="w-3.5 h-3.5 text-purple-400" />
                            <span className="text-[11px] font-medium">Inclusion Proof</span>
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                              receipt.proof.valid ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"
                            }`}>
                              {receipt.proof.valid ? "✓ Valid" : "✗ Invalid"}
                            </Badge>
                          </div>
                          {receipt.proof.inclusionProof && (
                            <p className="text-[10px] text-muted-foreground/60 font-mono break-all">
                              {truncate(receipt.proof.inclusionProof, 64)}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onVerify(receipt.cid)}>
                          <ShieldCheck className="w-3 h-3 mr-1" />
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            navigator.clipboard.writeText(receipt.cid);
                            toast.success("CID copied");
                          }}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy CID
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                          <a
                            href={`https://mocha.celenium.io/tx/${receipt.cid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            Explorer
                          </a>
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground/50">
              <Satellite className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No Celestia receipts</p>
              <p className="text-xs mt-1">Receipts appear when inference results are posted to Celestia DA</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// 6. SESSION HISTORY VIEWER DIALOG
// ============================================================================

interface SessionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: GatewaySession | null;
  history: Array<{ role: string; content: string; timestamp?: string }>;
  isLoading: boolean;
}

function SessionHistoryDialog({ open, onOpenChange, session, history, isLoading }: SessionHistoryDialogProps) {
  if (!session) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            Session History
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {session.label || session.sessionKey} ({session.kind})
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3 p-1">
              {history.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "assistant" ? "" : "flex-row-reverse"}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    msg.role === "assistant" ? "bg-primary/20" : msg.role === "user" ? "bg-blue-500/20" : "bg-muted"
                  }`}>
                    {msg.role === "assistant" ? (
                      <Bot className="w-4 h-4 text-primary" />
                    ) : msg.role === "user" ? (
                      <MessageSquare className="w-4 h-4 text-blue-400" />
                    ) : (
                      <Settings className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className={`flex-1 rounded-lg p-3 text-sm ${
                    msg.role === "assistant"
                      ? "bg-muted/30"
                      : msg.role === "user"
                        ? "bg-blue-500/10"
                        : "bg-yellow-500/5 text-[11px]"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-medium text-muted-foreground/70 capitalize">{msg.role}</span>
                      {msg.timestamp && (
                        <span className="text-[10px] text-muted-foreground/50">{formatRelativeTime(msg.timestamp)}</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-xs">{truncate(msg.content, 2000)}</p>
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="text-center py-8 text-muted-foreground/50">
                  <Terminal className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No messages in this session</p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 7. SUB-AGENT RESULT VIEWER
// ============================================================================

interface ResultViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: SubAgentInfo | null;
}

function ResultViewerDialog({ open, onOpenChange, agent }: ResultViewerDialogProps) {
  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {agent.status === "completed" ? (
              <CheckCircle2 className="w-5 h-5 text-blue-400" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400" />
            )}
            {agent.label || `Sub-Agent ${agent.id.slice(0, 8)}`}
          </DialogTitle>
          <DialogDescription>
            {agent.status === "completed" ? "Task completed successfully" : "Task failed"}
            {agent.durationMs ? ` in ${formatDuration(agent.durationMs)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Task */}
        {agent.task && (
          <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
            <span className="text-[11px] text-muted-foreground/70 block mb-1">Task</span>
            <p className="text-sm">{agent.task}</p>
          </div>
        )}

        {/* Result or Error */}
        <ScrollArea className="max-h-[50vh]">
          {agent.result && (
            <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/10">
              <span className="text-[11px] text-green-400 block mb-1">Result</span>
              <pre className="text-xs whitespace-pre-wrap font-mono">{agent.result}</pre>
            </div>
          )}
          {agent.error && (
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10">
              <span className="text-[11px] text-red-400 block mb-1">Error</span>
              <pre className="text-xs whitespace-pre-wrap font-mono text-red-400">{agent.error}</pre>
            </div>
          )}
        </ScrollArea>

        {/* Metadata */}
        <div className="grid grid-cols-3 gap-3 text-xs">
          {agent.model && (
            <div>
              <span className="text-muted-foreground/70 block text-[11px]">Model</span>
              <span>{agent.model}</span>
            </div>
          )}
          {agent.tokensUsed !== undefined && (
            <div>
              <span className="text-muted-foreground/70 block text-[11px]">Tokens</span>
              <span>{agent.tokensUsed.toLocaleString()}</span>
            </div>
          )}
          {agent.durationMs !== undefined && (
            <div>
              <span className="text-muted-foreground/70 block text-[11px]">Duration</span>
              <span>{formatDuration(agent.durationMs)}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// MAIN EXPORT: AGENT COMMAND CENTER
// ============================================================================

export function AgentCommandCenter() {
  const ipc = IpcClient.getInstance();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("sessions");
  const [viewingSession, setViewingSession] = useState<GatewaySession | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [viewingAgent, setViewingAgent] = useState<SubAgentInfo | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);

  // ── Gateway WebSocket for real-time updates ──
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const { data: gatewayToken = "" } = useQuery({
    queryKey: ["openclaw-gateway-token"],
    queryFn: () => openclawClient.getGatewayToken(),
    staleTime: Infinity,
  });

  // ── Sessions ──
  const { data: sessionsRaw = [], isLoading: sessionsLoading, refetch: refetchSessions } = useQuery({
    queryKey: ["command-center-sessions"],
    queryFn: async () => {
      try {
        return await ipc.invoke("openclaw:sessions:list", { limit: 100 });
      } catch {
        return [];
      }
    },
    refetchInterval: 10_000,
  });

  const sessions: GatewaySession[] = useMemo(() => {
    return (Array.isArray(sessionsRaw) ? sessionsRaw : []).map((s: any) => ({
      sessionKey: s.sessionKey || s.key || s.id || "",
      kind: s.kind || s.type || "unknown",
      label: s.label || s.name,
      model: s.model,
      lastActivity: s.lastActivity || s.updatedAt,
      messageCount: s.messageCount || s.messages,
      status: s.status || (s.active ? "active" : "idle"),
      parentSession: s.parentSession || s.parent,
      agentId: s.agentId,
    }));
  }, [sessionsRaw]);

  // ── Sub-Agents ──
  const { data: subAgentsRaw = [], isLoading: subAgentsLoading, refetch: refetchSubAgents } = useQuery({
    queryKey: ["command-center-subagents"],
    queryFn: async () => {
      try {
        return await ipc.invoke("openclaw:subagents:list", { recentMinutes: 1440 });
      } catch {
        return [];
      }
    },
    refetchInterval: 8_000,
  });

  const subAgents: SubAgentInfo[] = useMemo(() => {
    return (Array.isArray(subAgentsRaw) ? subAgentsRaw : []).map((a: any) => ({
      id: a.id || a.sessionId || "",
      label: a.label || a.name,
      status: a.status || "running",
      model: a.model,
      task: a.task || a.prompt || a.message,
      startedAt: a.startedAt || a.createdAt || Date.now(),
      completedAt: a.completedAt,
      durationMs: a.durationMs,
      tokensUsed: a.tokensUsed || a.tokens,
      result: a.result || a.output,
      error: a.error,
      parentSessionKey: a.parentSessionKey || a.parent,
    }));
  }, [subAgentsRaw]);

  // ── Cron Jobs ──
  const { data: cronJobsRaw = [], isLoading: cronLoading, refetch: refetchCron } = useQuery({
    queryKey: ["command-center-cron"],
    queryFn: async () => {
      try {
        return await ipc.invoke("openclaw:cron:list", { includeDisabled: true });
      } catch {
        return [];
      }
    },
    refetchInterval: 30_000,
  });

  const cronJobs: CronJobInfo[] = useMemo(() => {
    return (Array.isArray(cronJobsRaw) ? cronJobsRaw : []).map((j: any) => ({
      id: j.id || j.jobId || "",
      name: j.name,
      schedule: j.schedule || { kind: "unknown" },
      payload: j.payload || { kind: "unknown" },
      sessionTarget: j.sessionTarget,
      enabled: j.enabled !== false,
      lastRun: j.lastRun,
      nextRun: j.nextRun,
      runCount: j.runCount,
      lastStatus: j.lastStatus,
    }));
  }, [cronJobsRaw]);

  // ── JoyCreate Agents ──
  const { data: jcAgentsRaw = [], isLoading: jcAgentsLoading, refetch: refetchJcAgents } = useQuery({
    queryKey: ["command-center-jc-agents"],
    queryFn: async () => {
      try {
        return await ipc.invoke("joycreate:agents:list");
      } catch {
        return [];
      }
    },
    refetchInterval: 30_000,
  });

  const jcAgents: JoyCreateAgentInfo[] = useMemo(() => {
    return (Array.isArray(jcAgentsRaw) ? jcAgentsRaw : []).map((a: any) => ({
      id: a.id,
      name: a.name || "Unnamed",
      type: a.type || "chatbot",
      status: a.status || "draft",
      description: a.description,
      modelId: a.modelId,
      publishStatus: a.publishStatus,
      deploymentStatus: a.deploymentStatus,
      triggerCount: a.triggerCount,
      lastActive: a.lastActive || a.updatedAt,
    }));
  }, [jcAgentsRaw]);

  // ── Celestia Receipts (from IPLD + Celestia bridge) ──
  const { data: celestiaReceiptsRaw = [], isLoading: celestiaLoading, refetch: refetchCelestia } = useQuery({
    queryKey: ["command-center-celestia"],
    queryFn: async () => {
      try {
        // Try Celestia receipts first, fall back to IPLD receipts
        const celestia = await ipc.invoke("openclaw:celestia:receipts:list");
        if (celestia && celestia.length > 0) return celestia;
        // Fallback to IPLD receipts
        const ipld = await ipc.listIpldReceipts();
        return ipld.map((r: any) => ({
          cid: r.cid,
          height: r.receipt?.blockHeight || 0,
          namespace: r.receipt?.namespace || "openclaw-inference",
          commitment: r.receipt?.sig?.value || "",
          data: {
            type: "inference",
            model: r.receipt?.model?.id,
            issuer: r.receipt?.issuer,
            timestamp: r.createdAt,
            inputHash: r.receipt?.prompt?.hash,
            outputHash: r.receipt?.output?.hash,
            tokensUsed: r.receipt?.tokens?.total,
            paymentTx: r.receipt?.payment?.tx,
          },
          proof: r.receipt?.sig?.value ? { valid: true } : undefined,
          submittedAt: r.createdAt * 1000,
          confirmedAt: r.receipt?.sig?.value ? r.createdAt * 1000 : undefined,
          status: r.receipt?.sig?.value ? "confirmed" : "pending",
        }));
      } catch {
        return [];
      }
    },
    refetchInterval: 15_000,
  });

  const celestiaReceipts: CelestiaReceipt[] = useMemo(() => {
    return Array.isArray(celestiaReceiptsRaw) ? celestiaReceiptsRaw : [];
  }, [celestiaReceiptsRaw]);

  // ── Session History ──
  const [sessionHistory, setSessionHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const viewSessionHistory = useCallback(async (session: GatewaySession) => {
    setViewingSession(session);
    setHistoryDialogOpen(true);
    setHistoryLoading(true);
    try {
      const result = await ipc.invoke("openclaw:sessions:history", {
        sessionKey: session.sessionKey,
        limit: 50,
      });
      setSessionHistory(Array.isArray(result) ? result : result?.messages || []);
    } catch {
      setSessionHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [ipc]);

  // ── Actions ──
  const handleSendMessage = useCallback(async (sessionKey: string, message: string) => {
    try {
      await ipc.invoke("openclaw:sessions:send", { sessionKey, message });
      toast.success("Message sent");
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc]);

  const handleKillSubAgent = useCallback(async (id: string) => {
    try {
      await ipc.invoke("openclaw:subagents:kill", { target: id });
      toast.success("Sub-agent killed");
      refetchSubAgents();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc, refetchSubAgents]);

  const handleSteerSubAgent = useCallback(async (id: string, message: string) => {
    try {
      await ipc.invoke("openclaw:subagents:steer", { target: id, message });
      toast.success("Guidance sent");
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc]);

  const handleToggleCron = useCallback(async (jobId: string, enabled: boolean) => {
    try {
      await ipc.invoke("openclaw:cron:update", { jobId, patch: { enabled } });
      toast.success(enabled ? "Job enabled" : "Job disabled");
      refetchCron();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc, refetchCron]);

  const handleDeleteCron = useCallback(async (jobId: string) => {
    if (!confirm("Delete this cron job?")) return;
    try {
      await ipc.invoke("openclaw:cron:remove", { jobId });
      toast.success("Job deleted");
      refetchCron();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc, refetchCron]);

  const handleRunCron = useCallback(async (jobId: string) => {
    try {
      await ipc.invoke("openclaw:cron:run", { jobId });
      toast.success("Job triggered");
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc]);

  const handleActivateAgent = useCallback(async (agentId: number) => {
    try {
      await ipc.invoke("joycreate:agents:update", { agentId, status: "active" });
      toast.success("Agent activated");
      refetchJcAgents();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc, refetchJcAgents]);

  const handleDeployAgent = useCallback(async (agentId: number) => {
    try {
      await ipc.invoke("joycreate:agents:deploy", { agentId, target: "local" });
      toast.success("Agent deployed locally");
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    }
  }, [ipc]);

  const handleVerifyCelestia = useCallback(async (cid: string) => {
    try {
      const result = await ipc.verifyIpldReceipt(cid);
      if (result.valid) {
        toast.success("Receipt verified on Celestia ✓");
      } else {
        toast.error("Verification failed");
      }
    } catch (e: any) {
      toast.error(`Verify failed: ${e.message}`);
    }
  }, [ipc]);

  // ── Totals ──
  const totalRunning = subAgents.filter((a) => a.status === "running").length +
    sessions.filter((s) => s.status === "active").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Agent Command Center</h1>
            <p className="text-[11px] text-muted-foreground/70">
              {sessions.length} sessions &middot; {subAgents.length} sub-agents &middot;{" "}
              {cronJobs.length} cron jobs &middot; {jcAgents.length} agents &middot;{" "}
              {celestiaReceipts.length} receipts
              {totalRunning > 0 && (
                <span className="ml-2 text-green-400 font-medium">
                  ⚡ {totalRunning} active
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {wsConnected ? (
            <Badge variant="outline" className="border-green-500/30 text-green-400 text-[10px]">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse" />
              Live
            </Badge>
          ) : (
            <Badge variant="outline" className="border-red-500/30 text-red-400 text-[10px]">
              <WifiOff className="w-3 h-3 mr-1" />
              Offline
            </Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0 border-b border-border/50">
          <ScrollArea>
            <TabsList className="bg-transparent px-4 py-2 w-max">
              <TabsTrigger value="sessions" className="text-xs">
                <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                Sessions
                <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">{sessions.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="subagents" className="text-xs">
                <Bot className="w-3.5 h-3.5 mr-1.5" />
                Sub-Agents
                {subAgents.filter((a) => a.status === "running").length > 0 && (
                  <Badge className="ml-1.5 text-[9px] px-1 py-0 bg-green-600">
                    {subAgents.filter((a) => a.status === "running").length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="cron" className="text-xs">
                <Calendar className="w-3.5 h-3.5 mr-1.5" />
                Cron Jobs
                <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">{cronJobs.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="agents" className="text-xs">
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                JoyCreate Agents
                <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">{jcAgents.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="celestia" className="text-xs">
                <Satellite className="w-3.5 h-3.5 mr-1.5" />
                Celestia DA
                <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">{celestiaReceipts.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </ScrollArea>
        </div>

        <TabsContent value="sessions" className="flex-1 m-0 overflow-auto p-4">
          <SessionsPanel
            sessions={sessions}
            isLoading={sessionsLoading}
            onRefresh={() => refetchSessions()}
            onViewSession={viewSessionHistory}
            onSendMessage={handleSendMessage}
          />
        </TabsContent>

        <TabsContent value="subagents" className="flex-1 m-0 overflow-auto p-4">
          <SubAgentMonitor
            subAgents={subAgents}
            isLoading={subAgentsLoading}
            onRefresh={() => refetchSubAgents()}
            onKill={handleKillSubAgent}
            onSteer={handleSteerSubAgent}
            onViewResult={(agent) => {
              setViewingAgent(agent);
              setResultDialogOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="cron" className="flex-1 m-0 overflow-auto p-4">
          <CronJobsPanel
            jobs={cronJobs}
            isLoading={cronLoading}
            onRefresh={() => refetchCron()}
            onToggle={handleToggleCron}
            onDelete={handleDeleteCron}
            onRun={handleRunCron}
          />
        </TabsContent>

        <TabsContent value="agents" className="flex-1 m-0 overflow-auto p-4">
          <JoyCreateAgentsPanel
            agents={jcAgents}
            isLoading={jcAgentsLoading}
            onRefresh={() => refetchJcAgents()}
            onActivate={handleActivateAgent}
            onViewAgent={(id) => toast.info(`Opening agent ${id}...`)}
            onDeploy={handleDeployAgent}
          />
        </TabsContent>

        <TabsContent value="celestia" className="flex-1 m-0 overflow-auto p-4">
          <CelestiaPanel
            receipts={celestiaReceipts}
            isLoading={celestiaLoading}
            onRefresh={() => refetchCelestia()}
            onVerify={handleVerifyCelestia}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <SessionHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        session={viewingSession}
        history={sessionHistory}
        isLoading={historyLoading}
      />
      <ResultViewerDialog
        open={resultDialogOpen}
        onOpenChange={setResultDialogOpen}
        agent={viewingAgent}
      />
    </div>
  );
}
