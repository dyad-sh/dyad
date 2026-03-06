/**
 * Agent Tasks Panel
 * Full task management for an agent - create, edit, execute, and monitor tasks.
 * Shows per-agent task list with status, execution history, and type-specific UI.
 */

import { useState } from "react";
import {
  Plus,
  Play,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  Settings,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  useAgentTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useExecuteTask,
  useTaskExecutions,
  TASK_TYPE_TEMPLATES,
} from "@/hooks/useAgentWorkspace";
import { AGENT_TYPE_SUGGESTED_TOOLS, TASK_TYPE_TOOLS } from "@/types/agent_workspace";
import type {
  AgentTask,
  AgentTaskType,
  ExecutionMode,
  TaskPriority,
  AgentTaskStatus,
  CreateAgentTaskRequest,
  TaskExecution,
} from "@/types/agent_workspace";
import { getToolById, AGENT_TOOL_CATALOG } from "@/types/agent_tool_catalog";

// =============================================================================
// STATUS HELPERS
// =============================================================================

function statusIcon(status: AgentTaskStatus) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "paused":
      return <Pause className="h-4 w-4 text-yellow-500" />;
    case "queued":
      return <Clock className="h-4 w-4 text-orange-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusBadgeVariant(status: AgentTaskStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "running":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function priorityColor(priority: TaskPriority) {
  switch (priority) {
    case "critical":
      return "text-red-600 bg-red-100 dark:bg-red-900/30";
    case "high":
      return "text-orange-600 bg-orange-100 dark:bg-orange-900/30";
    case "medium":
      return "text-blue-600 bg-blue-100 dark:bg-blue-900/30";
    case "low":
      return "text-gray-600 bg-gray-100 dark:bg-gray-900/30";
  }
}

// =============================================================================
// TASK EXECUTION DETAIL
// =============================================================================

