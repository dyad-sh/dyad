/**
 * Agent Swarm Page
 * UI for self-replicating, autonomous agent orchestration with witness capabilities
 */

import React, { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus,
  Play,
  Pause,
  Square,
  Trash2,
  RefreshCw,
  Eye,
  GitBranch,
  MessageSquare,
  Brain,
  Activity,
  Settings,
  ChevronRight,
  ChevronDown,
  Users,
  Zap,
  BookOpen,
  Network,
  Copy,
  Send,
  Search,
  Filter,
  MoreVertical,
  Layers,
  Target,
  Cpu,
  Share2,
  Terminal,
  MessagesSquare,
  Info,
  Pencil,
  BrainCircuit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  useAgentSwarmManager,
  useSwarms,
  useAgents,
  useAgent,
  useAgentStats,
  useSwarmStats,
  useWitnesses,
  useKnowledge,
  useMessages,
  useSwarmEvents,
  useInitializeSwarm,
  useSpawnAgent,
  useReplicateAgent,
  useStartWitness,
  useEndWitness,
  useAssignTask,
  useSendMessage,
  useShareKnowledge,
  useExecuteTask,
  useUpdateSwarm,
} from "@/hooks/useAgentSwarm";
import { SwarmNetworkGraph } from "@/components/agent/SwarmNetworkGraph";
import { AgentTaskExecutionView } from "@/components/agent/AgentTaskExecutionView";
import { AgentChatPanel } from "@/components/agent/AgentChatPanel";
import { EnhancedSwarmCommandCenter } from "@/components/agent-swarm/EnhancedSwarmCommandCenter";
import type {
  SwarmId,
  AgentNodeId,
  WitnessId,
  KnowledgeId,
  Swarm,
  AgentNode,
  SwarmConfig,
  SpawnRequest,
  ReplicationRequest,
  ReplicationStrategy,
  WitnessMode,
  AgentRole,
  TaskType,
  MessageType,
  KnowledgeType,
  SwarmEvent,
} from "@/ipc/agent_swarm_client";

// =============================================================================
// CONSTANTS
// =============================================================================

const AGENT_ROLES: { value: AgentRole; label: string; icon: React.ReactNode }[] = [
  { value: "coordinator", label: "Coordinator", icon: <Network className="h-4 w-4" /> },
  { value: "worker", label: "Worker", icon: <Cpu className="h-4 w-4" /> },
  { value: "specialist", label: "Specialist", icon: <Target className="h-4 w-4" /> },
  { value: "scout", label: "Scout", icon: <Search className="h-4 w-4" /> },
  { value: "synthesizer", label: "Synthesizer", icon: <Layers className="h-4 w-4" /> },
  { value: "validator", label: "Validator", icon: <Activity className="h-4 w-4" /> },
  { value: "witness", label: "Witness", icon: <Eye className="h-4 w-4" /> },
  { value: "replicator", label: "Replicator", icon: <Copy className="h-4 w-4" /> },
];

const REPLICATION_STRATEGIES: { value: ReplicationStrategy; label: string; description: string }[] = [
  { value: "clone", label: "Clone", description: "Exact copy of the parent agent" },
  { value: "specialize", label: "Specialize", description: "Copy with narrowed focus" },
  { value: "generalize", label: "Generalize", description: "Copy with broader capabilities" },
  { value: "mutate", label: "Mutate", description: "Copy with random variations" },
  { value: "evolve", label: "Evolve", description: "Copy with learned improvements" },
];

const WITNESS_MODES: { value: WitnessMode; label: string; description: string }[] = [
  { value: "passive", label: "Passive", description: "Just observe, no interference" },
  { value: "learning", label: "Learning", description: "Observe and extract patterns" },
  { value: "coaching", label: "Coaching", description: "Observe and provide feedback" },
  { value: "auditing", label: "Auditing", description: "Observe and validate outputs" },
];

const TASK_TYPES: TaskType[] = ["code", "research", "analysis", "synthesis", "validation", "coordination", "learning", "custom"];

const MESSAGE_TYPES: MessageType[] = [
  "task_assignment",
  "task_result",
  "knowledge_share",
  "status_update",
  "resource_request",
  "coordination",
  "witness_report",
  "replication_request",
  "termination",
  "broadcast",
];

