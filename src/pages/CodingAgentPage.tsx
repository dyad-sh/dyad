/**
 * AI Coding Agent Page
 * Full-featured UI for the autonomous coding agent
 */

import { useState, useRef, useEffect } from "react";
import { useCodingAgent, useAgentCapabilities } from "@/hooks/useCodingAgent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  Play,
  Square,
  Send,
  Trash2,
  Settings,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  FileCode2,
  Bug,
  RefreshCw,
  TestTube2,
  FileText,
  Search,
  Loader2,
  Terminal,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import type { TaskType, ApprovalRequest, AgentCapability } from "@/ipc/coding_agent_client";

const TASK_TYPES: Array<{ value: TaskType; label: string; icon: React.ReactNode; description: string }> = [
  { value: "code", label: "Generate Code", icon: <FileCode2 className="h-4 w-4" />, description: "Write new code or features" },
  { value: "debug", label: "Debug", icon: <Bug className="h-4 w-4" />, description: "Find and fix bugs" },
  { value: "refactor", label: "Refactor", icon: <RefreshCw className="h-4 w-4" />, description: "Improve code structure" },
  { value: "test", label: "Write Tests", icon: <TestTube2 className="h-4 w-4" />, description: "Create test cases" },
  { value: "document", label: "Document", icon: <FileText className="h-4 w-4" />, description: "Add documentation" },
  { value: "explain", label: "Explain", icon: <Search className="h-4 w-4" />, description: "Explain code functionality" },
  { value: "review", label: "Review", icon: <CheckCircle2 className="h-4 w-4" />, description: "Review code for issues" },
];

