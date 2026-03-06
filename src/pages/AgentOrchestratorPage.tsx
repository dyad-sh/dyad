/**
 * Agent Orchestrator Page
 * Full UI for the autonomous meta-agent orchestration system
 *
 * Features:
 * - Voice & text task submission
 * - Live orchestration monitoring
 * - Meta-agent & template browser
 * - Task graph visualization
 * - Execution trace viewer
 * - System status dashboard
 * - Configuration panel
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Mic,
  MicOff,
  Send,
  Play,
  Pause,
  Square,
  RefreshCw,
  Settings,
  Brain,
  Activity,
  Cpu,
  Globe,
  Zap,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Loader2,
  Volume2,
  FileText,
  Code2,
  Search,
  Layers,
  Network,
  ArrowRight,
  BarChart3,
  Bot,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

import {
  useOrchestratorDashboard,
  useOrchestratorStatus,
  useMetaAgent,
  useAgentTemplates,
  useOrchestrationList,
  useOrchestration,
  useSubmitTextTask,
  useCancelOrchestration,
  usePauseOrchestration,
  useResumeOrchestration,
  useOrchestratorInit,
  useExecutionConfig,
  useOrchestratorEvents,
} from "@/hooks/useAgentOrchestrator";

import type {
  Orchestration,
  OrchestrationStatus,
  TaskNode,
  AgentTemplate,
  OrchestratorEvent,
  ExecutionConfig,
  MetaAgent,
  SystemStatus,
  OrchestratorDashboard,
  AgentCapability,
} from "@/types/agent_orchestrator";

// =============================================================================
// STATUS HELPERS
// =============================================================================

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "bg-green-500/20 text-green-400 border-green-500/30";
    case "executing": case "running": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "failed": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "cancelled": return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    case "paused": case "blocked": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "pending": case "queued": case "received": return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    default: return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "completed": return <CheckCircle2 className="h-4 w-4 text-green-400" />;
    case "executing": case "running": return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-400" />;
    case "cancelled": return <Square className="h-4 w-4 text-gray-400" />;
    case "paused": return <Pause className="h-4 w-4 text-yellow-400" />;
    default: return <Clock className="h-4 w-4 text-slate-400" />;
  }
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function AgentOrchestratorPage() {
  const [activeTab, setActiveTab] = useState("command");
  const [selectedOrchestrationId, setSelectedOrchestrationId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Hooks
  const initMutation = useOrchestratorInit();
  const { data: dashboard, isLoading: dashboardLoading } = useOrchestratorDashboard(isInitialized);
  const { data: status } = useOrchestratorStatus(isInitialized);
  const { data: templates } = useAgentTemplates(isInitialized);
  const { data: orchestrations } = useOrchestrationList({ limit: 20 }, isInitialized);
  const { events } = useOrchestratorEvents();

  // Initialize on mount
  useEffect(() => {
    initMutation.mutateAsync().then(() => {
      setIsInitialized(true);
    }).catch((err) => {
      toast.error("Failed to initialize orchestrator: " + err.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-blue-600">
            <Brain className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Agent Orchestrator</h1>
            <p className="text-sm text-muted-foreground">
              Autonomous meta-agent task orchestration
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <SystemStatusIndicators status={status} />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Command & Orchestrations */}
        <div className="flex w-[420px] flex-col border-r">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col">
            <TabsList className="mx-4 mt-3 grid grid-cols-3">
              <TabsTrigger value="command" className="text-xs">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Command
              </TabsTrigger>
              <TabsTrigger value="active" className="text-xs">
                <Activity className="mr-1.5 h-3.5 w-3.5" />
                Active
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs">
                <Clock className="mr-1.5 h-3.5 w-3.5" />
                History
              </TabsTrigger>
            </TabsList>

            {/* Command Center */}
            <TabsContent value="command" className="flex-1 overflow-hidden">
              <CommandCenter
                onSubmitted={(id) => {
                  setSelectedOrchestrationId(id);
                  setActiveTab("active");
                }}
              />
            </TabsContent>

            {/* Active Orchestrations */}
            <TabsContent value="active" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-2 p-4">
                  {orchestrations
                    ?.filter((o) =>
                      ["executing", "monitoring", "creating_agents", "decomposing_task", "parsing_input", "received", "planning", "aggregating_results"].includes(o.status),
                    )
                    .map((o) => (
                      <OrchestrationCard
                        key={o.id}
                        orchestration={o}
                        selected={selectedOrchestrationId === o.id}
                        onClick={() => setSelectedOrchestrationId(o.id)}
                      />
                    ))}
                  {(!orchestrations || orchestrations.filter((o) => !["completed", "failed", "cancelled"].includes(o.status)).length === 0) && (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      No active orchestrations
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* History */}
            <TabsContent value="history" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-2 p-4">
                  {orchestrations
                    ?.filter((o) => ["completed", "failed", "cancelled"].includes(o.status))
                    .map((o) => (
                      <OrchestrationCard
                        key={o.id}
                        orchestration={o}
                        selected={selectedOrchestrationId === o.id}
                        onClick={() => setSelectedOrchestrationId(o.id)}
                      />
                    ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Panel — Detail View */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedOrchestrationId ? (
            <OrchestrationDetail orchestrationId={selectedOrchestrationId} />
          ) : (
            <DashboardOverview
              dashboard={dashboard}
              templates={templates}
              events={events}
              loading={dashboardLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SYSTEM STATUS INDICATORS
// =============================================================================

function SystemStatusIndicators({ status }: { status?: SystemStatus }) {
  if (!status) return null;

  return (
    <div className="flex items-center gap-2">
      <StatusDot active={status.ollamaAvailable} label="Ollama" />
      <StatusDot active={status.openclawCnsInitialized} label="CNS" />
      <StatusDot active={status.voiceAvailable} label="Voice" />
      <StatusDot active={status.swarmActive} label="Swarm" />
    </div>
  );
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${active ? "Available" : "Unavailable"}`}>
      <div
        className={`h-2 w-2 rounded-full ${
          active ? "bg-green-500 shadow-sm shadow-green-500/50" : "bg-gray-500"
        }`}
      />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// =============================================================================
// COMMAND CENTER — Text & Voice input
// =============================================================================

function CommandCenter({ onSubmitted }: { onSubmitted: (id: string) => void }) {
  const [text, setText] = useState("");
  const [executionMode, setExecutionMode] = useState<"hybrid" | "local" | "cloud">("hybrid");
  const [preferLocal, setPreferLocal] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxParallel, setMaxParallel] = useState(5);

  const submitTask = useSubmitTextTask();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;

    try {
      const result = await submitTask.mutateAsync({
        text: text.trim(),
        config: {
          mode: executionMode,
          preferLocal,
          maxParallelAgents: maxParallel,
        },
      });

      toast.success("Task submitted to orchestrator");
      onSubmitted(result.orchestrationId);
      setText("");
    } catch (err: any) {
      toast.error("Failed to submit task: " + err.message);
    }
  }, [text, executionMode, preferLocal, maxParallel, submitTask, onSubmitted]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="flex flex-1 flex-col p-4">
      {/* Input Area */}
      <div className="space-y-3">
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build, research, or accomplish..."
            className="min-h-[120px] resize-none pr-12"
          />
          <div className="absolute bottom-2 right-2 flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              title="Voice input"
            >
              <Mic className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-accent"
            onClick={() => setText("Build a REST API with authentication")}
          >
            <Code2 className="mr-1 h-3 w-3" /> Build API
          </Badge>
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-accent"
            onClick={() => setText("Research and summarize the latest AI papers")}
          >
            <Search className="mr-1 h-3 w-3" /> Research
          </Badge>
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-accent"
            onClick={() => setText("Analyze my project's codebase and suggest improvements")}
          >
            <BarChart3 className="mr-1 h-3 w-3" /> Analyze
          </Badge>
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-accent"
            onClick={() => setText("Write comprehensive tests for the auth module")}
          >
            <Target className="mr-1 h-3 w-3" /> Test
          </Badge>
        </div>

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={!text.trim() || submitTask.isPending}
          className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
        >
          {submitTask.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Orchestrating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Orchestrate Task
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Ctrl+Enter to submit
        </p>
      </div>

      <Separator className="my-4" />

      {/* Execution Settings */}
      <div className="space-y-3">
        <button
          className="flex w-full items-center justify-between text-sm font-medium"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Execution Settings
          </span>
          {showAdvanced ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {showAdvanced && (
          <div className="space-y-4 rounded-lg border p-3">
            <div className="space-y-2">
              <Label className="text-xs">Execution Mode</Label>
              <Select value={executionMode} onValueChange={(v: any) => setExecutionMode(v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hybrid">
                    <span className="flex items-center gap-2">
                      <Network className="h-3 w-3" /> Hybrid (Local + Cloud)
                    </span>
                  </SelectItem>
                  <SelectItem value="local">
                    <span className="flex items-center gap-2">
                      <Cpu className="h-3 w-3" /> Local Only (Ollama)
                    </span>
                  </SelectItem>
                  <SelectItem value="cloud">
                    <span className="flex items-center gap-2">
                      <Globe className="h-3 w-3" /> Cloud Only
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs">Prefer Local</Label>
              <Switch checked={preferLocal} onCheckedChange={setPreferLocal} />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Max Parallel Agents: {maxParallel}</Label>
              <Slider
                value={[maxParallel]}
                onValueChange={([v]) => setMaxParallel(v)}
                min={1}
                max={10}
                step={1}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// ORCHESTRATION CARD — sidebar list item
// =============================================================================

function OrchestrationCard({
  orchestration,
  selected,
  onClick,
}: {
  orchestration: Orchestration;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-accent/50 ${
        selected ? "border-purple-500 bg-accent/30" : ""
      }`}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {statusIcon(orchestration.status)}
              <span className="text-sm font-medium truncate">
                {orchestration.input.text.slice(0, 50)}
                {orchestration.input.text.length > 50 ? "..." : ""}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusColor(orchestration.status)}`}>
                {orchestration.status}
              </Badge>
              {orchestration.plan && (
                <span>{orchestration.plan.tasks.length} tasks</span>
              )}
              <span>{formatDuration(orchestration.durationMs)}</span>
            </div>
          </div>
          <div className="flex items-center">
            {orchestration.progress > 0 && orchestration.progress < 100 && (
              <div className="w-10">
                <Progress value={orchestration.progress} className="h-1.5" />
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// ORCHESTRATION DETAIL — right panel when an orchestration is selected
// =============================================================================

function OrchestrationDetail({ orchestrationId }: { orchestrationId: string }) {
  const { data: orchestration, isLoading } = useOrchestration(orchestrationId);
  const cancelMutation = useCancelOrchestration();
  const pauseMutation = usePauseOrchestration();
  const resumeMutation = useResumeOrchestration();
  const [detailTab, setDetailTab] = useState("tasks");

  if (isLoading || !orchestration) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isRunning = ["executing", "monitoring", "creating_agents", "decomposing_task", "parsing_input"].includes(orchestration.status);
  const isPaused = orchestration.status === "paused" as any;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {statusIcon(orchestration.status)}
              <h2 className="text-lg font-semibold truncate">{orchestration.input.text}</h2>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="outline" className={statusColor(orchestration.status)}>
                {orchestration.status}
              </Badge>
              {orchestration.plan && (
                <span>{orchestration.plan.tasks.length} tasks</span>
              )}
              <span>{formatDuration(orchestration.durationMs)}</span>
              <span>Progress: {orchestration.progress}%</span>
            </div>
            {orchestration.progress > 0 && (
              <Progress value={orchestration.progress} className="mt-2 h-2" />
            )}
          </div>

          <div className="flex items-center gap-2 ml-4">
            {isRunning && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => pauseMutation.mutate(orchestrationId)}
                >
                  <Pause className="mr-1 h-3 w-3" /> Pause
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => cancelMutation.mutate(orchestrationId)}
                >
                  <Square className="mr-1 h-3 w-3" /> Cancel
                </Button>
              </>
            )}
            {isPaused && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => resumeMutation.mutate(orchestrationId)}
              >
                <Play className="mr-1 h-3 w-3" /> Resume
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Detail Tabs */}
      <Tabs value={detailTab} onValueChange={setDetailTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-6 mt-3 grid grid-cols-4 w-fit">
          <TabsTrigger value="tasks" className="text-xs">
            <Layers className="mr-1 h-3.5 w-3.5" /> Tasks
          </TabsTrigger>
          <TabsTrigger value="agents" className="text-xs">
            <Bot className="mr-1 h-3.5 w-3.5" /> Agents
          </TabsTrigger>
          <TabsTrigger value="results" className="text-xs">
            <FileText className="mr-1 h-3.5 w-3.5" /> Results
          </TabsTrigger>
          <TabsTrigger value="trace" className="text-xs">
            <Activity className="mr-1 h-3.5 w-3.5" /> Trace
          </TabsTrigger>
        </TabsList>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-2 p-6">
              {orchestration.plan?.tasks.map((task) => (
                <TaskNodeCard key={task.id} task={task} />
              ))}
              {(!orchestration.plan || orchestration.plan.tasks.length === 0) && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {orchestration.status === "parsing_input" || orchestration.status === "decomposing_task"
                    ? "Decomposing task..."
                    : "No tasks created yet"}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-2 p-6">
              {orchestration.plan?.agentAssignments.map((assignment) => (
                <Card key={assignment.taskId}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-purple-400" />
                        <span className="text-sm font-medium">{assignment.agentName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {assignment.createdVia && (
                          <Badge variant="outline" className="text-[10px]">
                            {assignment.createdVia}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {assignment.executionMode}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {assignment.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {cap.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                    {assignment.createdAgentId && (
                      <p className="mt-1 text-[10px] text-muted-foreground font-mono">
                        ID: {assignment.createdAgentId.slice(0, 12)}...
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Results Tab */}
        <TabsContent value="results" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-6">
              {orchestration.results ? (
                <div className="space-y-4">
                  {/* Summary */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm whitespace-pre-wrap">{orchestration.results.summary}</p>
                    </CardContent>
                  </Card>

                  {/* Stats */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Statistics</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-2xl font-bold text-green-400">
                            {orchestration.results.stats.completedTasks}
                          </p>
                          <p className="text-xs text-muted-foreground">Completed</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-red-400">
                            {orchestration.results.stats.failedTasks}
                          </p>
                          <p className="text-xs text-muted-foreground">Failed</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-blue-400">
                            {orchestration.results.stats.totalAgentsCreated}
                          </p>
                          <p className="text-xs text-muted-foreground">Agents</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold">
                            {formatDuration(orchestration.results.stats.totalDurationMs)}
                          </p>
                          <p className="text-xs text-muted-foreground">Duration</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-purple-400">
                            {orchestration.results.stats.localInferences}
                          </p>
                          <p className="text-xs text-muted-foreground">Local Calls</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-cyan-400">
                            {orchestration.results.stats.cloudInferences}
                          </p>
                          <p className="text-xs text-muted-foreground">Cloud Calls</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Artifacts */}
                  {orchestration.results.artifacts.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Artifacts</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {orchestration.results.artifacts.map((artifact) => (
                            <div key={artifact.id} className="flex items-center gap-2 text-sm">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span>{artifact.name}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {artifact.type}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Results will appear when the orchestration completes
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Trace Tab */}
        <TabsContent value="trace" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-6 space-y-1">
              {orchestration.trace.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 py-1 text-xs font-mono"
                >
                  <span className="text-muted-foreground shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1 py-0 shrink-0 ${
                      entry.level === "error"
                        ? "text-red-400"
                        : entry.level === "warn"
                          ? "text-yellow-400"
                          : "text-blue-400"
                    }`}
                  >
                    {entry.level}
                  </Badge>
                  <span className="text-purple-400 shrink-0">[{entry.source}]</span>
                  <span className="text-foreground">{entry.message}</span>
                </div>
              ))}
              {orchestration.trace.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No trace entries yet
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Error Banner */}
      {orchestration.error && (
        <div className="border-t bg-red-500/10 px-6 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-400">{orchestration.error}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// TASK NODE CARD
// =============================================================================

function TaskNodeCard({ task }: { task: TaskNode }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardContent className="p-3">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {statusIcon(task.status)}
            <span className="text-sm font-medium truncate">{task.name}</span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusColor(task.status)}`}>
              {task.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 ml-2">
            <Badge variant="secondary" className="text-[10px]">{task.priority}</Badge>
            <Badge variant="secondary" className="text-[10px]">{task.complexity}</Badge>
            {task.durationMs && (
              <span className="text-[10px] text-muted-foreground">{formatDuration(task.durationMs)}</span>
            )}
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-2 text-xs">
            <p className="text-muted-foreground">{task.description}</p>

            <div className="flex flex-wrap gap-1">
              {task.requiredCapabilities.map((cap) => (
                <Badge key={cap} variant="outline" className="text-[10px] px-1.5 py-0">
                  {cap.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>

            {task.dependencies.length > 0 && (
              <div className="text-muted-foreground">
                Dependencies: {task.dependencies.join(", ")}
              </div>
            )}

            {task.error && (
              <div className="text-red-400">Error: {task.error}</div>
            )}

            {task.output && (
              <div className="mt-2 rounded bg-muted p-2">
                <pre className="whitespace-pre-wrap text-[10px]">
                  {JSON.stringify(task.output, null, 2).slice(0, 1000)}
                </pre>
              </div>
            )}

            <div className="flex items-center gap-3 text-muted-foreground">
              <span>Mode: {task.executionMode}</span>
              <span>Retries: {task.retryCount}/{task.maxRetries}</span>
              {task.assignedAgentId && (
                <span>Agent: {task.assignedAgentId.slice(0, 8)}...</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// DASHBOARD OVERVIEW — shown when no orchestration is selected
// =============================================================================

function DashboardOverview({
  dashboard,
  templates,
  events,
  loading,
}: {
  dashboard?: OrchestratorDashboard;
  templates?: AgentTemplate[];
  events: OrchestratorEvent[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-6">
        {/* Meta-Agent Card */}
        {dashboard?.metaAgent && (
          <Card className="bg-gradient-to-br from-purple-950/50 to-blue-950/50 border-purple-500/20">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-blue-600">
                  <Brain className="h-7 w-7 text-white" />
                </div>
                <div>
                  <CardTitle>{dashboard.metaAgent.name}</CardTitle>
                  <CardDescription>{dashboard.metaAgent.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{dashboard.metaAgent.stats.totalOrchestrations}</p>
                  <p className="text-xs text-muted-foreground">Orchestrations</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-400">{dashboard.metaAgent.stats.agentsCreated}</p>
                  <p className="text-xs text-muted-foreground">Agents Created</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-400">{dashboard.metaAgent.stats.tasksCompleted}</p>
                  <p className="text-xs text-muted-foreground">Tasks Done</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-cyan-400">
                    {(dashboard.metaAgent.stats.successRate * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-muted-foreground">Success Rate</p>
                </div>
              </div>

              {/* Capabilities */}
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Capabilities</p>
                <div className="flex flex-wrap gap-1.5">
                  {dashboard.metaAgent.capabilities.map((cap: AgentCapability) => (
                    <Badge key={cap.type} variant="outline" className="text-xs">
                      {cap.type.replace(/_/g, " ")} ({(cap.proficiency * 100).toFixed(0)}%)
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* System Status */}
        {dashboard?.systemStatus && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4" /> System Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <StatusItem
                  label="Ollama (Local AI)"
                  active={dashboard.systemStatus.ollamaAvailable}
                  icon={<Cpu className="h-4 w-4" />}
                />
                <StatusItem
                  label="OpenClaw CNS"
                  active={dashboard.systemStatus.openclawCnsInitialized}
                  icon={<Brain className="h-4 w-4" />}
                />
                <StatusItem
                  label="Voice Assistant"
                  active={dashboard.systemStatus.voiceAvailable}
                  icon={<Volume2 className="h-4 w-4" />}
                />
                <StatusItem
                  label="Agent Swarm"
                  active={dashboard.systemStatus.swarmActive}
                  icon={<Users className="h-4 w-4" />}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Agent Templates */}
        {templates && templates.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4" /> Agent Templates ({templates.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Available agent types for task execution
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-start gap-2 rounded-lg border p-2.5 text-xs"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-purple-500/10">
                      <Zap className="h-3.5 w-3.5 text-purple-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{template.name}</p>
                      <p className="text-muted-foreground truncate">{template.description}</p>
                      <div className="mt-1 flex items-center gap-1">
                        <Badge variant="outline" className="text-[9px] px-1 py-0">
                          {template.modelPreference}
                        </Badge>
                        <Badge variant="secondary" className="text-[9px] px-1 py-0">
                          L{template.complexityLevel}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Events */}
        {events.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4" /> Recent Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 max-h-48 overflow-auto">
                {events.slice(-20).reverse().map((event, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {event.type.split(":").pop()}
                    </Badge>
                    {event.orchestrationId && (
                      <span className="text-muted-foreground font-mono">
                        {event.orchestrationId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}

function StatusItem({
  label,
  active,
  icon,
}: {
  label: string;
  active: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-2.5 ${
      active ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"
    }`}>
      <div className={active ? "text-green-400" : "text-red-400"}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{label}</p>
        <p className={`text-[10px] ${active ? "text-green-400" : "text-red-400"}`}>
          {active ? "Available" : "Unavailable"}
        </p>
      </div>
    </div>
  );
}
