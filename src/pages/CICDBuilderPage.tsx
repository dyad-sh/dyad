import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  GitMerge,
  Plus,
  Trash2,
  Play,
  Square,
  ChevronUp,
  ChevronDown,
  Loader2,
  FolderOpen,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TerminalSquare,
  Layers,
  RefreshCw,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipelineStep {
  id: string;
  name: string;
  command: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  timeout?: number;
  continueOnError?: boolean;
  position?: number;
}

interface Pipeline {
  id: string;
  name: string;
  description?: string;
  workingDirectory: string;
  steps: PipelineStep[];
  status: string;
  triggers?: string[];
  env?: Record<string, string>;
  createdAt?: number;
  updatedAt?: number;
}

interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  steps: PipelineStep[];
  language?: string;
}

interface PipelineRun {
  id: string;
  pipelineId: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  trigger?: string;
  branch?: string;
  commit?: string;
  startedAt?: number;
  completedAt?: number;
  stepResults?: StepResult[];
}

interface StepResult {
  stepId: string;
  stepName: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
}

interface LogLine {
  event: string;
  run?: PipelineRun;
  stepId?: string;
  stepName?: string;
  output?: string;
  timestamp?: number;
}

// ── IPC helper ────────────────────────────────────────────────────────────────

const ipc = (channel: string, ...args: unknown[]) =>
  window.electron.ipcRenderer.invoke(channel as never, ...args);

const RUN_STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-500/15 text-zinc-400",
  running: "bg-blue-500/15 text-blue-400",
  success: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
  cancelled: "bg-amber-500/15 text-amber-400",
};