function TaskExecutionList({ taskId }: { taskId: string }) {
  const { data: executions, isLoading } = useTaskExecutions(taskId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading executions...
      </div>
    );
  }

  const items = executions || [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No execution history yet. Run this task to see results.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {items.slice(0, 10).map((exec: TaskExecution) => (
        <div
          key={exec.id}
          className="flex items-center justify-between text-xs border rounded px-3 py-2"
        >
          <div className="flex items-center gap-2">
            {statusIcon(exec.status as AgentTaskStatus)}
            <span className="font-mono">{exec.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-center gap-3">
            {exec.durationMs && (
              <span className="text-muted-foreground">
                {(exec.durationMs / 1000).toFixed(1)}s
              </span>
            )}
            <span className="text-muted-foreground">
              {new Date(exec.startedAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

interface AgentTasksPanelProps {
  agentId: number;
  agentType?: string;
}

export default function AgentTasksPanel({ agentId, agentType }: AgentTasksPanelProps) {
  const { data: tasks, isLoading } = useAgentTasks(agentId);
  const createTask = useCreateTask(agentId);
  const updateTask = useUpdateTask(agentId);
  const deleteTask = useDeleteTask(agentId);
  const executeTask = useExecuteTask(agentId);

  const [createOpen, setCreateOpen] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<AgentTask | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newType, setNewType] = useState<AgentTaskType>("llm_inference");
  const [newMode, setNewMode] = useState<ExecutionMode>("local");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [newToolId, setNewToolId] = useState<string>("");
  const [newRecurring, setNewRecurring] = useState(false);
  const [newCron, setNewCron] = useState("");
  const [newInputJson, setNewInputJson] = useState("{}");

  // Get suggested tools for this agent type
  const suggestedToolIds =
    agentType && agentType in AGENT_TYPE_SUGGESTED_TOOLS
      ? AGENT_TYPE_SUGGESTED_TOOLS[agentType as keyof typeof AGENT_TYPE_SUGGESTED_TOOLS]
      : [];

  const suggestedTools = suggestedToolIds
    .map((id) => getToolById(id))
    .filter(Boolean);

  // Reset form
  function resetForm() {
    setNewName("");
    setNewDescription("");
    setNewType("llm_inference");
    setNewMode("local");
    setNewPriority("medium");
    setNewToolId("");
    setNewRecurring(false);
    setNewCron("");
    setNewInputJson("{}");
  }

  // Handle type selection — auto-fill defaults
  function handleTypeChange(type: AgentTaskType) {
    setNewType(type);
    const template = TASK_TYPE_TEMPLATES.find((t) => t.type === type);
    if (template) {
      setNewMode(template.defaultMode);
      setNewPriority(template.defaultPriority);
      if (!newName) setNewName(template.name);
      if (!newDescription) setNewDescription(template.description);
    }
    // Suggest first matching tool
    const toolIds = TASK_TYPE_TOOLS[type] || [];
    if (toolIds.length > 0 && !newToolId) {
      setNewToolId(toolIds[0]);
    }
  }

  function handleCreate() {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(newInputJson);
    } catch {
      parsedInput = {};
    }

    const request: CreateAgentTaskRequest = {
      agentId,
      name: newName || "Untitled Task",
      description: newDescription,
      type: newType,
      executionMode: newMode,
      priority: newPriority,
      toolId: newToolId || undefined,
      input: parsedInput,
      recurring: newRecurring,
      cronExpression: newRecurring ? newCron : undefined,
    };

    createTask.mutate(request, {
      onSuccess: () => {
        setCreateOpen(false);
        resetForm();
      },
    });
  }

  function handleExecute(task: AgentTask) {
    executeTask.mutate({
      taskId: task.id,
      inputOverrides: task.input,
    });
  }

  function handleDelete(taskId: string) {
    deleteTask.mutate(taskId);
  }

  // =============================================================================
  // RENDER
  // =============================================================================

  const taskList = tasks || [];
  const runningCount = taskList.filter((t: AgentTask) => t.status === "running").length;
  const completedCount = taskList.filter((t: AgentTask) => t.status === "completed").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tasks & Execution</h2>
          <p className="text-sm text-muted-foreground">
            Create, edit, and run tasks for this agent.{" "}
            {taskList.length > 0 && (
              <span>
                {runningCount} running · {completedCount} completed · {taskList.length} total
              </span>
            )}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Suggested tools for this agent type */}
      {suggestedTools.length > 0 && taskList.length === 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Suggested Tools for {agentType} Agent</CardTitle>
            <CardDescription className="text-xs">
              Quick-start tasks based on your agent type
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {suggestedTools.map((tool) =>
                tool ? (
                  <Button
                    key={tool.id}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setNewToolId(tool.id);
                      setNewName(tool.name);
                      setNewDescription(tool.description);
                      setCreateOpen(true);
                    }}
                  >
                    <span className="mr-1">{tool.icon}</span>
                    {tool.name}
                  </Button>
                ) : null,
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Task List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : taskList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Zap className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">No tasks yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create tasks to define what this agent does — scrape data, query knowledge, call APIs,
              and more.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Task
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {taskList.map((task: AgentTask) => {
            const isExpanded = expandedTask === task.id;
            const template = TASK_TYPE_TEMPLATES.find((t) => t.type === task.type);
            const tool = task.toolId ? getToolById(task.toolId) : null;

            return (
              <Card key={task.id} className="overflow-hidden">
                {/* Task Row */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}

                  {statusIcon(task.status)}

                  <span className="text-base mr-1">{template?.icon || "🔧"}</span>

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{task.name}</div>
                    {task.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {task.description}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {tool && (
                      <Badge variant="outline" className="text-xs">
                        {tool.icon} {tool.name}
                      </Badge>
                    )}

                    <Badge variant={statusBadgeVariant(task.status)} className="text-xs">
                      {task.status}
                    </Badge>

                    <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColor(task.priority)}`}>
                      {task.priority}
                    </span>

                    <Badge variant="outline" className="text-xs">
                      {task.executionMode}
                    </Badge>

                    {task.recurring && (
                      <Badge variant="secondary" className="text-xs">
                        <RotateCcw className="h-3 w-3 mr-1" />
                        recurring
                      </Badge>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleExecute(task)}
                      disabled={executeTask.isPending || task.status === "running"}
                      title="Execute task"
                    >
                      {task.status === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingTask(task)}
                      title="Edit task"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(task.id)}
                      title="Delete task"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Type:</span>{" "}
                        <span className="font-medium">{template?.name || task.type}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Mode:</span>{" "}
                        <span className="font-medium">{task.executionMode}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Executions:</span>{" "}
                        <span className="font-medium">{task.executionCount}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Created:</span>{" "}
                        <span className="font-medium">
                          {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {/* Input */}
                    {task.input && Object.keys(task.input).length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Input</Label>
                        <pre className="bg-background rounded p-2 text-xs overflow-x-auto max-h-24">
                          {JSON.stringify(task.input, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Output */}
                    {task.output && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Last Output</Label>
                        <pre className="bg-background rounded p-2 text-xs overflow-x-auto max-h-32">
                          {typeof task.output === "string"
                            ? task.output
                            : JSON.stringify(task.output, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Execution History */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Execution History
                      </Label>
                      <TaskExecutionList taskId={task.id} />
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ================================================================= */}
      {/* CREATE TASK DIALOG                                                 */}
      {/* ================================================================= */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
            <DialogDescription>
              Define a new task for this agent to perform.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Task Type */}
            <div className="space-y-2">
              <Label>Task Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {TASK_TYPE_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.type}
                    onClick={() => handleTypeChange(tmpl.type)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors ${
                      newType === tmpl.type
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <span className="text-lg">{tmpl.icon}</span>
                    <span className="font-medium text-center leading-tight">{tmpl.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Name & Description */}
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="Task name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="What does this task do?"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
              />
            </div>

            {/* Tool Binding */}
            <div className="space-y-2">
              <Label>Bind Tool (optional)</Label>
              <Select value={newToolId} onValueChange={setNewToolId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a tool..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Tool</SelectItem>
                  {AGENT_TOOL_CATALOG.map((tool) => (
                    <SelectItem key={tool.id} value={tool.id}>
                      {tool.icon} {tool.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Execution Mode */}
              <div className="space-y-2">
                <Label>Execution Mode</Label>
                <Select value={newMode} onValueChange={(v) => setNewMode(v as ExecutionMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">🖥️ Local</SelectItem>
                    <SelectItem value="cloud">☁️ Cloud</SelectItem>
                    <SelectItem value="hybrid">🔄 Hybrid</SelectItem>
                    <SelectItem value="n8n">⚡ n8n Workflow</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={newPriority} onValueChange={(v) => setNewPriority(v as TaskPriority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Recurring */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Recurring Task</Label>
                <p className="text-xs text-muted-foreground">Run on a schedule</p>
              </div>
              <Switch checked={newRecurring} onCheckedChange={setNewRecurring} />
            </div>

            {newRecurring && (
              <div className="space-y-2">
                <Label>Cron Expression</Label>
                <Input
                  placeholder="*/5 * * * * (every 5 min)"
                  value={newCron}
                  onChange={(e) => setNewCron(e.target.value)}
                />
              </div>
            )}

            {/* Input JSON */}
            <div className="space-y-2">
              <Label>Input Parameters (JSON)</Label>
              <Textarea
                className="font-mono text-xs"
                placeholder='{"url": "https://..."}'
                value={newInputJson}
                onChange={(e) => setNewInputJson(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createTask.isPending}>
              {createTask.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* EDIT TASK DIALOG                                                   */}
      {/* ================================================================= */}
      {editingTask && (
        <EditTaskDialog
          task={editingTask}
          agentId={agentId}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// EDIT TASK DIALOG
// =============================================================================

function EditTaskDialog({
  task,
  agentId,
  onClose,
}: {
  task: AgentTask;
  agentId: number;
  onClose: () => void;
}) {
  const updateTask = useUpdateTask(agentId);

  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description || "");
  const [mode, setMode] = useState<ExecutionMode>(task.executionMode);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [toolId, setToolId] = useState(task.toolId || "");
  const [recurring, setRecurring] = useState(task.recurring);
  const [cron, setCron] = useState(task.cronExpression || "");
  const [inputJson, setInputJson] = useState(JSON.stringify(task.input || {}, null, 2));

  function handleSave() {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(inputJson);
    } catch {
      parsedInput = {};
    }

    updateTask.mutate(
      {
        id: task.id,
        name,
        description,
        executionMode: mode,
        priority,
        toolId: toolId || undefined,
        recurring,
        cronExpression: recurring ? cron : undefined,
        input: parsedInput,
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Task — {task.name}</DialogTitle>
          <DialogDescription>Update task configuration and parameters.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Tool</Label>
            <Select value={toolId} onValueChange={setToolId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a tool..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Tool</SelectItem>
                {AGENT_TOOL_CATALOG.map((tool) => (
                  <SelectItem key={tool.id} value={tool.id}>
                    {tool.icon} {tool.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Execution Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as ExecutionMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">🖥️ Local</SelectItem>
                  <SelectItem value="cloud">☁️ Cloud</SelectItem>
                  <SelectItem value="hybrid">🔄 Hybrid</SelectItem>
                  <SelectItem value="n8n">⚡ n8n Workflow</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Recurring</Label>
              <p className="text-xs text-muted-foreground">Run on schedule</p>
            </div>
            <Switch checked={recurring} onCheckedChange={setRecurring} />
          </div>

          {recurring && (
            <div className="space-y-2">
              <Label>Cron Expression</Label>
              <Input
                placeholder="*/5 * * * *"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Input Parameters (JSON)</Label>
            <Textarea
              className="font-mono text-xs"
              value={inputJson}
              onChange={(e) => setInputJson(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateTask.isPending}>
            {updateTask.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
