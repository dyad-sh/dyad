/**
 * Autonomous Agent Page
 * Full UI for the perpetually growing AI system
 */

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import {
  Bot,
  Play,
  Pause,
  StopCircle,
  Copy,
  Plus,
  Zap,
  Brain,
  Network,
  Target,
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  Mic,
  Volume2,
  Code,
  Layout,
  Database,
  Globe,
  Sparkles,
  TrendingUp,
  GitBranch,
  Eye,
  FileCode,
  Folder,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Settings,
  BarChart3,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useAutonomousAgents,
  useAutonomousAgent,
  useAgentStats,
  useCreateAutonomousAgent,
  useActivateAgent,
  useTerminateAgent,
  useReplicateAgent,
  useMissions,
  useMission,
  useCreateMission,
  useArtifacts,
  useAgentEvents,
  useAutonomousAgentEvents,
  useInitializeAutonomousSystem,
} from "@/hooks/useAutonomousAgent";
import type {
  AutonomousAgentId,
  MissionId,
  AutonomousAgent,
  Mission,
  MissionType,
  AgentLifecycleState,
  MissionStatus,
  AutonomousAgentEvent,
} from "@/ipc/autonomous_agent_client";

// =============================================================================
// CONSTANTS
// =============================================================================

const MISSION_TYPES: { value: MissionType; label: string; icon: React.ReactNode }[] = [
  { value: "research", label: "Research", icon: <Globe className="h-4 w-4" /> },
  { value: "build", label: "Build", icon: <Code className="h-4 w-4" /> },
  { value: "analyze", label: "Analyze", icon: <BarChart3 className="h-4 w-4" /> },
  { value: "optimize", label: "Optimize", icon: <TrendingUp className="h-4 w-4" /> },
  { value: "integrate", label: "Integrate", icon: <Network className="h-4 w-4" /> },
  { value: "automate", label: "Automate", icon: <Zap className="h-4 w-4" /> },
  { value: "evolve", label: "Evolve", icon: <Sparkles className="h-4 w-4" /> },
  { value: "replicate", label: "Replicate", icon: <Copy className="h-4 w-4" /> },
];

const STATE_COLORS: Record<AgentLifecycleState, string> = {
  dormant: "bg-gray-500",
  initializing: "bg-blue-500 animate-pulse",
  active: "bg-green-500",
  learning: "bg-purple-500 animate-pulse",
  evolving: "bg-amber-500 animate-pulse",
  replicating: "bg-cyan-500 animate-pulse",
  hibernating: "bg-yellow-500",
  terminated: "bg-red-500",
};