export default function CodingAgentPage() {
  const [taskType, setTaskType] = useState<TaskType>("code");
  const [taskDescription, setTaskDescription] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [safeMode, setSafeMode] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);

  const {
    sessionId,
    session,
    isRunning,
    currentTask,
    output,
    approvals,
    start,
    stop,
    run,
    approve,
    clearOutput,
    isStarting,
    isStopping,
    isTaskRunning,
  } = useCodingAgent({ autoApprove, safeMode });

  const { data: capabilities } = useAgentCapabilities();

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleRunTask = async () => {
    if (!taskDescription.trim()) return;
    await run(taskType, taskDescription);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey) {
      handleRunTask();
    }
  };

  return (
    <div className="h-full flex flex-col p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Coding Agent</h1>
            <p className="text-sm text-muted-foreground">
              Autonomous assistant for code generation, debugging, and refactoring
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setShowSettings(true)}>
            <Settings className="h-4 w-4" />
          </Button>
          {sessionId ? (
            <Button variant="destructive" onClick={stop} disabled={isStopping}>
              {isStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              <span className="ml-2">Stop Agent</span>
            </Button>
          ) : (
            <Button onClick={() => start()} disabled={isStarting}>
              {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="ml-2">Start Agent</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-3 gap-6 min-h-0">
        {/* Left Panel - Task Input */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">New Task</CardTitle>
              <CardDescription>Describe what you want the agent to do</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Task Type Selector */}
              <div className="space-y-2">
                <Label>Task Type</Label>
                <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex items-center gap-2">
                          {type.icon}
                          <span>{type.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Task Description */}
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Describe what you want to accomplish..."
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  onKeyDown={handleKeyPress}
                  rows={6}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">Press Ctrl+Enter to run</p>
              </div>

              {/* Run Button */}
              <Button
                className="w-full"
                onClick={handleRunTask}
                disabled={!taskDescription.trim() || isTaskRunning}
              >
                {isTaskRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {isTaskRunning ? "Running..." : "Run Task"}
              </Button>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {TASK_TYPES.slice(0, 6).map((type) => (
                  <TooltipProvider key={type.value}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => setTaskType(type.value)}
                        >
                          {type.icon}
                          <span className="ml-2 truncate">{type.label}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{type.description}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Center Panel - Output */}
        <div className="col-span-2 flex flex-col gap-4">
          <Tabs defaultValue="output" className="flex-1 flex flex-col min-h-0">
            <TabsList>
              <TabsTrigger value="output">
                <Terminal className="h-4 w-4 mr-2" />
                Output
              </TabsTrigger>
              <TabsTrigger value="approvals">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Approvals
                {approvals.length > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {approvals.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="output" className="flex-1 mt-4">
              <Card className="h-full flex flex-col">
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-lg">Agent Output</CardTitle>
                  <Button variant="ghost" size="sm" onClick={clearOutput}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div
                      ref={outputRef}
                      className="p-4 font-mono text-sm space-y-1 bg-muted/30"
                    >
                      {output.length === 0 ? (
                        <p className="text-muted-foreground italic">
                          Agent output will appear here...
                        </p>
                      ) : (
                        output.map((line, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                            <span className="whitespace-pre-wrap break-all">{line}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="approvals" className="flex-1 mt-4">
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Pending Approvals</CardTitle>
                  <CardDescription>
                    Review and approve agent actions before they execute
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {approvals.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No pending approvals</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {approvals.map((approval) => (
                        <ApprovalCard
                          key={approval.id}
                          approval={approval}
                          onApprove={() => approve(approval.id, true)}
                          onReject={() => approve(approval.id, false)}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Session Status */}
          {sessionId && (
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <StatusBadge status={session?.status || "idle"} />
                    {currentTask && (
                      <span className="text-sm text-muted-foreground">
                        {currentTask.type}: {currentTask.description.slice(0, 50)}...
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      Session: {session?.history.length || 0} actions
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        autoApprove={autoApprove}
        setAutoApprove={setAutoApprove}
        safeMode={safeMode}
        setSafeMode={setSafeMode}
        capabilities={capabilities || []}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { color: string; icon: React.ReactNode }> = {
    idle: { color: "bg-gray-500", icon: <Clock className="h-3 w-3" /> },
    thinking: { color: "bg-yellow-500", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    executing: { color: "bg-blue-500", icon: <Play className="h-3 w-3" /> },
    waiting: { color: "bg-orange-500", icon: <AlertTriangle className="h-3 w-3" /> },
    completed: { color: "bg-green-500", icon: <CheckCircle2 className="h-3 w-3" /> },
    error: { color: "bg-red-500", icon: <XCircle className="h-3 w-3" /> },
  };

  const variant = variants[status] || variants.idle;

  return (
    <Badge className={`${variant.color} text-white gap-1`}>
      {variant.icon}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  const riskColors = {
    low: "text-green-600 bg-green-100",
    medium: "text-yellow-600 bg-yellow-100",
    high: "text-red-600 bg-red-100",
  };

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{approval.action.type}</Badge>
              <Badge className={riskColors[approval.risk]}>{approval.risk} risk</Badge>
            </div>
            <p className="text-sm">{approval.description}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onReject}>
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button size="sm" onClick={onApprove}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Approve
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  autoApprove,
  setAutoApprove,
  safeMode,
  setSafeMode,
  capabilities,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoApprove: boolean;
  setAutoApprove: (v: boolean) => void;
  safeMode: boolean;
  setSafeMode: (v: boolean) => void;
  capabilities: AgentCapability[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agent Settings</DialogTitle>
          <DialogDescription>Configure how the AI coding agent operates</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Auto Approve */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-Approve Actions</Label>
              <p className="text-sm text-muted-foreground">
                Automatically approve all agent actions
              </p>
            </div>
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
          </div>

          <Separator />

          {/* Safe Mode */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Safe Mode</Label>
              <p className="text-sm text-muted-foreground">
                Require approval for potentially dangerous actions
              </p>
            </div>
            <Switch checked={safeMode} onCheckedChange={setSafeMode} />
          </div>

          <Separator />

          {/* Capabilities */}
          <div className="space-y-3">
            <Label>Capabilities</Label>
            <div className="space-y-2">
              {capabilities.map((cap) => (
                <div key={cap.id} className="flex items-center justify-between text-sm">
                  <span>{cap.name}</span>
                  <Badge variant={cap.enabled ? "default" : "secondary"}>
                    {cap.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
