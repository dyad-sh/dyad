/**
 * OpenClaw Kanban Board Page
 * Visual task board with drag-and-drop, analytics, and activity feed
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { IpldReceiptRecord } from "@/types/ipld_receipt";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  RefreshCw,
  GripVertical,
  Search,
  Filter,
  BarChart3,
  Clock,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Activity,
  Bot,
  Cpu,
  Layers,
  Timer,
  TrendingUp,
  CircleDot,
  ChevronDown,
  ChevronUp,
  Eye,
  Pencil,
  FileText,
  Shield,
  Radio,
  Hash,
  ExternalLink,
  ShieldCheck,
  Loader2,
  Wifi,
  WifiOff,
  Sparkles,
  Workflow,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

import { NlpAiStudioPanel } from "@/components/openclaw/NlpAiStudioPanel";
import { useAvailableModels, useTaskRating } from "@/hooks/useOpenClaw";

// ─── Constants ──────────────────────────────────────────────────────────────

const COLUMNS = [
  {
    id: "backlog" as const,
    label: "Backlog",
    color: "bg-gray-500",
    textColor: "text-gray-400",
    borderColor: "border-gray-700",
    icon: Layers,
  },
  {
    id: "todo" as const,
    label: "To Do",
    color: "bg-blue-500",
    textColor: "text-blue-400",
    borderColor: "border-blue-700",
    icon: CircleDot,
  },
  {
    id: "in_progress" as const,
    label: "In Progress",
    color: "bg-amber-500",
    textColor: "text-amber-400",
    borderColor: "border-amber-700",
    icon: Timer,
  },
  {
    id: "review" as const,
    label: "Review",
    color: "bg-purple-500",
    textColor: "text-purple-400",
    borderColor: "border-purple-700",
    icon: Eye,
  },
  {
    id: "completed" as const,
    label: "Completed",
    color: "bg-green-500",
    textColor: "text-green-400",
    borderColor: "border-green-700",
    icon: CheckCircle2,
  },
  {
    id: "failed" as const,
    label: "Failed",
    color: "bg-red-500",
    textColor: "text-red-400",
    borderColor: "border-red-700",
    icon: XCircle,
  },
  {
    id: "cancelled" as const,
    label: "Cancelled",
    color: "bg-gray-600",
    textColor: "text-gray-500",
    borderColor: "border-gray-600",
    icon: XCircle,
  },
];

const TASK_TYPES = [
  "research",
  "build",
  "analyze",
  "optimize",
  "automate",
  "code_generation",
  "refactor",
  "debug",
  "deploy",
  "data_pipeline",
  "agent_task",
  "workflow",
  "custom",
] as const;

const PRIORITIES = ["critical", "high", "medium", "low"] as const;

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-gray-500 text-white",
};

const TYPE_COLORS: Record<string, string> = {
  research: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  build: "bg-green-500/20 text-green-400 border-green-500/30",
  analyze: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  optimize: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  automate: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  code_generation: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  refactor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  debug: "bg-red-500/20 text-red-400 border-red-500/30",
  deploy: "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30",
  data_pipeline: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  agent_task: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  workflow: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  custom: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

// ─── Task Card ──────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onMove,
  onDelete,
  onSelect,
}: {
  task: any;
  onMove: (taskId: string, status: string) => void;
  onDelete: (taskId: string) => void;
  onSelect: (task: any) => void;
}) {
  const [showActions, setShowActions] = useState(false);

  const currentColIdx = COLUMNS.findIndex((c) => c.id === task.status);
  const canMoveRight =
    currentColIdx < COLUMNS.length - 1 &&
    task.status !== "completed" &&
    task.status !== "failed" &&
    task.status !== "cancelled";

  return (
    <div
      className="group relative rounded-lg border border-white/10 bg-white/5 p-3 hover:bg-white/8 hover:border-white/20 transition-all cursor-pointer"
      onClick={() => onSelect(task)}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("taskId", task.id);
        e.dataTransfer.setData("fromStatus", task.status);
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <GripVertical className="w-3.5 h-3.5 text-white/20 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="text-sm font-medium text-white/90 leading-tight flex-1 line-clamp-2">
          {task.title}
        </span>
        <Badge
          className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[task.priority] ?? ""} flex-shrink-0`}
        >
          {task.priority}
        </Badge>
      </div>

      {/* Type Badge */}
      <div className="flex items-center gap-1.5 mb-2">
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 border ${TYPE_COLORS[task.taskType] ?? TYPE_COLORS.custom}`}
        >
          {task.taskType?.replace("_", " ")}
        </Badge>
        {task.provider && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-white/10 text-white/50"
          >
            {task.provider}
          </Badge>
        )}
        {task.localProcessed && (
          <Cpu className="w-3 h-3 text-green-400" />
        )}
      </div>

      {/* Metrics row */}
      {(task.tokensUsed > 0 || task.durationMs > 0) && (
        <div className="flex items-center gap-2 text-[10px] text-white/40">
          {task.tokensUsed > 0 && (
            <span className="flex items-center gap-0.5">
              <Zap className="w-2.5 h-2.5" />
              {task.tokensUsed.toLocaleString()} tok
            </span>
          )}
          {task.durationMs > 0 && (
            <span className="flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {formatDuration(task.durationMs)}
            </span>
          )}
        </div>
      )}

      {/* Labels */}
      {task.labels && task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {task.labels.slice(0, 3).map((label: string) => (
            <span
              key={label}
              className="text-[9px] px-1.5 py-0 rounded-full bg-white/10 text-white/50"
            >
              {label}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="text-[9px] text-white/30">+{task.labels.length - 3}</span>
          )}
        </div>
      )}

      {/* Quick actions */}
      {showActions && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {canMoveRight && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const nextCol = COLUMNS[currentColIdx + 1];
                if (nextCol) onMove(task.id, nextCol.id);
              }}
              className="p-1 rounded bg-white/10 hover:bg-white/20 transition"
              title="Move to next column"
            >
              <ArrowRight className="w-3 h-3 text-white/70" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task.id);
            }}
            className="p-1 rounded bg-red-500/20 hover:bg-red-500/40 transition"
            title="Delete task"
          >
            <Trash2 className="w-3 h-3 text-red-400" />
          </button>
        </div>
      )}

      {/* Assignee */}
      {task.assignee && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-white/30">
          <Bot className="w-2.5 h-2.5" />
          {task.assignee}
        </div>
      )}
    </div>
  );
}

// ─── Kanban Column ──────────────────────────────────────────────────────────

function KanbanColumn({
  column,
  tasks,
  onMove,
  onDelete,
  onSelect,
}: {
  column: (typeof COLUMNS)[number];
  tasks: any[];
  onMove: (taskId: string, status: string) => void;
  onDelete: (taskId: string) => void;
  onSelect: (task: any) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const Icon = column.icon;

  return (
    <div
      className={`flex flex-col min-w-[280px] max-w-[320px] rounded-xl border transition-all ${
        isDragOver
          ? `${column.borderColor} bg-white/5`
          : "border-white/5 bg-white/[0.02]"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const taskId = e.dataTransfer.getData("taskId");
        const fromStatus = e.dataTransfer.getData("fromStatus");
        if (taskId && fromStatus !== column.id) {
          onMove(taskId, column.id);
        }
      }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 p-3 pb-2">
        <div className={`w-2 h-2 rounded-full ${column.color}`} />
        <Icon className={`w-4 h-4 ${column.textColor}`} />
        <span className="text-sm font-medium text-white/80">{column.label}</span>
        <Badge
          variant="outline"
          className="ml-auto text-[10px] px-1.5 py-0 border-white/10 text-white/40"
        >
          {tasks.length}
        </Badge>
      </div>

      {/* Tasks */}
      <ScrollArea className="flex-1 px-2 pb-2" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <div className="flex flex-col gap-2 p-1">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onMove={onMove}
              onDelete={onDelete}
              onSelect={onSelect}
            />
          ))}
          {tasks.length === 0 && (
            <div className="flex items-center justify-center py-8 text-white/20 text-xs">
              No tasks
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Create Task Dialog ─────────────────────────────────────────────────────

function CreateTaskDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (params: any) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<string>("custom");
  const [priority, setPriority] = useState<string>("medium");
  const [status, setStatus] = useState<string>("backlog");
  const [assignee, setAssignee] = useState("openclaw");
  const [labelsText, setLabelsText] = useState("");
  const [selectedModel, setSelectedModel] = useState("auto");

  const { models } = useAvailableModels({ taskType: taskType !== "custom" ? taskType : undefined });

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    const labels = labelsText
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);

    onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      taskType,
      priority,
      status,
      assignee: assignee || "openclaw",
      labels: labels.length > 0 ? labels : undefined,
      model: selectedModel !== "auto" ? selectedModel : undefined,
    });

    // Reset
    setTitle("");
    setDescription("");
    setTaskType("custom");
    setPriority("medium");
    setStatus("backlog");
    setAssignee("openclaw");
    setLabelsText("");
    setSelectedModel("auto");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>
            Add a new task to the OpenClaw kanban board.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details..."
              rows={3}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={taskType} onValueChange={setTaskType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Column</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLUMNS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Assignee</Label>
              <Input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="openclaw"
              />
            </div>
            <div>
              <Label>Labels (comma separated)</Label>
              <Input
                value={labelsText}
                onChange={(e) => setLabelsText(e.target.value)}
                placeholder="e.g. urgent, api, refactor"
              />
            </div>
          </div>
          <div>
            <Label>Model</Label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger>
                <SelectValue placeholder="Auto (MAB selects best)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (MAB selects best)</SelectItem>
                {models.map((m: any) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name}{m.source === "peer" ? " (peer)" : m.source === "registry" ? " (registry)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Create Task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Task Detail Dialog ─────────────────────────────────────────────────────

function TaskDetailDialog({
  task,
  open,
  onOpenChange,
  onUpdate,
}: {
  task: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (params: any) => void;
}) {
  const ipc = IpcClient.getInstance();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task?.title ?? "");
  const [editDesc, setEditDesc] = useState(task?.description ?? "");

  const { data: activities } = useQuery({
    queryKey: ["kanban-activity", task?.id],
    queryFn: () => ipc.listKanbanActivity({ taskId: task?.id, limit: 50 }),
    enabled: !!task?.id && open,
  });

  const { rateTask, isRating } = useTaskRating();
  const [userRating, setUserRating] = useState<number | null>(null);

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge
              className={`text-[10px] ${PRIORITY_COLORS[task.priority] ?? ""}`}
            >
              {task.priority}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] border ${TYPE_COLORS[task.taskType] ?? TYPE_COLORS.custom}`}
            >
              {task.taskType?.replace("_", " ")}
            </Badge>
          </div>
          {editing ? (
            <div className="space-y-2 pt-2">
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={3}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    onUpdate({
                      id: task.id,
                      title: editTitle,
                      description: editDesc,
                    });
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <DialogTitle className="flex items-center gap-2">
                {task.title}
                <button
                  onClick={() => {
                    setEditTitle(task.title);
                    setEditDesc(task.description ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5 text-white/30 hover:text-white/60" />
                </button>
              </DialogTitle>
              {task.description && (
                <DialogDescription>{task.description}</DialogDescription>
              )}
            </>
          )}
        </DialogHeader>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <span className="text-white/40 text-xs">Status</span>
            <Select
              value={task.status}
              onValueChange={(val) => onUpdate({ id: task.id, status: val })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMNS.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-white/40 text-xs">Priority</span>
            <Select
              value={task.priority}
              onValueChange={(val) => onUpdate({ id: task.id, priority: val })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Metrics */}
        {(task.tokensUsed > 0 || task.durationMs > 0 || task.provider) && (
          <>
            <Separator />
            <div className="grid grid-cols-2 gap-3 text-sm">
              {task.provider && (
                <div>
                  <span className="text-white/40 text-xs block">Provider</span>
                  <span className="text-white/80">
                    {task.provider}
                    {task.model ? ` / ${task.model}` : ""}
                  </span>
                </div>
              )}
              {task.tokensUsed > 0 && (
                <div>
                  <span className="text-white/40 text-xs block">Tokens</span>
                  <span className="text-white/80">
                    {task.tokensUsed.toLocaleString()}
                  </span>
                </div>
              )}
              {task.durationMs > 0 && (
                <div>
                  <span className="text-white/40 text-xs block">Duration</span>
                  <span className="text-white/80">
                    {formatDuration(task.durationMs)}
                  </span>
                </div>
              )}
              {task.localProcessed && (
                <div>
                  <span className="text-white/40 text-xs block">Processing</span>
                  <span className="text-green-400 flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> Local
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Rating (for completed tasks with a result) */}
        {(task.status === "completed" || task.status === "failed") && task.model && (
          <>
            <Separator />
            <div>
              <span className="text-white/40 text-xs block mb-2">Rate Result</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={userRating === 5 ? "default" : "outline"}
                  className={userRating === 5 ? "bg-green-600 hover:bg-green-700" : ""}
                  disabled={isRating}
                  onClick={() => {
                    setUserRating(5);
                    rateTask({ taskId: task.id, rating: 5, feedback: "Good result" });
                    toast.success("Rated positive — MAB updated");
                  }}
                >
                  <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Good
                </Button>
                <Button
                  size="sm"
                  variant={userRating === 1 ? "default" : "outline"}
                  className={userRating === 1 ? "bg-red-600 hover:bg-red-700" : ""}
                  disabled={isRating}
                  onClick={() => {
                    setUserRating(1);
                    rateTask({ taskId: task.id, rating: 1, feedback: "Poor result" });
                    toast.success("Rated negative — MAB updated");
                  }}
                >
                  <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Poor
                </Button>
                {userRating && (
                  <span className="text-xs text-white/30 ml-2">Feedback recorded</span>
                )}
              </div>
            </div>
          </>
        )}

        {/* Error */}
        {task.errorMessage && (
          <>
            <Separator />
            <div className="p-2 rounded bg-red-500/10 text-red-400 text-xs border border-red-500/20">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              {task.errorMessage}
            </div>
          </>
        )}

        {/* Activity Log */}
        {activities && activities.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-xs font-medium text-white/50 mb-2 flex items-center gap-1">
                <Activity className="w-3 h-3" /> Activity
              </h4>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {activities.map((act: any) => (
                  <div
                    key={act.id}
                    className="flex items-center gap-2 text-[11px] text-white/40"
                  >
                    <span className="text-white/60">{act.actor}</span>
                    <span>{act.action.replace("_", " ")}</span>
                    {act.fromValue && act.toValue && (
                      <>
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0"
                        >
                          {act.fromValue}
                        </Badge>
                        <ArrowRight className="w-2.5 h-2.5" />
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0"
                        >
                          {act.toValue}
                        </Badge>
                      </>
                    )}
                    <span className="ml-auto text-white/20">
                      {formatRelativeTime(act.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Analytics Panel ────────────────────────────────────────────────────────

function AnalyticsPanel({ analytics }: { analytics: any }) {
  if (!analytics) return null;

  const { metrics, statusCounts, typeCounts, priorityCounts, providerCounts, completionsOverTime } =
    analytics;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="Total Tasks"
          value={metrics.totalTasks}
          icon={<Layers className="w-4 h-4 text-blue-400" />}
        />
        <MetricCard
          title="Completion Rate"
          value={`${metrics.completionRate}%`}
          icon={<CheckCircle2 className="w-4 h-4 text-green-400" />}
          progressValue={metrics.completionRate}
          progressColor="bg-green-500"
        />
        <MetricCard
          title="Failure Rate"
          value={`${metrics.failureRate}%`}
          icon={<XCircle className="w-4 h-4 text-red-400" />}
          progressValue={metrics.failureRate}
          progressColor="bg-red-500"
        />
        <MetricCard
          title="Local Processing"
          value={`${metrics.localProcessedPercent}%`}
          icon={<Cpu className="w-4 h-4 text-emerald-400" />}
          progressValue={metrics.localProcessedPercent}
          progressColor="bg-emerald-500"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="Total Tokens"
          value={metrics.totalTokens.toLocaleString()}
          icon={<Zap className="w-4 h-4 text-amber-400" />}
        />
        <MetricCard
          title="Avg Duration"
          value={formatDuration(metrics.avgDurationMs)}
          icon={<Clock className="w-4 h-4 text-purple-400" />}
        />
        <MetricCard
          title="Total Time"
          value={formatDuration(metrics.totalDurationMs)}
          icon={<Timer className="w-4 h-4 text-cyan-400" />}
        />
        <MetricCard
          title="Completed"
          value={statusCounts.completed ?? 0}
          icon={<TrendingUp className="w-4 h-4 text-green-400" />}
        />
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <BreakdownCard title="By Status" data={statusCounts} />
        <BreakdownCard title="By Type" data={typeCounts} />
        <BreakdownCard title="By Priority" data={priorityCounts} />
        <BreakdownCard title="By Provider" data={providerCounts} />
      </div>

      {/* Completions over time */}
      {completionsOverTime && completionsOverTime.length > 0 && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-white/70">
              Completions (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {completionsOverTime.map((d: any, i: number) => {
                const maxCount = Math.max(
                  ...completionsOverTime.map((x: any) => x.count)
                );
                const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`${d.day}: ${d.count} completed`}
                  >
                    <div
                      className="w-full bg-green-500/40 rounded-sm min-h-[2px]"
                      style={{ height: `${height}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] text-white/20 mt-1">
              <span>
                {completionsOverTime[0]?.day ?? ""}
              </span>
              <span>
                {completionsOverTime[completionsOverTime.length - 1]?.day ?? ""}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      {analytics.recentActivity && analytics.recentActivity.length > 0 && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-white/70 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[250px]">
              <div className="space-y-1.5">
                {analytics.recentActivity.map((act: any) => (
                  <div
                    key={act.id}
                    className="flex items-center gap-2 text-xs text-white/40 py-1"
                  >
                    <span className="text-white/60 font-medium min-w-[60px]">
                      {act.actor}
                    </span>
                    <span>{act.action.replace("_", " ")}</span>
                    {act.fromValue && act.toValue && (
                      <>
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0"
                        >
                          {act.fromValue}
                        </Badge>
                        <ArrowRight className="w-2.5 h-2.5" />
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0"
                        >
                          {act.toValue}
                        </Badge>
                      </>
                    )}
                    <span className="ml-auto text-white/20 text-[10px] whitespace-nowrap">
                      {formatRelativeTime(act.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  progressValue,
  progressColor,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  progressValue?: number;
  progressColor?: string;
}) {
  return (
    <Card className="bg-white/[0.02] border-white/5">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-white/40">{title}</span>
          {icon}
        </div>
        <div className="text-lg font-bold text-white/90">{value}</div>
        {progressValue !== undefined && (
          <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full ${progressColor ?? "bg-blue-500"}`}
              style={{ width: `${Math.min(progressValue, 100)}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BreakdownCard({
  title,
  data,
}: {
  title: string;
  data: Record<string, number>;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  return (
    <Card className="bg-white/[0.02] border-white/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-white/50">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="text-white/60 flex-1 truncate">
              {key.replace("_", " ")}
            </span>
            <span className="text-white/40 tabular-nums">{val}</span>
            <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500/60"
                style={{
                  width: `${total > 0 ? (val / total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <span className="text-[10px] text-white/20">No data</span>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function formatRelativeTime(timestamp: any): string {
  if (!timestamp) return "";
  const date = typeof timestamp === "number"
    ? new Date(timestamp * 1000)
    : new Date(timestamp);
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

// ─── Inference Panel ────────────────────────────────────────────────────────

function InferencePanel() {
  const ipc = IpcClient.getInstance();
  const [expandedCid, setExpandedCid] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<
    Record<string, { valid: boolean; computedCid: string }>
  >({});

  const { data: receipts = [], isLoading } = useQuery<IpldReceiptRecord[]>({
    queryKey: ["ipld-receipts"],
    queryFn: () => ipc.listIpldReceipts(),
    refetchInterval: 15_000,
  });

  const { data: bridgeState } = useQuery({
    queryKey: ["inference-bridge-state"],
    queryFn: () => ipc.getInferenceBridgeState(),
    refetchInterval: 10_000,
  });

  const handleVerify = async (cid: string) => {
    setVerifying(cid);
    try {
      const result = await ipc.verifyIpldReceipt(cid);
      setVerifyResults((prev) => ({ ...prev, [cid]: result }));
      toast.success(result.valid ? "Receipt verified" : "Verification failed");
    } catch (err: any) {
      toast.error(`Verify failed: ${err.message}`);
    } finally {
      setVerifying(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 text-white/30">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading inference data...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bridge Status */}
      {bridgeState && (
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-white/70 flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              Privacy-Preserving Inference Bridge
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-white/40 block">Status</span>
                <span className={`font-medium ${bridgeState.initialized ? "text-green-400" : "text-yellow-400"}`}>
                  {bridgeState.initialized ? "Active" : "Inactive"}
                </span>
              </div>
              {bridgeState.localModelsAvailable !== undefined && (
                <div>
                  <span className="text-white/40 block">Local Models</span>
                  <span className="text-white/80">{bridgeState.localModelsAvailable}</span>
                </div>
              )}
              {bridgeState.totalInferences !== undefined && (
                <div>
                  <span className="text-white/40 block">Total Inferences</span>
                  <span className="text-white/80">{bridgeState.totalInferences}</span>
                </div>
              )}
              {bridgeState.localInferences !== undefined && (
                <div>
                  <span className="text-white/40 block">Local Inferences</span>
                  <span className="text-white/80">{bridgeState.localInferences}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="Total Receipts"
          value={receipts.length}
          icon={<FileText className="w-4 h-4 text-blue-400" />}
        />
        <MetricCard
          title="Models Used"
          value={new Set(receipts.map((r) => r.receipt.model.id)).size}
          icon={<Cpu className="w-4 h-4 text-purple-400" />}
        />
        <MetricCard
          title="Issuers"
          value={new Set(receipts.map((r) => r.receipt.issuer)).size}
          icon={<Bot className="w-4 h-4 text-amber-400" />}
        />
        <MetricCard
          title="Signed"
          value={receipts.filter((r) => r.receipt.sig?.value).length}
          icon={<ShieldCheck className="w-4 h-4 text-green-400" />}
        />
      </div>

      {/* Receipt List */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/70 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Inference Receipts ({receipts.length})
          </CardTitle>
          <CardDescription className="text-xs text-white/30">
            Content-addressed IPLD receipts for every inference call
          </CardDescription>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <div className="text-center py-8 text-white/20 text-sm">
              No inference receipts yet. Receipts are created when AI inferences run.
            </div>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-2">
                {receipts
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((rec) => {
                    const r = rec.receipt;
                    const isExpanded = expandedCid === rec.cid;
                    const verified = verifyResults[rec.cid];
                    return (
                      <div
                        key={rec.cid}
                        className="rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                      >
                        <button
                          type="button"
                          className="w-full text-left p-3"
                          onClick={() => setExpandedCid(isExpanded ? null : rec.cid)}
                        >
                          <div className="flex items-center gap-2">
                            <Hash className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                            <span className="text-xs font-mono text-white/60 truncate flex-1">
                              {rec.cid}
                            </span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-white/10 text-white/50">
                              {r.model.id}
                            </Badge>
                            {r.sig?.value && (
                              <ShieldCheck className="w-3 h-3 text-green-400 flex-shrink-0" />
                            )}
                            {verified && (
                              <Badge
                                className={`text-[9px] px-1 py-0 ${verified.valid ? "bg-green-600" : "bg-red-600"}`}
                              >
                                {verified.valid ? "Verified" : "Invalid"}
                              </Badge>
                            )}
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5 text-white/30" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-white/30" />
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/30">
                            <span>Issuer: {r.issuer.slice(0, 10)}...</span>
                            <span>Payer: {r.payer.slice(0, 10)}...</span>
                            <span className="ml-auto">
                              {formatRelativeTime(rec.createdAt)}
                            </span>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-white/40 block">Model</span>
                                <span className="text-white/80 font-mono text-[11px]">{r.model.id}</span>
                              </div>
                              <div>
                                <span className="text-white/40 block">Model Hash</span>
                                <span className="text-white/60 font-mono text-[11px] truncate block">
                                  {r.model.hash ?? "—"}
                                </span>
                              </div>
                              <div>
                                <span className="text-white/40 block">Data Hash</span>
                                <span className="text-white/60 font-mono text-[11px] truncate block">
                                  {r.data.hash}
                                </span>
                              </div>
                              <div>
                                <span className="text-white/40 block">Prompt Hash</span>
                                <span className="text-white/60 font-mono text-[11px] truncate block">
                                  {r.prompt.hash}
                                </span>
                              </div>
                              {r.output?.hash && (
                                <div>
                                  <span className="text-white/40 block">Output Hash</span>
                                  <span className="text-white/60 font-mono text-[11px] truncate block">
                                    {r.output.hash}
                                  </span>
                                </div>
                              )}
                              <div>
                                <span className="text-white/40 block">Payment</span>
                                <span className="text-white/80">
                                  {r.payment.amount ?? "0"} {r.payment.currency} ({r.payment.chain})
                                </span>
                              </div>
                              {r.payment.tx && (
                                <div>
                                  <span className="text-white/40 block">Tx Hash</span>
                                  <span className="text-white/60 font-mono text-[11px] truncate block">
                                    {r.payment.tx}
                                  </span>
                                </div>
                              )}
                              {r.license?.id && (
                                <div>
                                  <span className="text-white/40 block">License</span>
                                  <span className="text-white/80">
                                    {r.license.id} {r.license.scope ? `(${r.license.scope})` : ""}
                                  </span>
                                </div>
                              )}
                              {r.sig && (
                                <div className="col-span-2">
                                  <span className="text-white/40 block">Signature ({r.sig.alg})</span>
                                  <span className="text-white/60 font-mono text-[11px] truncate block">
                                    {r.sig.value}
                                  </span>
                                </div>
                              )}
                              <div>
                                <span className="text-white/40 block">Timestamp</span>
                                <span className="text-white/80">
                                  {new Date(r.ts * 1000).toLocaleString()}
                                </span>
                              </div>
                              <div>
                                <span className="text-white/40 block">Issuer (full)</span>
                                <span className="text-white/60 font-mono text-[11px] truncate block">
                                  {r.issuer}
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px]"
                                disabled={verifying === rec.cid}
                                onClick={() => handleVerify(rec.cid)}
                              >
                                {verifying === rec.cid ? (
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                  <ShieldCheck className="w-3 h-3 mr-1" />
                                )}
                                Verify
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Audit Trail Panel ──────────────────────────────────────────────────────

function AuditTrailPanel() {
  const ipc = IpcClient.getInstance();
  const [limit, setLimit] = useState(100);

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["kanban-audit-trail", limit],
    queryFn: () => ipc.listKanbanActivity({ limit }),
    refetchInterval: 5_000,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["kanban-tasks-audit"],
    queryFn: () => ipc.listKanbanTasks(),
    refetchInterval: 15_000,
  });

  // Build task title lookup
  const taskTitleMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tasks) {
      map[t.id] = t.title;
    }
    return map;
  }, [tasks]);

  // Group by date
  const groupedActivities = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const activity of activities) {
      const date =
        typeof activity.createdAt === "number"
          ? new Date(activity.createdAt * 1000)
          : new Date(activity.createdAt);
      const dayKey = date.toLocaleDateString();
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(activity);
    }
    return groups;
  }, [activities]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 text-white/30">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading audit trail...
      </div>
    );
  }

  const actionIcon = (action: string) => {
    if (action.includes("create")) return <Plus className="w-3 h-3 text-green-400" />;
    if (action.includes("delete")) return <Trash2 className="w-3 h-3 text-red-400" />;
    if (action.includes("move") || action.includes("status"))
      return <ArrowRight className="w-3 h-3 text-blue-400" />;
    if (action.includes("update") || action.includes("edit"))
      return <Pencil className="w-3 h-3 text-amber-400" />;
    return <Activity className="w-3 h-3 text-white/40" />;
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="Total Events"
          value={activities.length}
          icon={<Activity className="w-4 h-4 text-blue-400" />}
        />
        <MetricCard
          title="Unique Actors"
          value={new Set(activities.map((a: any) => a.actor)).size}
          icon={<Bot className="w-4 h-4 text-purple-400" />}
        />
        <MetricCard
          title="Tasks Touched"
          value={new Set(activities.map((a: any) => a.taskId).filter(Boolean)).size}
          icon={<Layers className="w-4 h-4 text-amber-400" />}
        />
        <MetricCard
          title="Action Types"
          value={new Set(activities.map((a: any) => a.action)).size}
          icon={<Zap className="w-4 h-4 text-cyan-400" />}
        />
      </div>

      {/* Timeline */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-white/70 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              Audit Timeline
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => setLimit((l) => l + 100)}
            >
              Load More
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <div className="text-center py-8 text-white/20 text-sm">
              No audit events recorded yet.
            </div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-4">
                {Object.entries(groupedActivities).map(([day, dayActivities]) => (
                  <div key={day}>
                    <div className="sticky top-0 bg-background/80 backdrop-blur-sm py-1 mb-2 z-10">
                      <span className="text-[11px] font-medium text-white/40 px-2 py-0.5 rounded bg-white/5">
                        {day}
                      </span>
                    </div>
                    <div className="space-y-1 pl-2 border-l border-white/5">
                      {dayActivities.map((act: any) => (
                        <div
                          key={act.id}
                          className="flex items-start gap-2 text-xs text-white/50 py-1.5 pl-3 hover:bg-white/[0.02] rounded-r transition"
                        >
                          <div className="flex-shrink-0 mt-0.5">{actionIcon(act.action)}</div>
                          <div className="flex-1 min-w-0">
                            <span className="text-white/70 font-medium">{act.actor}</span>
                            <span className="mx-1">{act.action.replace(/_/g, " ")}</span>
                            {act.taskId && taskTitleMap[act.taskId] && (
                              <span className="text-white/40">
                                on &quot;{taskTitleMap[act.taskId]}&quot;
                              </span>
                            )}
                            {act.fromValue && act.toValue && (
                              <span className="ml-1">
                                <Badge variant="outline" className="text-[9px] px-1 py-0">
                                  {act.fromValue}
                                </Badge>
                                <ArrowRight className="w-2.5 h-2.5 inline mx-0.5" />
                                <Badge variant="outline" className="text-[9px] px-1 py-0">
                                  {act.toValue}
                                </Badge>
                              </span>
                            )}
                            {act.details && (
                              <span className="text-white/30 ml-1 text-[10px]">{act.details}</span>
                            )}
                          </div>
                          <span className="text-white/20 text-[10px] whitespace-nowrap flex-shrink-0">
                            {formatRelativeTime(act.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Live Feed Panel ────────────────────────────────────────────────────────

function LiveFeedPanel({
  events,
  connected,
}: {
  events: LiveEvent[];
  connected: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Status */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            {connected ? (
              <>
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <Wifi className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-400 font-medium">Connected to OpenClaw Gateway</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <WifiOff className="w-4 h-4 text-red-400" />
                <span className="text-sm text-red-400 font-medium">Disconnected</span>
              </>
            )}
            <span className="ml-auto text-[10px] text-white/30">{events.length} events captured</span>
          </div>
        </CardContent>
      </Card>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="Events"
          value={events.length}
          icon={<Radio className="w-4 h-4 text-blue-400" />}
        />
        <MetricCard
          title="Task Updates"
          value={events.filter((e) => e.type === "task_update" || e.type === "task_move").length}
          icon={<ArrowRight className="w-4 h-4 text-amber-400" />}
        />
        <MetricCard
          title="Inferences"
          value={events.filter((e) => e.type === "inference").length}
          icon={<Zap className="w-4 h-4 text-purple-400" />}
        />
        <MetricCard
          title="Errors"
          value={events.filter((e) => e.type === "error").length}
          icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
        />
      </div>

      {/* Event Stream */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/70 flex items-center gap-2">
            <Radio className="w-4 h-4 text-blue-400" />
            Live Event Stream
          </CardTitle>
          <CardDescription className="text-xs text-white/30">
            Real-time events from OpenClaw gateway (ws://127.0.0.1:18789)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="text-center py-8 text-white/20 text-sm">
              {connected
                ? "Waiting for events..."
                : "Connect to OpenClaw gateway to see live events."}
            </div>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-1 font-mono text-[11px]">
                {[...events].reverse().map((event) => (
                  <div
                    key={event.id}
                    className={`flex items-start gap-2 py-1.5 px-2 rounded transition ${
                      event.type === "error"
                        ? "bg-red-500/5 border border-red-500/10"
                        : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <span className="text-white/20 flex-shrink-0 tabular-nums">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 flex-shrink-0 ${
                        event.type === "task_update"
                          ? "border-blue-500/30 text-blue-400"
                          : event.type === "inference"
                            ? "border-purple-500/30 text-purple-400"
                            : event.type === "error"
                              ? "border-red-500/30 text-red-400"
                              : event.type === "task_move"
                                ? "border-amber-500/30 text-amber-400"
                                : "border-white/10 text-white/40"
                      }`}
                    >
                      {event.type}
                    </Badge>
                    <span className="text-white/60 flex-1 truncate">{event.message}</span>
                    {event.taskId && (
                      <span className="text-white/20 flex-shrink-0">#{event.taskId.slice(0, 8)}</span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Live Event Interface ───────────────────────────────────────────────────

interface LiveEvent {
  id: string;
  type: string;
  message: string;
  timestamp: number;
  taskId?: string;
  data?: any;
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function OpenClawKanbanPage() {
  const ipc = IpcClient.getInstance();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("board");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // ── WebSocket for live events ──
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    const connect = () => {
      try {
        const token = import.meta.env.VITE_OPENCLAW_GATEWAY_TOKEN || "";
        const wsUrl = `ws://127.0.0.1:18789${token ? `?token=${encodeURIComponent(token)}` : ""}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mounted) return;
          setWsConnected(true);
          setLiveEvents((prev) => [
            ...prev,
            {
              id: `sys-${Date.now()}`,
              type: "system",
              message: "Connected to OpenClaw gateway",
              timestamp: Date.now(),
            },
          ]);
        };

        ws.onmessage = (event) => {
          if (!mounted) return;
          try {
            const data = JSON.parse(event.data);
            const liveEvent: LiveEvent = {
              id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: data.type ?? "message",
              message: data.message ?? data.action ?? JSON.stringify(data).slice(0, 200),
              timestamp: data.timestamp ?? Date.now(),
              taskId: data.taskId,
              data,
            };
            setLiveEvents((prev) => [...prev.slice(-499), liveEvent]);

            // Auto-refresh queries on task changes
            if (data.type === "task_update" || data.type === "task_move" || data.type === "task_create") {
              queryClient.invalidateQueries({ queryKey: ["kanban-tasks"] });
              queryClient.invalidateQueries({ queryKey: ["kanban-analytics"] });
            }
          } catch {
            // non-JSON message
            setLiveEvents((prev) => [
              ...prev.slice(-499),
              {
                id: `raw-${Date.now()}`,
                type: "raw",
                message: String(event.data).slice(0, 200),
                timestamp: Date.now(),
              },
            ]);
          }
        };

        ws.onclose = () => {
          if (!mounted) return;
          setWsConnected(false);
          // Reconnect after 5s
          reconnectTimer.current = setTimeout(connect, 5000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        // Gateway not available — retry later
        if (mounted) {
          reconnectTimer.current = setTimeout(connect, 10000);
        }
      }
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [queryClient]);

  // Queries
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["kanban-tasks", searchQuery, filterType, filterPriority],
    queryFn: () =>
      ipc.listKanbanTasks({
        search: searchQuery || undefined,
        taskType: filterType !== "all" ? filterType : undefined,
        priority: filterPriority !== "all" ? filterPriority : undefined,
      }),
    refetchInterval: 10_000,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["kanban-analytics"],
    queryFn: () => ipc.getKanbanAnalytics(),
    refetchInterval: 30_000,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (params: any) => ipc.createKanbanTask(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanban-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-analytics"] });
      toast.success("Task created");
    },
    onError: (err: any) => toast.error(`Failed to create task: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: (params: any) => ipc.updateKanbanTask(params),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["kanban-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-activity"] });
      if (selectedTask && updated?.id === selectedTask.id) {
        setSelectedTask(updated);
      }
    },
    onError: (err: any) => toast.error(`Failed to update task: ${err.message}`),
  });

  const moveMutation = useMutation({
    mutationFn: (params: { taskId: string; status: string; sortOrder: number }) =>
      ipc.moveKanbanTask(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanban-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-analytics"] });
    },
    onError: (err: any) => toast.error(`Failed to move task: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => ipc.deleteKanbanTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanban-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-analytics"] });
      toast.success("Task deleted");
    },
    onError: (err: any) => toast.error(`Failed to delete task: ${err.message}`),
  });

  // Group tasks by column
  const tasksByColumn = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const col of COLUMNS) {
      groups[col.id] = [];
    }
    for (const task of tasks) {
      if (groups[task.status]) {
        groups[task.status].push(task);
      } else {
        groups.backlog.push(task);
      }
    }
    return groups;
  }, [tasks]);

  const handleMove = useCallback(
    (taskId: string, status: string) => {
      const targetTasks = tasksByColumn[status] ?? [];
      const sortOrder = targetTasks.length;
      moveMutation.mutate({ taskId, status, sortOrder });
    },
    [tasksByColumn, moveMutation]
  );

  const handleDelete = useCallback(
    (taskId: string) => {
      if (confirm("Delete this task?")) {
        deleteMutation.mutate(taskId);
      }
    },
    [deleteMutation]
  );

  const handleSelectTask = useCallback((task: any) => {
    setSelectedTask(task);
    setDetailOpen(true);
  }, []);

  const inProgressCount = tasksByColumn.in_progress?.length ?? 0;
  const completedCount = tasksByColumn.completed?.length ?? 0;
  const totalCount = tasks.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 p-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white/90">OpenClaw Kanban</h1>
              <p className="text-[11px] text-white/40">
                {totalCount} tasks &middot; {inProgressCount} active &middot;{" "}
                {completedCount} done
                {wsConnected && (
                  <span className="ml-2 text-green-400">
                    <Wifi className="w-3 h-3 inline" /> Live
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["kanban-tasks"] })
            }
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${tasksLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Task
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="flex-shrink-0 px-4 pt-2 border-b border-white/5 flex items-center gap-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="board" className="text-xs">
              <Layers className="w-3.5 h-3.5 mr-1.5" />
              Board
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs">
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="inference" className="text-xs">
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              Inference
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs">
              <Shield className="w-3.5 h-3.5 mr-1.5" />
              Audit Trail
            </TabsTrigger>
            <TabsTrigger value="live" className="text-xs relative">
              <Radio className="w-3.5 h-3.5 mr-1.5" />
              Live Feed
              {wsConnected && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              )}
            </TabsTrigger>
            <TabsTrigger value="studio" className="text-xs">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              AI Studio
            </TabsTrigger>
          </TabsList>

          {/* Filters (board tab only) */}
          {activeTab === "board" && (
            <div className="flex items-center gap-2 ml-auto">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tasks..."
                  className="pl-7 h-7 text-xs w-[180px]"
                />
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-7 text-xs w-[120px]">
                  <Filter className="w-3 h-3 mr-1" />
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="h-7 text-xs w-[110px]">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Board Tab */}
        <TabsContent value="board" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="flex gap-3 p-4 min-w-max">
              {COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.id}
                  column={col}
                  tasks={tasksByColumn[col.id] ?? []}
                  onMove={handleMove}
                  onDelete={handleDelete}
                  onSelect={handleSelectTask}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="flex-1 m-0 overflow-auto p-4">
          {analyticsLoading ? (
            <div className="flex items-center justify-center h-40 text-white/30">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading analytics...
            </div>
          ) : (
            <AnalyticsPanel analytics={analytics} />
          )}
        </TabsContent>

        {/* Inference Tab */}
        <TabsContent value="inference" className="flex-1 m-0 overflow-auto p-4">
          <InferencePanel />
        </TabsContent>

        {/* Audit Trail Tab */}
        <TabsContent value="audit" className="flex-1 m-0 overflow-auto p-4">
          <AuditTrailPanel />
        </TabsContent>

        {/* Live Feed Tab */}
        <TabsContent value="live" className="flex-1 m-0 overflow-auto p-4">
          <LiveFeedPanel events={liveEvents} connected={wsConnected} />
        </TabsContent>

        {/* AI Studio Tab */}
        <TabsContent value="studio" className="flex-1 m-0 overflow-auto p-4">
          <NlpAiStudioPanel />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateTaskDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={(params) => createMutation.mutate(params)}
      />
      <TaskDetailDialog
        task={selectedTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={(params) => updateMutation.mutate(params)}
      />
    </div>
  );
}