const STATUS_COLORS: Record<MissionStatus, string> = {
  pending: "bg-gray-500",
  planning: "bg-blue-500",
  executing: "bg-green-500 animate-pulse",
  validating: "bg-purple-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  abandoned: "bg-orange-500",
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function AutonomousAgentPage() {
  const [selectedAgentId, setSelectedAgentId] = useState<AutonomousAgentId | null>(null);
  const [selectedMissionId, setSelectedMissionId] = useState<MissionId | null>(null);
  const [isCreateAgentOpen, setIsCreateAgentOpen] = useState(false);
  const [isCreateMissionOpen, setIsCreateMissionOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryCount, setInitRetryCount] = useState(0);

  const { data: agents = [], isLoading: isLoadingAgents, refetch: refetchAgents } = useAutonomousAgents();
  const { data: selectedAgent } = useAutonomousAgent(selectedAgentId || undefined);
  const { data: agentStats } = useAgentStats(selectedAgentId || undefined);
  const { data: missions = [] } = useMissions(selectedAgentId || undefined);
  const { data: selectedMission } = useMission(selectedMissionId || undefined);
  const { data: artifacts = [] } = useArtifacts(selectedMissionId || undefined);
  const { data: agentEvents = [] } = useAgentEvents(selectedAgentId || undefined);
  const { events: liveEvents, latestEvent } = useAutonomousAgentEvents();

  const initializeSystem = useInitializeAutonomousSystem();
  const createAgent = useCreateAutonomousAgent();
  const activateAgent = useActivateAgent();
  const terminateAgent = useTerminateAgent();
  const replicateAgent = useReplicateAgent();
  const createMission = useCreateMission();

  // Initialize system on mount (with retry support)
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setInitError(null);
      try {
        await initializeSystem.mutateAsync();
        if (!cancelled) setIsInitialized(true);
      } catch (error) {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          setInitError(msg);
          toast.error(`Failed to initialize autonomous system: ${msg}`);
        }
      }
    };
    init();
    return () => { cancelled = true; };
  }, [initRetryCount]);

  // Show toast on new events
  useEffect(() => {
    if (latestEvent) {
      const eventMessages: Record<string, string> = {
        "agent:created": "New agent created",
        "agent:activated": "Agent activated",
        "mission:started": "Mission started",
        "mission:completed": "Mission completed successfully!",
        "mission:failed": "Mission failed",
        "evolution:completed": "Agent evolved!",
        "replication:completed": "New offspring created!",
        "artifact:created": "New artifact generated",
      };
      
      const message = eventMessages[latestEvent.type];
      if (message) {
        if (latestEvent.type.includes("failed")) {
          toast.error(message);
        } else if (latestEvent.type.includes("completed")) {
          toast.success(message);
        } else {
          toast.info(message);
        }
      }
    }
  }, [latestEvent]);

  const handleCreateAgent = async (data: {
    name: string;
    purpose: string;
    autonomyLevel: "supervised" | "semi-autonomous" | "fully-autonomous";
    voiceEnabled: boolean;
    learningEnabled: boolean;
    canEvolve: boolean;
    canReplicate: boolean;
  }) => {
    try {
      const agent = await createAgent.mutateAsync({
        name: data.name,
        purpose: data.purpose,
        config: {
          autonomyLevel: data.autonomyLevel,
          voiceEnabled: data.voiceEnabled,
          learningEnabled: data.learningEnabled,
          canEvolve: data.canEvolve,
          canReplicate: data.canReplicate,
        },
      });
      setSelectedAgentId(agent.id);
      setIsCreateAgentOpen(false);
      toast.success("Agent created successfully!");
    } catch (error) {
      toast.error("Failed to create agent");
    }
  };

  const handleActivateAgent = async (agentId: AutonomousAgentId) => {
    try {
      await activateAgent.mutateAsync(agentId);
      toast.success("Agent activated!");
    } catch (error) {
      toast.error("Failed to activate agent");
    }
  };

  const handleTerminateAgent = async (agentId: AutonomousAgentId) => {
    try {
      await terminateAgent.mutateAsync(agentId);
      toast.success("Agent terminated");
    } catch (error) {
      toast.error("Failed to terminate agent");
    }
  };

  const handleReplicateAgent = async (agentId: AutonomousAgentId, specialization?: string) => {
    try {
      const offspring = await replicateAgent.mutateAsync({ agentId, specialization });
      toast.success("Agent replicated!");
      setSelectedAgentId(offspring.id);
    } catch (error) {
      toast.error("Failed to replicate agent");
    }
  };

  const handleCreateMission = async (data: {
    type: MissionType;
    objective: string;
    context: string;
  }) => {
    if (!selectedAgentId) return;
    
    try {
      const mission = await createMission.mutateAsync({
        agentId: selectedAgentId,
        type: data.type,
        objective: data.objective,
        context: data.context,
      });
      setSelectedMissionId(mission.id);
      setIsCreateMissionOpen(false);
      toast.success("Mission created!");
    } catch (error) {
      toast.error("Failed to create mission");
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          {initError ? (
            <>
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-destructive font-medium">Failed to initialize</p>
              <p className="max-w-md text-center text-sm text-muted-foreground">{initError}</p>
              <Button
                variant="outline"
                onClick={() => setInitRetryCount((c) => c + 1)}
                disabled={initializeSystem.isPending}
              >
                {initializeSystem.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Retry Initialization
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Initializing Autonomous Agent System...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Autonomous Agents</h1>
            <p className="text-sm text-muted-foreground">
              Self-replicating, perpetually growing AI system
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetchAgents()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateAgentOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Agent
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Agent List */}
        <div className="w-80 border-r">
          <div className="p-4">
            <h2 className="font-medium">Active Agents ({agents.length})</h2>
          </div>
          <ScrollArea className="h-[calc(100vh-12rem)]">
            <div className="space-y-2 p-4 pt-0">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  isSelected={selectedAgentId === agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                />
              ))}
              {agents.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Bot className="mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No agents yet</p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setIsCreateAgentOpen(true)}
                  >
                    Create your first agent
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden">
          {selectedAgent ? (
            <AgentDetailView
              agent={selectedAgent}
              stats={agentStats}
              missions={missions}
              selectedMission={selectedMission}
              artifacts={artifacts}
              events={agentEvents}
              onActivate={() => handleActivateAgent(selectedAgent.id)}
              onTerminate={() => handleTerminateAgent(selectedAgent.id)}
              onReplicate={(spec) => handleReplicateAgent(selectedAgent.id, spec)}
              onSelectMission={setSelectedMissionId}
              onCreateMission={() => setIsCreateMissionOpen(true)}
              isActivating={activateAgent.isPending}
              isTerminating={terminateAgent.isPending}
              isReplicating={replicateAgent.isPending}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-4 text-center">
                <Network className="h-16 w-16 text-muted-foreground/50" />
                <div>
                  <h3 className="font-medium">No Agent Selected</h3>
                  <p className="text-sm text-muted-foreground">
                    Select an agent from the sidebar or create a new one
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar - Live Events */}
        <div className="w-80 border-l">
          <div className="p-4">
            <h2 className="font-medium">Live Events</h2>
          </div>
          <ScrollArea className="h-[calc(100vh-12rem)]">
            <div className="space-y-2 p-4 pt-0">
              {liveEvents.slice(0, 50).map((event, i) => (
                <EventCard key={`${event.timestamp}-${i}`} event={event} />
              ))}
              {liveEvents.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No events yet
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Create Agent Dialog */}
      <CreateAgentDialog
        open={isCreateAgentOpen}
        onOpenChange={setIsCreateAgentOpen}
        onSubmit={handleCreateAgent}
        isSubmitting={createAgent.isPending}
      />

      {/* Create Mission Dialog */}
      <CreateMissionDialog
        open={isCreateMissionOpen}
        onOpenChange={setIsCreateMissionOpen}
        onSubmit={handleCreateMission}
        isSubmitting={createMission.isPending}
      />
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function AgentCard({
  agent,
  isSelected,
  onClick,
}: {
  agent: AutonomousAgent;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isSelected && "border-primary ring-1 ring-primary"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-600">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                  STATE_COLORS[agent.state]
                )}
              />
            </div>
            <div>
              <p className="font-medium">{agent.name}</p>
              <p className="text-xs text-muted-foreground">
                Gen {agent.generation} · {agent.capabilities.length} capabilities
              </p>
            </div>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {agent.purpose}
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          <Badge variant="outline" className="text-xs">
            {agent.state}
          </Badge>
          {agent.config.voiceEnabled && (
            <Badge variant="secondary" className="text-xs">
              <Mic className="mr-1 h-3 w-3" />
              Voice
            </Badge>
          )}
          {agent.config.canEvolve && (
            <Badge variant="secondary" className="text-xs">
              <Sparkles className="mr-1 h-3 w-3" />
              Evolve
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentDetailView({
  agent,
  stats,
  missions,
  selectedMission,
  artifacts,
  events,
  onActivate,
  onTerminate,
  onReplicate,
  onSelectMission,
  onCreateMission,
  isActivating,
  isTerminating,
  isReplicating,
}: {
  agent: AutonomousAgent;
  stats?: ReturnType<typeof useAgentStats>["data"];
  missions: Mission[];
  selectedMission?: Mission;
  artifacts: any[];
  events: AutonomousAgentEvent[];
  onActivate: () => void;
  onTerminate: () => void;
  onReplicate: (specialization?: string) => void;
  onSelectMission: (id: MissionId | null) => void;
  onCreateMission: () => void;
  isActivating: boolean;
  isTerminating: boolean;
  isReplicating: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Agent Header */}
      <div className="border-b p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600">
                <Bot className="h-8 w-8 text-white" />
              </div>
              <div
                className={cn(
                  "absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-background",
                  STATE_COLORS[agent.state]
                )}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold">{agent.name}</h2>
                <Badge variant="outline">Gen {agent.generation}</Badge>
              </div>
              <p className="text-muted-foreground">{agent.purpose}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {agent.state === "dormant" && (
              <Button onClick={onActivate} disabled={isActivating}>
                {isActivating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Activate
              </Button>
            )}
            {agent.state === "active" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => onReplicate()}
                  disabled={isReplicating}
                >
                  {isReplicating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  Replicate
                </Button>
                <Button
                  variant="destructive"
                  onClick={onTerminate}
                  disabled={isTerminating}
                >
                  {isTerminating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <StopCircle className="mr-2 h-4 w-4" />
                  )}
                  Terminate
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mt-6 grid grid-cols-6 gap-4">
          <StatCard
            icon={<Target className="h-4 w-4" />}
            label="Missions"
            value={stats?.totalMissions || 0}
            subValue={`${stats?.successfulMissions || 0} successful`}
          />
          <StatCard
            icon={<Activity className="h-4 w-4" />}
            label="Actions"
            value={stats?.totalActions || 0}
            subValue={`${stats?.actionsPerHour || 0}/hr`}
          />
          <StatCard
            icon={<Brain className="h-4 w-4" />}
            label="Knowledge"
            value={stats?.knowledgeEntries || 0}
            subValue={`${stats?.patternsDiscovered || 0} patterns`}
          />
          <StatCard
            icon={<Sparkles className="h-4 w-4" />}
            label="Evolutions"
            value={stats?.evolutions || 0}
          />
          <StatCard
            icon={<GitBranch className="h-4 w-4" />}
            label="Replications"
            value={stats?.replications || 0}
          />
          <StatCard
            icon={<Mic className="h-4 w-4" />}
            label="Voice"
            value={stats?.transcriptionsProcessed || 0}
            subValue={`${stats?.speechSynthesized || 0} synth`}
          />
        </div>
      </div>

      {/* Tabs Content */}
      <Tabs defaultValue="missions" className="flex-1 overflow-hidden">
        <div className="border-b px-6">
          <TabsList>
            <TabsTrigger value="missions">Missions</TabsTrigger>
            <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            <TabsTrigger value="config">Configuration</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="missions" className="mt-0 h-full">
            <MissionsTab
              missions={missions}
              selectedMission={selectedMission}
              onSelectMission={onSelectMission}
              onCreateMission={onCreateMission}
            />
          </TabsContent>

          <TabsContent value="capabilities" className="mt-0 h-full">
            <CapabilitiesTab capabilities={agent.capabilities} />
          </TabsContent>

          <TabsContent value="knowledge" className="mt-0 h-full">
            <KnowledgeTab knowledge={agent.knowledge} />
          </TabsContent>

          <TabsContent value="artifacts" className="mt-0 h-full">
            <ArtifactsTab artifacts={artifacts} />
          </TabsContent>

          <TabsContent value="config" className="mt-0 h-full">
            <ConfigTab config={agent.config} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subValue,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subValue?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        {subValue && (
          <p className="text-xs text-muted-foreground">{subValue}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MissionsTab({
  missions,
  selectedMission,
  onSelectMission,
  onCreateMission,
}: {
  missions: Mission[];
  selectedMission?: Mission;
  onSelectMission: (id: MissionId | null) => void;
  onCreateMission: () => void;
}) {
  return (
    <div className="flex h-full">
      {/* Mission List */}
      <div className="w-80 border-r">
        <div className="flex items-center justify-between p-4">
          <h3 className="font-medium">Missions ({missions.length})</h3>
          <Button size="sm" onClick={onCreateMission}>
            <Plus className="mr-1 h-3 w-3" />
            New
          </Button>
        </div>
        <ScrollArea className="h-[calc(100%-4rem)]">
          <div className="space-y-2 p-4 pt-0">
            {missions.map((mission) => (
              <Card
                key={mission.id}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  selectedMission?.id === mission.id && "border-primary ring-1 ring-primary"
                )}
                onClick={() => onSelectMission(mission.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {mission.type}
                    </Badge>
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        STATUS_COLORS[mission.status]
                      )}
                    />
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-medium">
                    {mission.objective}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {mission.phases.length} phases · {mission.actionsPerformed} actions
                  </p>
                </CardContent>
              </Card>
            ))}
            {missions.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No missions yet
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Mission Detail */}
      <div className="flex-1 overflow-auto p-6">
        {selectedMission ? (
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2">
                <Badge className={cn(STATUS_COLORS[selectedMission.status])}>
                  {selectedMission.status}
                </Badge>
                <Badge variant="outline">{selectedMission.type}</Badge>
              </div>
              <h3 className="mt-2 text-xl font-bold">{selectedMission.objective}</h3>
              {selectedMission.context && (
                <p className="mt-2 text-muted-foreground">{selectedMission.context}</p>
              )}
            </div>

            <div>
              <h4 className="font-medium">Phases</h4>
              <div className="mt-2 space-y-2">
                {selectedMission.phases.map((phase, i) => (
                  <Card key={phase.id}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs">
                            {i + 1}
                          </span>
                          <span className="font-medium">{phase.name}</span>
                        </div>
                        <Badge
                          variant={phase.status === "completed" ? "default" : "outline"}
                          className="text-xs"
                        >
                          {phase.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {phase.description}
                      </p>
                      {phase.actions.length > 0 && (
                        <div className="mt-2">
                          <Progress
                            value={
                              (phase.actions.filter((a) => a.status === "completed").length /
                                phase.actions.length) *
                              100
                            }
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {phase.actions.filter((a) => a.status === "completed").length} /{" "}
                            {phase.actions.length} actions
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">Select a mission to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CapabilitiesTab({ capabilities }: { capabilities: any[] }) {
  return (
    <ScrollArea className="h-full">
      <div className="grid grid-cols-3 gap-4 p-6">
        {capabilities.map((cap) => (
          <Card key={cap.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline">{cap.type}</Badge>
                <Switch checked={cap.enabled} />
              </div>
              <h4 className="mt-2 font-medium">{cap.name}</h4>
              <p className="text-sm text-muted-foreground">{cap.description}</p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs">
                  <span>Proficiency</span>
                  <span>{Math.round(cap.proficiency * 100)}%</span>
                </div>
                <Progress value={cap.proficiency * 100} className="mt-1" />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Used {cap.usageCount} times</span>
                <span>{Math.round(cap.successRate * 100)}% success</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

function KnowledgeTab({ knowledge }: { knowledge: any }) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-6">
        <div>
          <h4 className="font-medium">Learned Patterns ({knowledge.patterns?.length || 0})</h4>
          <div className="mt-2 grid gap-2">
            {knowledge.patterns?.slice(0, 10).map((pattern: any) => (
              <Card key={pattern.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{pattern.type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(pattern.confidence * 100)}% confident
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{pattern.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-medium">Skills ({knowledge.skills?.length || 0})</h4>
          <div className="mt-2 grid gap-2">
            {knowledge.skills?.slice(0, 10).map((skill: any) => (
              <Card key={skill.id}>
                <CardContent className="p-3">
                  <h5 className="font-medium">{skill.name}</h5>
                  <p className="text-sm text-muted-foreground">{skill.description}</p>
                  <Progress value={skill.proficiency * 100} className="mt-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-medium">Error Recoveries ({knowledge.errorRecoveries?.length || 0})</h4>
          <div className="mt-2 grid gap-2">
            {knowledge.errorRecoveries?.slice(0, 5).map((recovery: any) => (
              <Card key={recovery.id}>
                <CardContent className="p-3">
                  <Badge variant="destructive" className="text-xs">
                    {recovery.errorType}
                  </Badge>
                  <p className="mt-1 text-sm">{recovery.recoveryStrategy}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Math.round(recovery.successRate * 100)}% success rate
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function ArtifactsTab({ artifacts }: { artifacts: any[] }) {
  return (
    <ScrollArea className="h-full">
      <div className="grid grid-cols-3 gap-4 p-6">
        {artifacts.map((artifact) => (
          <Card key={artifact.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                {artifact.type === "code" && <FileCode className="h-4 w-4" />}
                {artifact.type === "component" && <Layout className="h-4 w-4" />}
                {artifact.type === "dataset" && <Database className="h-4 w-4" />}
                {artifact.type === "documentation" && <Folder className="h-4 w-4" />}
                <Badge variant="outline">{artifact.type}</Badge>
              </div>
              <h4 className="mt-2 font-medium">{artifact.name}</h4>
              <p className="text-sm text-muted-foreground">{artifact.description}</p>
              {artifact.validated && (
                <Badge variant="default" className="mt-2">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Validated
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
        {artifacts.length === 0 && (
          <p className="col-span-3 py-8 text-center text-muted-foreground">
            No artifacts generated yet
          </p>
        )}
      </div>
    </ScrollArea>
  );
}

function ConfigTab({ config }: { config: any }) {
  return (
    <ScrollArea className="h-full">
      <div className="max-w-5xl space-y-6 p-6">
        <div className="space-y-4">
          <h4 className="font-medium">AI Model</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Primary Model</Label>
              <Input value={config.primaryModel} readOnly />
            </div>
            <div>
              <Label>Temperature</Label>
              <Input value={config.temperature} readOnly />
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <h4 className="font-medium">Autonomy Settings</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Autonomy Level</Label>
              <Input value={config.autonomyLevel} readOnly />
            </div>
            <div>
              <Label>Max Actions/Hour</Label>
              <Input value={config.maxActionsPerHour} readOnly />
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <h4 className="font-medium">Capabilities</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span>Voice Enabled</span>
              <Badge variant={config.voiceEnabled ? "default" : "secondary"}>
                {config.voiceEnabled ? "Yes" : "No"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Learning Enabled</span>
              <Badge variant={config.learningEnabled ? "default" : "secondary"}>
                {config.learningEnabled ? "Yes" : "No"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Can Evolve</span>
              <Badge variant={config.canEvolve ? "default" : "secondary"}>
                {config.canEvolve ? "Yes" : "No"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Can Replicate</span>
              <Badge variant={config.canReplicate ? "default" : "secondary"}>
                {config.canReplicate ? "Yes" : "No"}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function EventCard({ event }: { event: AutonomousAgentEvent }) {
  const icons: Record<string, React.ReactNode> = {
    "agent:created": <Plus className="h-3 w-3" />,
    "agent:activated": <Play className="h-3 w-3" />,
    "agent:state_changed": <Activity className="h-3 w-3" />,
    "mission:created": <Target className="h-3 w-3" />,
    "mission:started": <Play className="h-3 w-3" />,
    "mission:completed": <CheckCircle className="h-3 w-3" />,
    "mission:failed": <XCircle className="h-3 w-3" />,
    "action:started": <Zap className="h-3 w-3" />,
    "action:completed": <CheckCircle className="h-3 w-3" />,
    "evolution:completed": <Sparkles className="h-3 w-3" />,
    "replication:completed": <Copy className="h-3 w-3" />,
    "artifact:created": <FileCode className="h-3 w-3" />,
  };

  const colors: Record<string, string> = {
    "agent:created": "text-blue-500",
    "agent:activated": "text-green-500",
    "mission:completed": "text-emerald-500",
    "mission:failed": "text-red-500",
    "evolution:completed": "text-amber-500",
    "replication:completed": "text-cyan-500",
  };

  return (
    <div className="flex items-start gap-2 rounded-lg border p-2 text-xs">
      <div className={cn("mt-0.5", colors[event.type] || "text-muted-foreground")}>
        {icons[event.type] || <Activity className="h-3 w-3" />}
      </div>
      <div className="flex-1">
        <p className="font-medium">{event.type.replace(":", " ").replace(/_/g, " ")}</p>
        <p className="text-muted-foreground">
          {new Date(event.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// DIALOGS
// =============================================================================

function CreateAgentDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [autonomyLevel, setAutonomyLevel] = useState<"supervised" | "semi-autonomous" | "fully-autonomous">("semi-autonomous");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [learningEnabled, setLearningEnabled] = useState(true);
  const [canEvolve, setCanEvolve] = useState(true);
  const [canReplicate, setCanReplicate] = useState(true);

  const handleSubmit = () => {
    onSubmit({
      name,
      purpose,
      autonomyLevel,
      voiceEnabled,
      learningEnabled,
      canEvolve,
      canReplicate,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Autonomous Agent</DialogTitle>
          <DialogDescription>
            Create a new autonomous agent that can learn, evolve, and replicate
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Research Agent Alpha"
            />
          </div>
          <div>
            <Label>Purpose</Label>
            <Textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Describe what this agent should do..."
              rows={3}
            />
          </div>
          <div>
            <Label>Autonomy Level</Label>
            <Select value={autonomyLevel} onValueChange={(v: any) => setAutonomyLevel(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="supervised">Supervised (requires approval)</SelectItem>
                <SelectItem value="semi-autonomous">Semi-Autonomous (most actions auto)</SelectItem>
                <SelectItem value="fully-autonomous">Fully Autonomous (no oversight)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between">
              <Label>Voice Enabled</Label>
              <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Learning Enabled</Label>
              <Switch checked={learningEnabled} onCheckedChange={setLearningEnabled} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Can Evolve</Label>
              <Switch checked={canEvolve} onCheckedChange={setCanEvolve} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Can Replicate</Label>
              <Switch checked={canReplicate} onCheckedChange={setCanReplicate} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name || !purpose || isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Create Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateMissionDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  isSubmitting: boolean;
}) {
  const [type, setType] = useState<MissionType>("research");
  const [objective, setObjective] = useState("");
  const [context, setContext] = useState("");

  const handleSubmit = () => {
    onSubmit({ type, objective, context });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Mission</DialogTitle>
          <DialogDescription>
            Assign a mission for the agent to complete autonomously
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Mission Type</Label>
            <Select value={type} onValueChange={(v: MissionType) => setType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MISSION_TYPES.map((mt) => (
                  <SelectItem key={mt.value} value={mt.value}>
                    <div className="flex items-center gap-2">
                      {mt.icon}
                      {mt.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Objective</Label>
            <Textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="What should the agent accomplish?"
              rows={3}
            />
          </div>
          <div>
            <Label>Context (optional)</Label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Additional context or requirements..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!objective || isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Target className="mr-2 h-4 w-4" />
            )}
            Create Mission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