const RUN_STATUS_ICONS: Record<string, React.ElementType> = {
  pending: Clock,
  running: Loader2,
  success: CheckCircle2,
  failed: XCircle,
  cancelled: Square,
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function CICDBuilderPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("pipelines");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showAddStepDialog, setShowAddStepDialog] = useState(false);
  const [showFromTemplateDialog, setShowFromTemplateDialog] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: pipelines = [], isLoading } = useQuery<Pipeline[]>({
    queryKey: ["cicd:pipelines"],
    queryFn: () => ipc("cicd:list-pipelines"),
  });

  const { data: templates = [] } = useQuery<PipelineTemplate[]>({
    queryKey: ["cicd:templates"],
    queryFn: () => ipc("cicd:get-templates"),
  });

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId) ?? null;

  const { data: runs = [], refetch: refetchRuns } = useQuery<PipelineRun[]>({
    queryKey: ["cicd:runs", selectedPipelineId],
    queryFn: () => ipc("cicd:list-runs", selectedPipelineId),
    enabled: !!selectedPipelineId,
    refetchInterval: liveRunId ? 2000 : false,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidatePipelines = () => qc.invalidateQueries({ queryKey: ["cicd:pipelines"] });
  const invalidateRuns = () => qc.invalidateQueries({ queryKey: ["cicd:runs", selectedPipelineId] });

  const createPipeline = useMutation({
    mutationFn: (params: { name: string; description?: string; workingDirectory: string }) =>
      ipc("cicd:create-pipeline", params),
    onSuccess: (p: Pipeline) => {
      invalidatePipelines();
      setSelectedPipelineId(p.id);
      toast.success(`Pipeline "${p.name}" created`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deletePipeline = useMutation({
    mutationFn: (id: string) => ipc("cicd:delete-pipeline", id),
    onSuccess: () => {
      invalidatePipelines();
      setSelectedPipelineId(null);
      toast.success("Pipeline deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createFromTemplate = useMutation({
    mutationFn: ({ templateId, workingDirectory, name }: { templateId: string; workingDirectory: string; name?: string }) =>
      ipc("cicd:create-from-template", templateId, workingDirectory, name ? { name } : undefined),
    onSuccess: (p: Pipeline) => {
      invalidatePipelines();
      setSelectedPipelineId(p.id);
      setShowFromTemplateDialog(false);
      setActiveTab("editor");
      toast.success(`Pipeline "${p.name}" created from template`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addStep = useMutation({
    mutationFn: ({ pipelineId, step }: { pipelineId: string; step: Omit<PipelineStep, "id"> }) =>
      ipc("cicd:add-step", pipelineId, step),
    onSuccess: () => { invalidatePipelines(); setShowAddStepDialog(false); },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeStep = useMutation({
    mutationFn: ({ pipelineId, stepId }: { pipelineId: string; stepId: string }) =>
      ipc("cicd:remove-step", pipelineId, stepId),
    onSuccess: () => invalidatePipelines(),
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderSteps = useMutation({
    mutationFn: ({ pipelineId, stepIds }: { pipelineId: string; stepIds: string[] }) =>
      ipc("cicd:reorder-steps", pipelineId, stepIds),
    onSuccess: () => invalidatePipelines(),
  });

  const runPipeline = useMutation({
    mutationFn: ({ pipelineId, params }: { pipelineId: string; params?: { branch?: string; trigger?: string } }) =>
      ipc("cicd:run-pipeline", pipelineId, params),
    onSuccess: (run: PipelineRun) => {
      setLiveRunId(run.id);
      setActiveTab("logs");
      setLogs([`[${new Date().toLocaleTimeString()}] Pipeline run started — ID: ${run.id}`]);
      invalidateRuns();
      toast.success("Pipeline run started");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelRun = useMutation({
    mutationFn: (runId: string) => ipc("cicd:cancel-run", runId),
    onSuccess: () => { setLiveRunId(null); invalidateRuns(); toast.info("Run cancelled"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteRun = useMutation({
    mutationFn: (runId: string) => ipc("cicd:delete-run", runId),
    onSuccess: () => invalidateRuns(),
    onError: (err: Error) => toast.error(err.message),
  });

  // ── IPC event listeners ────────────────────────────────────────────────────

  useEffect(() => {
    const onLogLine = (_: unknown, data: LogLine) => {
      const ts = new Date().toLocaleTimeString();
      if (data.event === "step:started") {
        setLogs((l) => [...l.slice(-499), `[${ts}] ▶ Step started: ${data.stepName ?? data.stepId ?? ""}`]);
      } else if (data.event === "step:completed") {
        setLogs((l) => [...l.slice(-499), `[${ts}] ✓ Step completed: ${data.stepName ?? data.stepId ?? ""}`]);
        if (data.output) {
          const lines = String(data.output).split("\n").filter(Boolean);
          setLogs((l) => [...l.slice(-499), ...lines.map((ln) => `       ${ln}`)]);
        }
      }
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const onRunProgress = (_: unknown, data: { event: string; run: PipelineRun }) => {
      const ts = new Date().toLocaleTimeString();
      if (data.event === "run:started") {
        setLogs((l) => [...l.slice(-499), `[${ts}] Pipeline run started`]);
      } else if (data.event === "run:completed" || data.event === "run:cancelled") {
        setLogs((l) => [...l.slice(-499),
          `[${ts}] Pipeline run ${data.run.status.toUpperCase()} — ${data.run.completedAt ? new Date(data.run.completedAt).toLocaleTimeString() : ""}`]);
        setLiveRunId(null);
        invalidateRuns();
        if (data.run.status === "success") toast.success("Pipeline run succeeded!");
        else if (data.run.status === "failed") toast.error("Pipeline run failed");
      }
    };

    window.electron.ipcRenderer.on("cicd:log-line" as never, onLogLine);
    window.electron.ipcRenderer.on("cicd:run-progress" as never, onRunProgress);
    window.electron.ipcRenderer.on("cicd:run-complete" as never, onRunProgress);

    return () => {
      window.electron.ipcRenderer.removeListener("cicd:log-line" as never, onLogLine);
      window.electron.ipcRenderer.removeListener("cicd:run-progress" as never, onRunProgress);
      window.electron.ipcRenderer.removeListener("cicd:run-complete" as never, onRunProgress);
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Auto-select first pipeline
  useEffect(() => {
    if (!selectedPipelineId && pipelines.length > 0) setSelectedPipelineId(pipelines[0].id);
  }, [pipelines, selectedPipelineId]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-background/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-slate-500 to-gray-500 shadow-sm">
            <GitMerge className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">CI/CD Pipelines</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Automated testing and deployment</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowFromTemplateDialog(true)}>
            <Layers className="w-3.5 h-3.5 mr-1.5" />From Template
          </Button>
          <Button size="sm" onClick={() => setShowNewDialog(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />New Pipeline
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-6 mt-4 mb-0 shrink-0 w-fit">
          <TabsTrigger value="pipelines"><GitMerge className="w-3.5 h-3.5 mr-1.5" />Pipelines</TabsTrigger>
          <TabsTrigger value="editor"><FileText className="w-3.5 h-3.5 mr-1.5" />Editor</TabsTrigger>
          <TabsTrigger value="runs"><Clock className="w-3.5 h-3.5 mr-1.5" />Runs</TabsTrigger>
          <TabsTrigger value="logs"><TerminalSquare className="w-3.5 h-3.5 mr-1.5" />Logs</TabsTrigger>
          <TabsTrigger value="templates"><Layers className="w-3.5 h-3.5 mr-1.5" />Templates</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 px-6 py-4">

          {/* ── Pipelines ───────────────────────────────────────────────── */}
          <TabsContent value="pipelines" className="mt-0 space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : pipelines.length === 0 ? (
              <EmptyState icon={GitMerge} title="No pipelines yet"
                description="Create a pipeline or start from one of the built-in templates"
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowFromTemplateDialog(true)}>
                      <Layers className="w-3.5 h-3.5 mr-1.5" />From Template
                    </Button>
                    <Button size="sm" onClick={() => setShowNewDialog(true)}>
                      <Plus className="w-3.5 h-3.5 mr-1.5" />New Pipeline
                    </Button>
                  </div>
                } />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {pipelines.map((p) => (
                  <PipelineCard
                    key={p.id}
                    pipeline={p}
                    isRunning={liveRunId !== null && runs.some((r) => r.pipelineId === p.id && r.status === "running")}
                    selected={p.id === selectedPipelineId}
                    onEdit={() => { setSelectedPipelineId(p.id); setActiveTab("editor"); }}
                    onRun={() => { setSelectedPipelineId(p.id); runPipeline.mutate({ pipelineId: p.id }); }}
                    onViewRuns={() => { setSelectedPipelineId(p.id); setActiveTab("runs"); refetchRuns(); }}
                    onDelete={() => deletePipeline.mutate(p.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Editor ──────────────────────────────────────────────────── */}
          <TabsContent value="editor" className="mt-0 space-y-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">Pipeline:</Label>
              <Select value={selectedPipelineId ?? ""} onValueChange={setSelectedPipelineId}>
                <SelectTrigger className="h-8 text-xs max-w-xs">
                  <SelectValue placeholder="Select a pipeline…" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPipeline && (
                <>
                  <Button size="sm" className="h-7 text-xs ml-auto" onClick={() => setShowAddStepDialog(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" />Add Step
                  </Button>
                  <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => runPipeline.mutate({ pipelineId: selectedPipeline.id })}
                    disabled={runPipeline.isPending}>
                    <Play className="w-3.5 h-3.5 mr-1.5" />Run Pipeline
                  </Button>
                </>
              )}
            </div>
            {selectedPipeline ? (
              <PipelineEditor
                pipeline={selectedPipeline}
                onRemoveStep={(stepId) => removeStep.mutate({ pipelineId: selectedPipeline.id, stepId })}
                onMoveStep={(stepIds) => reorderSteps.mutate({ pipelineId: selectedPipeline.id, stepIds })}
              />
            ) : (
              <EmptyState icon={FileText} title="Select a pipeline" description="Choose a pipeline above to edit its steps" />
            )}
          </TabsContent>

          {/* ── Runs ────────────────────────────────────────────────────── */}
          <TabsContent value="runs" className="mt-0 space-y-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">Pipeline:</Label>
              <Select value={selectedPipelineId ?? ""} onValueChange={(v) => { setSelectedPipelineId(v); }}>
                <SelectTrigger className="h-8 text-xs max-w-xs">
                  <SelectValue placeholder="Select a pipeline…" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-auto" onClick={() => refetchRuns()}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
            {runs.length === 0 ? (
              <EmptyState icon={Clock} title="No runs yet" description="Run this pipeline to see its history here" />
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    isLive={run.id === liveRunId}
                    onCancel={() => cancelRun.mutate(run.id)}
                    onDelete={() => deleteRun.mutate(run.id)}
                    onViewLogs={() => setActiveTab("logs")}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Logs ────────────────────────────────────────────────────── */}
          <TabsContent value="logs" className="mt-0">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TerminalSquare className="w-4 h-4" />
                  Live Run Log
                  {liveRunId && <Badge className="text-[10px] bg-blue-500/15 text-blue-400" variant="outline">Running</Badge>}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {liveRunId && (
                    <Button size="sm" variant="destructive" className="h-6 text-[10px]" onClick={() => cancelRun.mutate(liveRunId)}>
                      <Square className="w-3 h-3 mr-1" />Cancel
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setLogs([])}>
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="bg-zinc-950 rounded-b-lg">
                  <ScrollArea className="h-[60vh] p-4 font-mono">
                    {logs.length === 0 ? (
                      <p className="text-xs text-zinc-500">Run a pipeline to see live output here…</p>
                    ) : (
                      logs.map((line, i) => (
                        <p key={i} className={`text-[11px] leading-relaxed whitespace-pre-wrap ${
                          line.includes("✓") ? "text-emerald-400"
                          : line.includes("▶") ? "text-blue-400"
                          : line.includes("FAILED") ? "text-red-400"
                          : line.includes("SUCCESS") || line.includes("succeeded") ? "text-emerald-400"
                          : "text-zinc-300"
                        }`}>{line}</p>
                      ))
                    )}
                    <div ref={logsEndRef} />
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Templates ───────────────────────────────────────────────── */}
          <TabsContent value="templates" className="mt-0 space-y-4">
            <p className="text-xs text-muted-foreground">Built-in pipeline templates. Click "Use Template" to create a pipeline pre-configured for your stack.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {templates.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  onUse={() => { setSelectedTemplateId(tpl.id); setShowFromTemplateDialog(true); }}
                />
              ))}
              {templates.length === 0 && (
                <div className="col-span-3 flex items-center justify-center h-32">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </TabsContent>

        </ScrollArea>
      </Tabs>

      {/* New Pipeline Dialog */}
      <NewPipelineDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onCreate={(params) => { createPipeline.mutate(params); setShowNewDialog(false); }}
        isPending={createPipeline.isPending}
      />

      {/* From Template Dialog */}
      <FromTemplateDialog
        open={showFromTemplateDialog}
        onOpenChange={(v) => { setShowFromTemplateDialog(v); if (!v) setSelectedTemplateId(null); }}
        templates={templates}
        preselectedTemplateId={selectedTemplateId}
        onCreate={(params) => createFromTemplate.mutate(params)}
        isPending={createFromTemplate.isPending}
      />

      {/* Add Step Dialog */}
      {selectedPipeline && (
        <AddStepDialog
          open={showAddStepDialog}
          onOpenChange={setShowAddStepDialog}
          onAdd={(step) => addStep.mutate({ pipelineId: selectedPipeline.id, step })}
          isPending={addStep.isPending}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ElementType; title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      {action}
    </div>
  );
}

function PipelineCard({ pipeline, isRunning, selected, onEdit, onRun, onViewRuns, onDelete }: {
  pipeline: Pipeline;
  isRunning: boolean;
  selected: boolean;
  onEdit: () => void;
  onRun: () => void;
  onViewRuns: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={`transition-all ${selected ? "border-slate-400/50 ring-1 ring-slate-400/30" : "hover:border-border"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{pipeline.name}</CardTitle>
            {pipeline.description && (
              <CardDescription className="text-xs mt-0.5 line-clamp-2">{pipeline.description}</CardDescription>
            )}
          </div>
          {isRunning && (
            <Badge className="text-[10px] bg-blue-500/15 text-blue-400 shrink-0" variant="outline">
              <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />Running
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span><span className="font-medium text-foreground">{pipeline.steps.length}</span> steps</span>
          <span className="truncate font-mono text-[10px]">{pipeline.workingDirectory || "~"}</span>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="default" className="h-6 text-[10px] flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={onRun} disabled={isRunning}>
            <Play className="w-2.5 h-2.5 mr-1" />Run
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onViewRuns}>
            <Clock className="w-2.5 h-2.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="w-2.5 h-2.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineEditor({ pipeline, onRemoveStep, onMoveStep }: {
  pipeline: Pipeline;
  onRemoveStep: (stepId: string) => void;
  onMoveStep: (stepIds: string[]) => void;
}) {
  const steps = [...pipeline.steps].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const move = (idx: number, dir: -1 | 1) => {
    const ids = steps.map((s) => s.id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    onMoveStep(ids);
  };

  if (steps.length === 0) {
    return (
      <EmptyState icon={Layers} title="No steps yet" description="Add steps using the button above" />
    );
  }

  return (
    <div className="space-y-2">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex items-center gap-2 p-3 rounded-lg border border-border/60 bg-card hover:border-border transition-colors">
          <div className="flex flex-col gap-0.5 shrink-0">
            <Button variant="ghost" size="sm" className="h-4 w-4 p-0" disabled={idx === 0} onClick={() => move(idx, -1)}>
              <ChevronUp className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-4 w-4 p-0" disabled={idx === steps.length - 1} onClick={() => move(idx, 1)}>
              <ChevronDown className="w-3 h-3" />
            </Button>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono shrink-0">{idx + 1}</Badge>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{step.name}</p>
            <p className="text-[10px] font-mono text-muted-foreground truncate">{step.command}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
            {step.timeout && <span>{step.timeout}s timeout</span>}
            {step.continueOnError && (
              <Badge variant="outline" className="text-[10px]">continue on error</Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive shrink-0" onClick={() => onRemoveStep(step.id)}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function RunRow({ run, isLive, onCancel, onDelete, onViewLogs }: {
  run: PipelineRun;
  isLive: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onViewLogs: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = RUN_STATUS_ICONS[run.status] ?? Clock;
  const duration = run.startedAt && run.completedAt
    ? `${((run.completedAt - run.startedAt) / 1000).toFixed(1)}s`
    : run.startedAt ? "running…" : "—";

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <Icon className={`w-4 h-4 shrink-0 ${run.status === "running" ? "animate-spin text-blue-400" : run.status === "success" ? "text-emerald-400" : run.status === "failed" ? "text-red-400" : "text-muted-foreground"}`} />
        <Badge className={`text-[10px] ${RUN_STATUS_COLORS[run.status] ?? ""}`} variant="outline">{run.status}</Badge>
        <span className="text-xs text-muted-foreground font-mono flex-1 truncate">{run.id.slice(0, 8)}</span>
        {run.branch && <Badge variant="outline" className="text-[10px] font-mono">{run.branch}</Badge>}
        {run.trigger && <span className="text-[10px] text-muted-foreground hidden sm:block">{run.trigger}</span>}
        <span className="text-[10px] text-muted-foreground shrink-0">{duration}</span>
        {run.startedAt && <span className="text-[10px] text-muted-foreground shrink-0 hidden md:block">{new Date(run.startedAt).toLocaleString()}</span>}
        <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {isLive && (
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onViewLogs}>
              <TerminalSquare className="w-3 h-3 mr-1" />Logs
            </Button>
          )}
          {run.status === "running" && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-amber-400" onClick={onCancel}>
              <Square className="w-3 h-3" />
            </Button>
          )}
          {run.status !== "running" && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={onDelete}>
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      {expanded && run.stepResults && run.stepResults.length > 0 && (
        <div className="border-t border-border/40 px-4 py-2 space-y-1">
          {run.stepResults.map((sr) => {
            const SIcon = RUN_STATUS_ICONS[sr.status] ?? Clock;
            return (
              <div key={sr.stepId} className={`flex items-center gap-2 text-[10px] py-1 ${sr.status === "failed" ? "text-red-400" : sr.status === "success" ? "text-emerald-400" : "text-muted-foreground"}`}>
                <SIcon className="w-3 h-3 shrink-0" />
                <span className="flex-1">{sr.stepName}</span>
                {sr.duration !== undefined && <span className="font-mono">{(sr.duration / 1000).toFixed(1)}s</span>}
                {sr.error && <span className="text-red-400 truncate max-w-[200px]">{sr.error}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template, onUse }: { template: PipelineTemplate; onUse: () => void }) {
  const TEMPLATE_COLORS: Record<string, string> = {
    "nodejs-ci": "from-emerald-500 to-green-500",
    "python-ci": "from-blue-500 to-indigo-500",
    "rust-ci": "from-orange-500 to-amber-500",
    "go-ci": "from-cyan-500 to-teal-500",
    "ipfs-deploy": "from-violet-500 to-purple-500",
  };

  return (
    <Card className="hover:border-border transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2">
          <div className={`w-8 h-8 rounded-md bg-gradient-to-br ${TEMPLATE_COLORS[template.id] ?? "from-slate-500 to-gray-500"} flex items-center justify-center shrink-0`}>
            <GitMerge className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm">{template.name}</CardTitle>
            {template.language && <Badge variant="outline" className="text-[10px] mt-0.5">{template.language}</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <p className="text-xs text-muted-foreground">{template.description}</p>
        <p className="text-[10px] text-muted-foreground"><span className="font-medium text-foreground">{template.steps?.length ?? 0}</span> pre-configured steps</p>
        <Button size="sm" className="h-6 text-[10px] w-full" onClick={onUse}>
          <Plus className="w-3 h-3 mr-1" />Use Template
        </Button>
      </CardContent>
    </Card>
  );
}

function NewPipelineDialog({ open, onOpenChange, onCreate, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (params: { name: string; description?: string; workingDirectory: string }) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({ name: "", description: "", workingDirectory: "" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New CI/CD Pipeline</DialogTitle>
          <DialogDescription>Create a blank pipeline. You can add steps in the Editor tab.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Pipeline Name</Label>
            <Input className="h-8" placeholder="e.g. My App CI" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Working Directory</Label>
            <Input className="h-8 font-mono text-xs" placeholder="/path/to/project" value={form.workingDirectory}
              onChange={(e) => setForm((f) => ({ ...f, workingDirectory: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea className="text-xs min-h-[60px] resize-none" placeholder="What does this pipeline do?" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!form.name.trim() || !form.workingDirectory.trim() || isPending}
            onClick={() => onCreate({ name: form.name, description: form.description || undefined, workingDirectory: form.workingDirectory })}>
            {isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
            Create Pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FromTemplateDialog({ open, onOpenChange, templates, preselectedTemplateId, onCreate, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templates: PipelineTemplate[];
  preselectedTemplateId: string | null;
  onCreate: (params: { templateId: string; workingDirectory: string; name?: string }) => void;
  isPending: boolean;
}) {
  const [templateId, setTemplateId] = useState(preselectedTemplateId ?? "");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (preselectedTemplateId) setTemplateId(preselectedTemplateId);
  }, [preselectedTemplateId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create from Template</DialogTitle>
          <DialogDescription>Start with a pre-configured pipeline template.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select a template…" /></SelectTrigger>
              <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Working Directory</Label>
            <Input className="h-8 font-mono text-xs" placeholder="/path/to/project" value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pipeline Name (optional override)</Label>
            <Input className="h-8 text-xs" placeholder="Leave blank to use template name" value={name}
              onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!templateId || !workingDirectory.trim() || isPending}
            onClick={() => onCreate({ templateId, workingDirectory, name: name || undefined })}>
            {isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Layers className="w-3.5 h-3.5 mr-1.5" />}
            Create Pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStepDialog({ open, onOpenChange, onAdd, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (step: Omit<PipelineStep, "id">) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    name: "", command: "", workingDirectory: "", timeout: 300, continueOnError: false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Pipeline Step</DialogTitle>
          <DialogDescription>Add a new step to the selected pipeline.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Step Name</Label>
            <Input className="h-8" placeholder="e.g. Run Tests" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Command</Label>
            <Input className="h-8 font-mono text-xs" placeholder="e.g. npm test" value={form.command}
              onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Working Dir (optional)</Label>
              <Input className="h-8 font-mono text-xs" placeholder="inherits pipeline" value={form.workingDirectory}
                onChange={(e) => setForm((f) => ({ ...f, workingDirectory: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Timeout (seconds)</Label>
              <Input type="number" className="h-8 text-xs" value={form.timeout}
                onChange={(e) => setForm((f) => ({ ...f, timeout: +e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Continue on Error</Label>
            <Switch checked={form.continueOnError} onCheckedChange={(v) => setForm((f) => ({ ...f, continueOnError: v }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!form.name.trim() || !form.command.trim() || isPending}
            onClick={() => onAdd({ name: form.name, command: form.command, workingDirectory: form.workingDirectory || undefined, timeout: form.timeout, continueOnError: form.continueOnError })}>
            {isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
            Add Step
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