const KNOWLEDGE_TYPES: KnowledgeType[] = [
  "learned_pattern",
  "best_practice",
  "error_recovery",
  "optimization",
  "domain_expertise",
  "tool_usage",
  "user_preference",
];

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-500",
  spawning: "bg-blue-500",
  running: "bg-green-500",
  waiting: "bg-yellow-500",
  observing: "bg-purple-500",
  terminated: "bg-red-500",
  error: "bg-red-600",
  active: "bg-green-500",
  paused: "bg-yellow-500",
  initializing: "bg-blue-500",
  scaling: "bg-cyan-500",
  terminating: "bg-orange-500",
};

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function AgentSwarmPage() {
  const [selectedSwarmId, setSelectedSwarmId] = useState<SwarmId | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentNodeId | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  // Edit swarm state
  const [editingSwarm, setEditingSwarm] = useState<Swarm | null>(null);
  const [editSwarmName, setEditSwarmName] = useState("");
  const [editSwarmDesc, setEditSwarmDesc] = useState("");
  const updateSwarmMutation = useUpdateSwarm();

  // Initialize swarm system
  const initSwarm = useInitializeSwarm();

  useEffect(() => {
    initSwarm.mutate();
  }, []);

  // Queries
  const { data: swarms = [], isLoading: swarmsLoading } = useSwarms();
  const { data: agents = [] } = useAgents(selectedSwarmId ?? undefined);
  const { data: swarmStats } = useSwarmStats(selectedSwarmId ?? undefined);
  const { events } = useSwarmEvents();

  // Auto-select first swarm
  useEffect(() => {
    if (swarms.length > 0 && !selectedSwarmId) {
      setSelectedSwarmId(swarms[0].id);
    }
  }, [swarms, selectedSwarmId]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Network className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Agent Swarm</h1>
              <p className="text-sm text-muted-foreground">
                Self-replicating autonomous agents with witness capabilities
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CreateSwarmDialog />
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Swarm List */}
        <div className="w-64 border-r flex flex-col">
          <div className="p-3 border-b">
            <h2 className="font-medium flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Swarms
            </h2>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {swarmsLoading ? (
                <div className="text-sm text-muted-foreground p-2">Loading...</div>
              ) : swarms.length === 0 ? (
                <div className="text-sm text-muted-foreground p-2">No swarms yet</div>
              ) : (
                swarms.map((swarm) => (
                  <SwarmListItem
                    key={swarm.id}
                    swarm={swarm}
                    isSelected={selectedSwarmId === swarm.id}
                    onSelect={() => {
                      setSelectedSwarmId(swarm.id);
                      setSelectedAgentId(null);
                    }}
                    onEdit={() => {
                      setEditSwarmName(swarm.name);
                      setEditSwarmDesc(swarm.description || "");
                      setEditingSwarm(swarm);
                    }}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Main Content */}
        {selectedSwarmId ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
              <div className="border-b px-4">
                <TabsList className="h-12">
                  <TabsTrigger value="overview" className="gap-2">
                    <Activity className="h-4 w-4" />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="agents" className="gap-2">
                    <Users className="h-4 w-4" />
                    Agents
                  </TabsTrigger>
                  <TabsTrigger value="topology" className="gap-2">
                    <Share2 className="h-4 w-4" />
                    Topology
                  </TabsTrigger>
                  <TabsTrigger value="witnesses" className="gap-2">
                    <Eye className="h-4 w-4" />
                    Witnesses
                  </TabsTrigger>
                  <TabsTrigger value="knowledge" className="gap-2">
                    <BookOpen className="h-4 w-4" />
                    Knowledge
                  </TabsTrigger>
                  <TabsTrigger value="messages" className="gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Messages
                  </TabsTrigger>
                  <TabsTrigger value="events" className="gap-2">
                    <Zap className="h-4 w-4" />
                    Events
                  </TabsTrigger>
                  <TabsTrigger value="command" className="gap-2">
                    <BrainCircuit className="h-4 w-4" />
                    Command Center
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="overview" className="flex-1 overflow-auto p-4 m-0">
                <OverviewTab swarmId={selectedSwarmId} stats={swarmStats} agents={agents} />
              </TabsContent>

              <TabsContent value="agents" className="flex-1 overflow-auto p-4 m-0">
                <AgentsTab
                  swarmId={selectedSwarmId}
                  agents={agents}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={setSelectedAgentId}
                />
              </TabsContent>

              <TabsContent value="topology" className="flex-1 overflow-auto p-4 m-0">
                <TopologyTab
                  agents={agents}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={(id) => {
                    setSelectedAgentId(id);
                    setActiveTab("agents");
                  }}
                />
              </TabsContent>

              <TabsContent value="witnesses" className="flex-1 overflow-auto p-4 m-0">
                <WitnessesTab swarmId={selectedSwarmId} agents={agents} />
              </TabsContent>

              <TabsContent value="knowledge" className="flex-1 overflow-auto p-4 m-0">
                <KnowledgeTab swarmId={selectedSwarmId} agents={agents} />
              </TabsContent>

              <TabsContent value="messages" className="flex-1 overflow-auto p-4 m-0">
                <MessagesTab swarmId={selectedSwarmId} agents={agents} />
              </TabsContent>

              <TabsContent value="events" className="flex-1 overflow-auto p-4 m-0">
                <EventsTab swarmId={selectedSwarmId} events={events} />
              </TabsContent>
              <TabsContent value="command" className="flex-1 overflow-auto m-0">
                <EnhancedSwarmCommandCenter />
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select or create a swarm to get started</p>
            </div>
          </div>
        )}
      </div>

      {/* Edit Swarm Dialog */}
      <Dialog open={!!editingSwarm} onOpenChange={(open) => { if (!open) setEditingSwarm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Swarm</DialogTitle>
            <DialogDescription>Update swarm name and description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={editSwarmName} onChange={(e) => setEditSwarmName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea value={editSwarmDesc} onChange={(e) => setEditSwarmDesc(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSwarm(null)}>Cancel</Button>
            <Button
              disabled={!editSwarmName.trim() || updateSwarmMutation.isPending}
              onClick={() => editingSwarm && updateSwarmMutation.mutate(
                { swarmId: editingSwarm.id, updates: { name: editSwarmName.trim(), description: editSwarmDesc.trim() } },
                { onSuccess: () => { toast.success("Swarm updated"); setEditingSwarm(null); }, onError: (err) => toast.error(`Failed: ${err}`) },
              )}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =============================================================================
// SWARM LIST ITEM
// =============================================================================

function SwarmListItem({
  swarm,
  isSelected,
  onSelect,
  onEdit,
}: {
  swarm: Swarm;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const manager = useAgentSwarmManager(swarm.id);

  return (
    <div
      className={`w-full text-left p-2 rounded-md transition-colors cursor-pointer ${
        isSelected ? "bg-accent" : "hover:bg-muted"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium truncate">{swarm.name}</span>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className={`${STATUS_COLORS[swarm.status]} text-white text-xs`}>
            {swarm.status}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {swarm.status !== "active" && swarm.status !== "running" && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    manager.startSwarm(swarm.id).catch((err: unknown) =>
                      toast.error(`Failed to start: ${err}`)
                    );
                  }}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Start
                </DropdownMenuItem>
              )}
              {(swarm.status === "active" || swarm.status === "running") && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    manager.pauseSwarm(swarm.id).catch((err: unknown) =>
                      toast.error(`Failed to pause: ${err}`)
                    );
                  }}
                >
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  manager.terminateSwarm(swarm.id).catch((err: unknown) =>
                    toast.error(`Failed to terminate: ${err}`)
                  );
                }}
              >
                <Square className="h-4 w-4 mr-2" />
                Terminate
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  manager.deleteSwarm(swarm.id).catch((err: unknown) =>
                    toast.error(`Failed to delete: ${err}`)
                  );
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {swarm.metrics.totalAgents} agents Â· {swarm.metrics.completedTasks} tasks
      </div>
    </div>
  );
}

// =============================================================================
// CREATE SWARM DIALOG
// =============================================================================

function CreateSwarmDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxAgents, setMaxAgents] = useState(50);
  const [maxGenerations, setMaxGenerations] = useState(5);
  const [autoScale, setAutoScale] = useState(true);
  const [replicationEnabled, setReplicationEnabled] = useState(true);
  const [witnessSystemEnabled, setWitnessSystemEnabled] = useState(true);

  const manager = useAgentSwarmManager();

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Swarm name is required");
      return;
    }

    try {
      await manager.createSwarm({
        name: name.trim(),
        description: description.trim() || undefined,
        config: {
          maxAgents,
          maxGenerations,
          autoScale,
          replicationEnabled,
          witnessSystemEnabled,
        },
      });
      toast.success("Swarm created successfully");
      setOpen(false);
      resetForm();
    } catch (error) {
      toast.error(`Failed to create swarm: ${error}`);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setMaxAgents(50);
    setMaxGenerations(5);
    setAutoScale(true);
    setReplicationEnabled(true);
    setWitnessSystemEnabled(true);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create Swarm
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Swarm</DialogTitle>
          <DialogDescription>
            Configure a new self-replicating agent swarm
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Agent Swarm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the purpose of this swarm..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Agents: {maxAgents}</Label>
              <Slider
                value={[maxAgents]}
                onValueChange={([v]) => setMaxAgents(v)}
                min={5}
                max={200}
                step={5}
              />
            </div>
            <div className="space-y-2">
              <Label>Max Generations: {maxGenerations}</Label>
              <Slider
                value={[maxGenerations]}
                onValueChange={([v]) => setMaxGenerations(v)}
                min={1}
                max={10}
                step={1}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="autoScale">Auto-Scale</Label>
              <Switch
                id="autoScale"
                checked={autoScale}
                onCheckedChange={setAutoScale}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="replication">Enable Replication</Label>
              <Switch
                id="replication"
                checked={replicationEnabled}
                onCheckedChange={setReplicationEnabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="witness">Enable Witness System</Label>
              <Switch
                id="witness"
                checked={witnessSystemEnabled}
                onCheckedChange={setWitnessSystemEnabled}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate}>Create Swarm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// OVERVIEW TAB
// =============================================================================

function OverviewTab({
  swarmId,
  stats,
  agents,
}: {
  swarmId: SwarmId;
  stats: any;
  agents: AgentNode[];
}) {
  const manager = useAgentSwarmManager(swarmId);

  const activeAgents = agents.filter((a) => a.status !== "terminated");
  const runningAgents = agents.filter((a) => a.status === "running");

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalAgents ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.activeAgents ?? 0} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tasks Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.completedTasks ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              of {stats?.totalTasks ?? 0} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Replications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalReplications ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.details?.agentsByGeneration?.[1] ?? 0} Gen-1 agents
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Knowledge Entries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.knowledgeEntries ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.details?.totalInsights ?? 0} insights
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <SpawnAgentDialog swarmId={swarmId} />
            <Button
              variant="outline"
              onClick={() => manager.startSwarm(swarmId)}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              Start Swarm
            </Button>
            <Button
              variant="outline"
              onClick={() => manager.pauseSwarm(swarmId)}
              className="gap-2"
            >
              <Pause className="h-4 w-4" />
              Pause Swarm
            </Button>
            <Button
              variant="outline"
              onClick={() => manager.refreshAll()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Agent Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Distribution by Role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {AGENT_ROLES.map((role) => {
              const count = agents.filter((a) => a.role === role.value).length;
              const percentage = agents.length > 0 ? (count / agents.length) * 100 : 0;
              return (
                <div key={role.value} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      {role.icon}
                      {role.label}
                    </span>
                    <span>{count}</span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Generation Tree */}
      <Card>
        <CardHeader>
          <CardTitle>Generation Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 h-32">
            {[0, 1, 2, 3, 4].map((gen) => {
              const count = agents.filter((a) => a.generation === gen).length;
              const maxCount = Math.max(...[0, 1, 2, 3, 4].map((g) => agents.filter((a) => a.generation === g).length), 1);
              const height = (count / maxCount) * 100;
              return (
                <div key={gen} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-primary/20 rounded-t relative"
                    style={{ height: `${height}%`, minHeight: count > 0 ? "8px" : "0" }}
                  >
                    {count > 0 && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs">
                        {count}
                      </span>
                    )}
                  </div>
                  <span className="text-xs mt-1 text-muted-foreground">Gen {gen}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// AGENTS TAB
// =============================================================================

function AgentsTab({
  swarmId,
  agents,
  selectedAgentId,
  onSelectAgent,
}: {
  swarmId: SwarmId;
  agents: AgentNode[];
  selectedAgentId: AgentNodeId | null;
  onSelectAgent: (id: AgentNodeId | null) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      const matchesSearch =
        !searchQuery ||
        agent.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = filterRole === "all" || agent.role === filterRole;
      return matchesSearch && matchesRole;
    });
  }, [agents, searchQuery, filterRole]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <div className="flex gap-4 h-full">
      {/* Agent List */}
      <div className="w-80 flex flex-col border rounded-lg">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            <SpawnAgentDialog swarmId={swarmId} />
          </div>
          <Input
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8"
          />
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {AGENT_ROLES.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {filteredAgents.map((agent) => (
              <AgentListItem
                key={agent.id}
                agent={agent}
                isSelected={selectedAgentId === agent.id}
                onSelect={() => onSelectAgent(agent.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Agent Details */}
      <div className="flex-1">
        {selectedAgent ? (
          <AgentDetails agent={selectedAgent} />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Select an agent to view details
          </div>
        )}
      </div>
    </div>
  );
}

function AgentListItem({
  agent,
  isSelected,
  onSelect,
}: {
  agent: AgentNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const roleInfo = AGENT_ROLES.find((r) => r.value === agent.role);

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-2 rounded-md transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-muted"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {roleInfo?.icon}
          <span className="font-medium truncate">{agent.name}</span>
        </div>
        <Badge
          variant="outline"
          className={`${STATUS_COLORS[agent.status]} text-white text-xs`}
        >
          {agent.status}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
        <span>Gen {agent.generation}</span>
        <span>Â·</span>
        <span>{agent.childIds.length} children</span>
        <span>Â·</span>
        <span>{agent.state.completedTasks} tasks</span>
      </div>
    </button>
  );
}

function AgentDetails({ agent }: { agent: AgentNode }) {
  const { data: stats } = useAgentStats(agent.id);
  const replicateAgent = useReplicateAgent();
  const manager = useAgentSwarmManager();

  const [replicateOpen, setReplicateOpen] = useState(false);
  const [replicationStrategy, setReplicationStrategy] = useState<ReplicationStrategy>("clone");
  const [replicationReason, setReplicationReason] = useState("");
  const [taskFocus, setTaskFocus] = useState("");
  const [detailTab, setDetailTab] = useState("info");

  const handleReplicate = async () => {
    try {
      await replicateAgent.mutateAsync({
        agentId: agent.id,
        request: {
          strategy: replicationStrategy,
          reason: replicationReason || `Manual replication using ${replicationStrategy} strategy`,
          inheritCapabilities: true,
          inheritKnowledge: true,
          taskFocus: taskFocus || undefined,
        },
      });
      toast.success("Agent replicated successfully");
      setReplicateOpen(false);
    } catch (error) {
      toast.error(`Failed to replicate: ${error}`);
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {agent.name}
              <Badge
                variant="outline"
                className={`${STATUS_COLORS[agent.status]} text-white`}
              >
                {agent.status}
              </Badge>
            </CardTitle>
            <CardDescription>
              {AGENT_ROLES.find((r) => r.value === agent.role)?.label} Â· Generation{" "}
              {agent.generation}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {/* Lifecycle controls */}
            {agent.status !== "running" && agent.status !== "terminated" && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() =>
                  manager.startAgent(agent.id).catch((err: unknown) =>
                    toast.error(`Failed to start: ${err}`)
                  )
                }
              >
                <Play className="h-4 w-4" />
                Start
              </Button>
            )}
            {agent.status === "running" && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() =>
                  manager.stopAgent(agent.id).catch((err: unknown) =>
                    toast.error(`Failed to stop: ${err}`)
                  )
                }
              >
                <Pause className="h-4 w-4" />
                Stop
              </Button>
            )}
            <AssignTaskDialog agentId={agent.id} />
            <Dialog open={replicateOpen} onOpenChange={setReplicateOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <GitBranch className="h-4 w-4" />
                  Replicate
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Replicate Agent</DialogTitle>
                  <DialogDescription>
                    Create a new agent based on {agent.name}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Strategy</Label>
                    <Select
                      value={replicationStrategy}
                      onValueChange={(v) => setReplicationStrategy(v as ReplicationStrategy)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REPLICATION_STRATEGIES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            <div>
                              <div className="font-medium">{s.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {s.description}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {replicationStrategy === "specialize" && (
                    <div className="space-y-2">
                      <Label>Task Focus</Label>
                      <Input
                        value={taskFocus}
                        onChange={(e) => setTaskFocus(e.target.value)}
                        placeholder="e.g., debugging, documentation"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Reason (optional)</Label>
                    <Textarea
                      value={replicationReason}
                      onChange={(e) => setReplicationReason(e.target.value)}
                      placeholder="Why are you replicating this agent?"
                      rows={2}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setReplicateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleReplicate}>Replicate</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {agent.status !== "terminated" && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1"
                onClick={() =>
                  manager.terminateAgent(agent.id).catch((err: unknown) =>
                    toast.error(`Failed to terminate: ${err}`)
                  )
                }
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col min-h-0 pt-0">
        <Tabs value={detailTab} onValueChange={setDetailTab} className="flex-1 flex flex-col">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="info" className="gap-1.5">
              <Info className="h-3.5 w-3.5" />
              Info
            </TabsTrigger>
            <TabsTrigger value="execution" className="gap-1.5">
              <Terminal className="h-3.5 w-3.5" />
              Execution
            </TabsTrigger>
            <TabsTrigger value="chat" className="gap-1.5">
              <MessagesSquare className="h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="flex-1 overflow-auto mt-3 space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{stats?.totalTasks ?? 0}</div>
                <div className="text-xs text-muted-foreground">Total Tasks</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{stats?.successfulTasks ?? 0}</div>
                <div className="text-xs text-muted-foreground">Successful</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{stats?.replications ?? 0}</div>
                <div className="text-xs text-muted-foreground">Replications</div>
              </div>
            </div>

            {/* Capabilities */}
            <div>
              <h4 className="font-medium mb-2">Capabilities</h4>
              <div className="flex flex-wrap gap-2">
                {agent.capabilities.length > 0 ? (
                  agent.capabilities.map((cap) => (
                    <Badge key={cap.id} variant="secondary">
                      {cap.name} ({Math.round(cap.proficiency * 100)}%)
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No capabilities defined</span>
                )}
              </div>
            </div>

            {/* Lineage */}
            {agent.lineage.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Lineage</h4>
                <div className="flex items-center gap-1 text-sm">
                  {agent.lineage.map((ancestorId, i) => (
                    <React.Fragment key={ancestorId}>
                      <span className="text-muted-foreground truncate max-w-[100px]">
                        {ancestorId.slice(0, 8)}...
                      </span>
                      {i < agent.lineage.length - 1 && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </React.Fragment>
                  ))}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{agent.name}</span>
                </div>
              </div>
            )}

            {/* Pending Tasks */}
            <div>
              <h4 className="font-medium mb-2">
                Pending Tasks ({agent.state.pendingTasks.length})
              </h4>
              {agent.state.pendingTasks.length > 0 ? (
                <div className="space-y-2">
                  {agent.state.pendingTasks.slice(0, 5).map((task) => (
                    <div
                      key={task.id}
                      className="p-2 border rounded text-sm flex items-center justify-between"
                    >
                      <div>
                        <Badge variant="outline">{task.type}</Badge>
                        <span className="ml-2">{task.description}</span>
                      </div>
                      <Badge
                        variant={task.status === "running" ? "default" : "secondary"}
                      >
                        {task.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">No pending tasks</span>
              )}
            </div>

            {/* Memory Usage */}
            <div>
              <h4 className="font-medium mb-2">Memory</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Short-term</span>
                  <span>{agent.state.memory.shortTerm.length} entries</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Long-term</span>
                  <span>{agent.state.memory.longTerm.length} entries</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Shared Knowledge</span>
                  <span>{agent.state.memory.shared.length} references</span>
                </div>
                <Progress
                  value={(agent.state.memory.used / agent.state.memory.capacity) * 100}
                  className="h-2"
                />
                <div className="text-xs text-muted-foreground text-right">
                  {agent.state.memory.used} / {agent.state.memory.capacity} used
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="execution" className="flex-1 mt-3">
            <AgentTaskExecutionView
              agentId={agent.id}
              activeTasks={agent.state.pendingTasks.map((t) => ({
                id: t.id,
                description: t.description,
                status: t.status,
              }))}
            />
          </TabsContent>

          <TabsContent value="chat" className="flex-1 mt-3">
            <AgentChatPanel agentId={agent.id} agentName={agent.name} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// ASSIGN TASK DIALOG
// =============================================================================

function AssignTaskDialog({ agentId }: { agentId: AgentNodeId }) {
  const [open, setOpen] = useState(false);
  const [taskType, setTaskType] = useState<TaskType>("custom");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(5);
  const assignTask = useAssignTask();

  const handleAssign = async () => {
    if (!description.trim()) {
      toast.error("Task description is required");
      return;
    }
    try {
      await assignTask.mutateAsync({
        agentId,
        task: {
          type: taskType,
          description: description.trim(),
          priority,
        },
      });
      toast.success("Task assigned");
      setOpen(false);
      setDescription("");
      setPriority(5);
    } catch (error) {
      toast.error(`Failed to assign task: ${error}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Target className="h-4 w-4" />
          Assign Task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Task</DialogTitle>
          <DialogDescription>Assign a new task to this agent for execution</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Task Type</Label>
            <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what the agent should do..."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Priority: {priority}</Label>
            <Slider
              value={[priority]}
              onValueChange={([v]) => setPriority(v)}
              min={1}
              max={10}
              step={1}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={assignTask.isPending}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// TOPOLOGY TAB
// =============================================================================

function TopologyTab({
  agents,
  selectedAgentId,
  onSelectAgent,
}: {
  agents: AgentNode[];
  selectedAgentId: AgentNodeId | null;
  onSelectAgent: (id: AgentNodeId) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Network Topology
          </CardTitle>
          <CardDescription>
            Visual representation of the agent hierarchy. Click a node to view its details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SwarmNetworkGraph
            agents={agents}
            selectedAgentId={selectedAgentId ?? undefined}
            onSelectAgent={onSelectAgent}
          />
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-xs">
            {AGENT_ROLES.map((role) => (
              <div key={role.value} className="flex items-center gap-1.5">
                {role.icon}
                <span>{role.label}</span>
              </div>
            ))}
          </div>
          <Separator className="my-2" />
          <div className="flex flex-wrap gap-3 text-xs">
            {Object.entries({ idle: "#6b7280", running: "#22c55e", busy: "#f59e0b", stopped: "#ef4444", terminated: "#991b1b" }).map(
              ([status, color]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="capitalize">{status}</span>
                </div>
              )
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// SPAWN AGENT DIALOG
// =============================================================================

function SpawnAgentDialog({
  swarmId,
  parentId,
}: {
  swarmId: SwarmId;
  parentId?: AgentNodeId;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<AgentRole>("worker");
  const [modelId, setModelId] = useState("gpt-5-mini");
  const [temperature, setTemperature] = useState(0.7);
  const [systemPrompt, setSystemPrompt] = useState("");

  const spawnAgent = useSpawnAgent();

  const handleSpawn = async () => {
    if (!name.trim()) {
      toast.error("Agent name is required");
      return;
    }

    try {
      await spawnAgent.mutateAsync({
        swarmId,
        request: {
          name: name.trim(),
          role,
          config: {
            modelId,
            temperature,
            systemPrompt: systemPrompt.trim() || undefined,
          },
        },
        parentId,
      });
      toast.success("Agent spawned successfully");
      setOpen(false);
      resetForm();
    } catch (error) {
      toast.error(`Failed to spawn agent: ${error}`);
    }
  };

  const resetForm = () => {
    setName("");
    setRole("worker");
    setModelId("gpt-5-mini");
    setTemperature(0.7);
    setSystemPrompt("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus className="h-4 w-4" />
          Spawn Agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Spawn New Agent</DialogTitle>
          <DialogDescription>
            Create a new agent in this swarm
            {parentId && " as a child of the selected agent"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AgentRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    <div className="flex items-center gap-2">
                      {r.icon}
                      {r.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-5.1">GPT 5.1</SelectItem>
                <SelectItem value="gpt-5-mini">GPT 5 Mini</SelectItem>
                <SelectItem value="gpt-5.1-codex">GPT 5.1 Codex</SelectItem>
                <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
                <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Temperature: {temperature.toFixed(1)}</Label>
            <Slider
              value={[temperature]}
              onValueChange={([v]) => setTemperature(v)}
              min={0}
              max={1}
              step={0.1}
            />
          </div>

          <div className="space-y-2">
            <Label>System Prompt (optional)</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Custom instructions for this agent..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSpawn}>Spawn Agent</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// WITNESSES TAB
// =============================================================================

function WitnessesTab({
  swarmId,
  agents,
}: {
  swarmId: SwarmId;
  agents: AgentNode[];
}) {
  const { data: witnesses = [] } = useWitnesses();
  const startWitness = useStartWitness();
  const endWitness = useEndWitness();

  const [createOpen, setCreateOpen] = useState(false);
  const [observerId, setObserverId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [mode, setMode] = useState<WitnessMode>("learning");

  const swarmWitnesses = witnesses.filter((w) => {
    const observer = agents.find((a) => a.id === w.observerId);
    return observer?.swarmId === swarmId;
  });

  const handleCreate = async () => {
    if (!observerId || !targetId) {
      toast.error("Select both observer and target agents");
      return;
    }

    try {
      await startWitness.mutateAsync({
        observerId: observerId as AgentNodeId,
        targetId: targetId as AgentNodeId,
        mode,
      });
      toast.success("Witness session started");
      setCreateOpen(false);
    } catch (error) {
      toast.error(`Failed to start witness: ${error}`);
    }
  };

  const handleEnd = async (witnessId: WitnessId) => {
    try {
      await endWitness.mutateAsync(witnessId);
      toast.success("Witness session ended");
    } catch (error) {
      toast.error(`Failed to end witness: ${error}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Active Witness Sessions</h3>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Eye className="h-4 w-4" />
              Start Witness
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start Witness Session</DialogTitle>
              <DialogDescription>
                Have one agent observe and learn from another
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Observer Agent</Label>
                <Select value={observerId} onValueChange={setObserverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select observer" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents
                      .filter((a) => a.status !== "terminated")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target Agent</Label>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents
                      .filter((a) => a.status !== "terminated" && a.id !== observerId)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as WitnessMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WITNESS_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        <div>
                          <div className="font-medium">{m.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {m.description}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate}>Start Witness</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {swarmWitnesses.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No active witness sessions
          </div>
        ) : (
          swarmWitnesses.map((witness) => {
            const observer = agents.find((a) => a.id === witness.observerId);
            const target = agents.find((a) => a.id === witness.targetId);
            return (
              <Card key={witness.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="text-sm">
                        <span className="font-medium">{observer?.name ?? "Unknown"}</span>
                        <span className="text-muted-foreground mx-2">observing</span>
                        <span className="font-medium">{target?.name ?? "Unknown"}</span>
                      </div>
                      <Badge variant="outline">{witness.mode}</Badge>
                      <Badge
                        variant={witness.status === "active" ? "default" : "secondary"}
                      >
                        {witness.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {witness.observations.length} observations Â· {witness.insights.length}{" "}
                        insights
                      </span>
                      {witness.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEnd(witness.id)}
                        >
                          End
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

// =============================================================================
// KNOWLEDGE TAB
// =============================================================================

function KnowledgeTab({
  swarmId,
  agents,
}: {
  swarmId: SwarmId;
  agents: AgentNode[];
}) {
  const { data: knowledge = [] } = useKnowledge(swarmId);
  const shareKnowledge = useShareKnowledge();

  const [createOpen, setCreateOpen] = useState(false);
  const [contributorId, setContributorId] = useState("");
  const [knowledgeType, setKnowledgeType] = useState<KnowledgeType>("learned_pattern");
  const [content, setContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredKnowledge = useMemo(() => {
    if (!searchQuery) return knowledge;
    return knowledge.filter(
      (k) =>
        k.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        k.type.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [knowledge, searchQuery]);

  const handleShare = async () => {
    if (!contributorId || !content.trim()) {
      toast.error("Select a contributor and enter content");
      return;
    }

    try {
      await shareKnowledge.mutateAsync({
        contributorId: contributorId as AgentNodeId,
        type: knowledgeType,
        content: content.trim(),
      });
      toast.success("Knowledge shared");
      setCreateOpen(false);
      setContent("");
    } catch (error) {
      toast.error(`Failed to share knowledge: ${error}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search knowledge..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Share2 className="h-4 w-4" />
              Share Knowledge
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share Knowledge</DialogTitle>
              <DialogDescription>
                Share learned knowledge with other agents in the swarm
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Contributor</Label>
                <Select value={contributorId} onValueChange={setContributorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select contributor" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents
                      .filter((a) => a.status !== "terminated")
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={knowledgeType}
                  onValueChange={(v) => setKnowledgeType(v as KnowledgeType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KNOWLEDGE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Content</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter the knowledge to share..."
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleShare}>Share</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {filteredKnowledge.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No shared knowledge yet
          </div>
        ) : (
          filteredKnowledge.map((k) => {
            const contributor = agents.find((a) => a.id === k.contributorId);
            return (
              <Card key={k.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{k.type.replace(/_/g, " ")}</Badge>
                        <span className="text-xs text-muted-foreground">
                          by {contributor?.name ?? "Unknown"}
                        </span>
                      </div>
                      <p className="text-sm">{k.content}</p>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <div>{k.usageCount} uses</div>
                      <div>â˜… {k.rating.toFixed(1)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MESSAGES TAB
// =============================================================================

function MessagesTab({
  swarmId,
  agents,
}: {
  swarmId: SwarmId;
  agents: AgentNode[];
}) {
  const { data: messages = [] } = useMessages(undefined, swarmId);
  const sendMessage = useSendMessage();

  const [createOpen, setCreateOpen] = useState(false);
  const [senderId, setSenderId] = useState("system");
  const [recipientId, setRecipientId] = useState("broadcast");
  const [messageType, setMessageType] = useState<MessageType>("broadcast");
  const [payload, setPayload] = useState("");

  const handleSend = async () => {
    if (!payload.trim()) {
      toast.error("Enter a message");
      return;
    }

    try {
      await sendMessage.mutateAsync({
        senderId: senderId === "system" ? "system" : (senderId as AgentNodeId),
        recipientId:
          recipientId === "broadcast" ? "broadcast" : (recipientId as AgentNodeId),
        swarmId,
        type: messageType,
        payload: { message: payload.trim() },
      });
      toast.success("Message sent");
      setCreateOpen(false);
      setPayload("");
    } catch (error) {
      toast.error(`Failed to send message: ${error}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Messages ({messages.length})</h3>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Send className="h-4 w-4" />
              Send Message
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send Message</DialogTitle>
              <DialogDescription>
                Send a message to agents in the swarm
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>From</Label>
                  <Select value={senderId} onValueChange={setSenderId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">System</SelectItem>
                      {agents
                        .filter((a) => a.status !== "terminated")
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Select value={recipientId} onValueChange={setRecipientId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="broadcast">Broadcast (All)</SelectItem>
                      {agents
                        .filter((a) => a.status !== "terminated")
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={messageType}
                  onValueChange={(v) => setMessageType(v as MessageType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MESSAGE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  placeholder="Enter your message..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSend}>Send</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="h-[500px]">
        <div className="space-y-2">
          {messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No messages yet
            </div>
          ) : (
            messages.map((msg) => {
              const sender =
                msg.senderId === "system"
                  ? { name: "System" }
                  : agents.find((a) => a.id === msg.senderId);
              const recipient =
                msg.recipientId === "broadcast"
                  ? { name: "All Agents" }
                  : agents.find((a) => a.id === msg.recipientId);
              return (
                <Card key={msg.id}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{sender?.name ?? "Unknown"}</span>
                          <span className="text-muted-foreground">â†’</span>
                          <span className="font-medium">{recipient?.name ?? "Unknown"}</span>
                          <Badge variant="outline" className="text-xs">
                            {msg.type.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="text-sm">
                          {typeof msg.payload === "object" && (msg.payload as any)?.message
                            ? (msg.payload as any).message
                            : JSON.stringify(msg.payload)}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// EVENTS TAB
// =============================================================================

function EventsTab({
  swarmId,
  events,
}: {
  swarmId: SwarmId;
  events: SwarmEvent[];
}) {
  const swarmEvents = events.filter((e) => e.swarmId === swarmId);

  const getEventIcon = (type: string) => {
    if (type.startsWith("swarm:")) return <Layers className="h-4 w-4" />;
    if (type.startsWith("agent:")) return <Cpu className="h-4 w-4" />;
    if (type.startsWith("task:")) return <Target className="h-4 w-4" />;
    if (type.startsWith("witness:")) return <Eye className="h-4 w-4" />;
    if (type.startsWith("message:")) return <MessageSquare className="h-4 w-4" />;
    if (type.startsWith("knowledge:")) return <BookOpen className="h-4 w-4" />;
    return <Zap className="h-4 w-4" />;
  };

  const getEventColor = (type: string) => {
    if (type.includes("created") || type.includes("spawned")) return "text-green-500";
    if (type.includes("terminated") || type.includes("failed")) return "text-red-500";
    if (type.includes("completed")) return "text-blue-500";
    if (type.includes("started")) return "text-cyan-500";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Recent Events ({swarmEvents.length})</h3>
      </div>

      <ScrollArea className="h-[500px]">
        <div className="space-y-1">
          {swarmEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No events yet
            </div>
          ) : (
            swarmEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 p-2 hover:bg-muted rounded"
              >
                <div className={getEventColor(event.type)}>{getEventIcon(event.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{event.type}</span>
                    {event.agentId && (
                      <span className="text-xs text-muted-foreground truncate">
                        {event.agentId.slice(0, 8)}...
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {JSON.stringify(event.data).slice(0, 100)}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
