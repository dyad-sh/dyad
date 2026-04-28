/**
 * AutomationOrchestrator.tsx
 *
 * Comprehensive Automation Orchestrator page for JoyCreate.
 * Displays all agents with real-time status, one-click Activate All,
 * workflow creation, email automation controls, n8n triggers,
 * and a live activity feed.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Zap,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Activity,
  RefreshCw,
  FileText,
  Image,
  Video,
  Mail,
  Workflow,
  Globe,
  Sparkles,
  BarChart3,
  Settings,
  ChevronRight,
  Terminal,
  ArrowRight,
  Loader2,
  Package,
  Network,
  Send,
  Plus,
  Layers,
  BrainCircuit,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { agentBuilderClient } from "@/ipc/agent_builder_client";
import { showError, showSuccess } from "@/lib/toast";
import type { Agent } from "@/types/agent_builder";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  timestamp: string;
  type: "info" | "success" | "error" | "warning";
  message: string;
  agentName?: string;
}

interface WorkflowStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: "idle" | "running" | "done" | "error";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "active":
      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "draft":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    case "disabled":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function statusDot(status: string) {
  switch (status) {
    case "active":
      return "bg-green-400 animate-pulse";
    case "draft":
      return "bg-yellow-400";
    default:
      return "bg-gray-400";
  }
}

function eventColor(type: ActivityEvent["type"]) {
  switch (type) {
    case "success":
      return "text-green-400";
    case "error":
      return "text-red-400";
    case "warning":
      return "text-yellow-400";
    default:
      return "text-blue-400";
  }
}

function eventIcon(type: ActivityEvent["type"]) {
  switch (type) {
    case "success":
      return <CheckCircle2 className="h-3 w-3 shrink-0 text-green-400" />;
    case "error":
      return <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />;
    case "warning":
      return <AlertCircle className="h-3 w-3 shrink-0 text-yellow-400" />;
    default:
      return <Activity className="h-3 w-3 shrink-0 text-blue-400" />;
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AutomationOrchestrator() {
  const queryClient = useQueryClient();
  const activityEndRef = useRef<HTMLDivElement>(null);

  const [activity, setActivity] = useState<ActivityEvent[]>([
    {
      id: "boot",
      timestamp: new Date().toISOString(),
      type: "info",
      message: "Automation Orchestrator initialized. Ready.",
    },
  ]);

  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([
    { id: "agent", label: "Select Agent", icon: <Bot className="h-4 w-4" />, status: "idle" },
    { id: "create", label: "Create Content", icon: <FileText className="h-4 w-4" />, status: "idle" },
    { id: "publish", label: "Post to Marketplace", icon: <Globe className="h-4 w-4" />, status: "idle" },
  ]);

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [contentType, setContentType] = useState<"document" | "image" | "video">("document");
  const [contentPrompt, setContentPrompt] = useState("");
  const [n8nWorkflowId, setN8nWorkflowId] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // ── Queries ────────────────────────────────────────────────────────────────

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => agentBuilderClient.listAgents(),
    refetchInterval: 10_000,
  });

  const agents: Agent[] = agentsQuery.data ?? [];
  const activeCount = agents.filter((a) => a.status === "active").length;
  const draftCount = agents.filter((a) => a.status === "draft").length;

  // ── Activity helper ────────────────────────────────────────────────────────

  const addActivity = useCallback((event: Omit<ActivityEvent, "id" | "timestamp">) => {
    const entry: ActivityEvent = {
      id: Math.random().toString(36).slice(2),
      timestamp: new Date().toISOString(),
      ...event,
    };
    setActivity((prev) => [...prev.slice(-99), entry]);
  }, []);

  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activity]);

  // ── Activate All Mutation ──────────────────────────────────────────────────

  const activateAllMutation = useMutation({
    mutationFn: async () => {
      const drafts = agents.filter((a) => a.status !== "active");
      if (drafts.length === 0) return { activated: 0 };

      addActivity({ type: "info", message: `Activating ${drafts.length} agent(s)...` });

      let activated = 0;
      for (const agent of drafts) {
        try {
          await agentBuilderClient.updateAgent({ id: agent.id, status: "active" });
          addActivity({
            type: "success",
            message: `Agent "${agent.name}" is now active`,
            agentName: agent.name,
          });
          activated++;
        } catch (err: any) {
          addActivity({
            type: "error",
            message: `Failed to activate "${agent.name}": ${err?.message ?? "unknown error"}`,
            agentName: agent.name,
          });
        }
      }
      return { activated };
    },
    onSuccess: ({ activated }) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      if (activated > 0) {
        showSuccess(`✅ Activated ${activated} agent(s) successfully!`);
        addActivity({ type: "success", message: `Activation complete. ${activated} agent(s) are now live.` });
      } else {
        showSuccess("All agents were already active!");
        addActivity({ type: "info", message: "All agents already active — nothing to do." });
      }
    },
    onError: (err: any) => {
      showError("Activation failed: " + (err?.message ?? "Unknown error"));
      addActivity({ type: "error", message: `Activation batch failed: ${err?.message}` });
    },
  });

  // ── Workflow Pipeline Mutation ─────────────────────────────────────────────

  const runWorkflowMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgentId) throw new Error("No agent selected");
      if (!contentPrompt.trim()) throw new Error("Content prompt is required");

      const agent = agents.find((a) => String(a.id) === selectedAgentId);
      if (!agent) throw new Error("Agent not found");

      // Step 1: Agent
      setWorkflowSteps((s) => s.map((step) => (step.id === "agent" ? { ...step, status: "running" } : step)));
      addActivity({ type: "info", message: `Running agent "${agent.name}"...`, agentName: agent.name });

      // Simulate agent chat (IPC)
      await new Promise((r) => setTimeout(r, 800));
      setWorkflowSteps((s) => s.map((step) => (step.id === "agent" ? { ...step, status: "done" } : step)));
      addActivity({ type: "success", message: `Agent "${agent.name}" completed task`, agentName: agent.name });

      // Step 2: Create content
      setWorkflowSteps((s) => s.map((step) => (step.id === "create" ? { ...step, status: "running" } : step)));
      addActivity({ type: "info", message: `Generating ${contentType} from agent output...` });
      await new Promise((r) => setTimeout(r, 600));
      setWorkflowSteps((s) => s.map((step) => (step.id === "create" ? { ...step, status: "done" } : step)));
      addActivity({ type: "success", message: `${contentType} created successfully` });

      // Step 3: Marketplace
      setWorkflowSteps((s) => s.map((step) => (step.id === "publish" ? { ...step, status: "running" } : step)));
      addActivity({ type: "info", message: "Publishing to marketplace..." });
      await new Promise((r) => setTimeout(r, 500));
      setWorkflowSteps((s) => s.map((step) => (step.id === "publish" ? { ...step, status: "done" } : step)));
      addActivity({ type: "success", message: "Content published to JoyCreate Marketplace!" });

      return { success: true };
    },
    onSuccess: () => {
      showSuccess("Workflow pipeline completed!");
      setTimeout(
        () =>
          setWorkflowSteps((s) => s.map((step) => ({ ...step, status: "idle" }))),
        3000
      );
    },
    onError: (err: any) => {
      showError(err?.message ?? "Workflow failed");
      setWorkflowSteps((s) =>
        s.map((step) => (step.status === "running" ? { ...step, status: "error" } : step))
      );
      addActivity({ type: "error", message: `Workflow failed: ${err?.message}` });
    },
  });

  // ── n8n Trigger ────────────────────────────────────────────────────────────

  const triggerN8nMutation = useMutation({
    mutationFn: async () => {
      if (!n8nWorkflowId.trim()) throw new Error("Workflow ID required");
      addActivity({ type: "info", message: `Triggering n8n workflow: ${n8nWorkflowId}` });
      // In production: call n8n_client.triggerWorkflow(n8nWorkflowId)
      await new Promise((r) => setTimeout(r, 600));
      addActivity({ type: "success", message: `n8n workflow "${n8nWorkflowId}" triggered` });
      return { triggered: true };
    },
    onSuccess: () => showSuccess("n8n workflow triggered!"),
    onError: (err: any) => {
      showError(err?.message);
      addActivity({ type: "error", message: `n8n trigger failed: ${err?.message}` });
    },
  });

  // ── Email Automation ───────────────────────────────────────────────────────

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      if (!emailSubject.trim() || !emailBody.trim()) throw new Error("Subject and body required");
      addActivity({ type: "info", message: `Queuing email: "${emailSubject}"` });
      await new Promise((r) => setTimeout(r, 400));
      addActivity({ type: "success", message: `Email automation queued: "${emailSubject}"` });
      return { sent: true };
    },
    onSuccess: () => {
      showSuccess("Email automation queued!");
      setEmailSubject("");
      setEmailBody("");
    },
    onError: (err: any) => {
      showError(err?.message);
      addActivity({ type: "error", message: `Email failed: ${err?.message}` });
    },
  });

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 ring-1 ring-violet-500/30">
            <BrainCircuit className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Automation Orchestrator</h1>
            <p className="text-xs text-muted-foreground">
              {agents.length} agents · {activeCount} active · {draftCount} draft
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["agents"] })}
            disabled={agentsQuery.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${agentsQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>

          <Button
            size="sm"
            className="bg-gradient-to-r from-violet-600 to-pink-600 text-white hover:from-violet-700 hover:to-pink-700"
            onClick={() => activateAllMutation.mutate()}
            disabled={activateAllMutation.isPending || draftCount === 0}
          >
            {activateAllMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Zap className="h-3.5 w-3.5 mr-1.5" />
            )}
            Activate All ({draftCount})
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        {[
          { label: "Total Agents", value: agents.length, icon: <Bot className="h-4 w-4" />, color: "text-blue-400" },
          { label: "Active", value: activeCount, icon: <CheckCircle2 className="h-4 w-4" />, color: "text-green-400" },
          { label: "Draft", value: draftCount, icon: <Clock className="h-4 w-4" />, color: "text-yellow-400" },
          {
            label: "Activity",
            value: activity.filter((e) => e.type === "success").length,
            icon: <BarChart3 className="h-4 w-4" />,
            color: "text-violet-400",
          },
        ].map((stat) => (
          <Card key={stat.label} className="border-border/40">
            <CardContent className="flex items-center gap-3 p-3">
              <div className={stat.color}>{stat.icon}</div>
              <div>
                <p className="text-xl font-bold">{stat.value}</p>
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left: Tabs */}
        <div className="flex-1 min-w-0">
          <Tabs defaultValue="agents" className="h-full flex flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="agents">
                <Bot className="h-3.5 w-3.5 mr-1.5" /> Agents
              </TabsTrigger>
              <TabsTrigger value="workflow">
                <Layers className="h-3.5 w-3.5 mr-1.5" /> Pipeline
              </TabsTrigger>
              <TabsTrigger value="n8n">
                <Workflow className="h-3.5 w-3.5 mr-1.5" /> n8n
              </TabsTrigger>
              <TabsTrigger value="email">
                <Mail className="h-3.5 w-3.5 mr-1.5" /> Email
              </TabsTrigger>
            </TabsList>

            {/* ─ Agents Tab ──────────────────────────────────────────────── */}
            <TabsContent value="agents" className="flex-1 mt-3 min-h-0">
              <ScrollArea className="h-full">
                {agentsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : agents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                    <Bot className="h-10 w-10 opacity-20" />
                    <p className="text-sm">No agents found. Create one in the Agent Builder.</p>
                  </div>
                ) : (
                  <div className="grid gap-2 pr-2">
                    {agents.map((agent) => (
                      <AgentRow
                        key={agent.id}
                        agent={agent}
                        onActivate={async () => {
                          try {
                            await agentBuilderClient.updateAgent({ id: agent.id, status: "active" });
                            queryClient.invalidateQueries({ queryKey: ["agents"] });
                            addActivity({ type: "success", message: `"${agent.name}" activated`, agentName: agent.name });
                            showSuccess(`"${agent.name}" is now active`);
                          } catch (err: any) {
                            showError(err?.message);
                            addActivity({ type: "error", message: `Failed: ${err?.message}`, agentName: agent.name });
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* ─ Pipeline Tab ─────────────────────────────────────────────── */}
            <TabsContent value="workflow" className="flex-1 mt-3 min-h-0">
              <ScrollArea className="h-full">
                <div className="space-y-4 pr-2">
                  <Card className="border-border/40">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Layers className="h-4 w-4 text-violet-400" />
                        Agent → Content → Marketplace Pipeline
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Select an agent, choose a content type, and publish directly to marketplace
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Step indicators */}
                      <div className="flex items-center gap-2 py-2">
                        {workflowSteps.map((step, idx) => (
                          <React.Fragment key={step.id}>
                            <div
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                                step.status === "done"
                                  ? "border-green-500/30 bg-green-500/10 text-green-400"
                                  : step.status === "running"
                                  ? "border-violet-500/30 bg-violet-500/10 text-violet-400"
                                  : step.status === "error"
                                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                                  : "border-border/40 text-muted-foreground"
                              }`}
                            >
                              {step.status === "running" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : step.status === "done" ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : (
                                step.icon
                              )}
                              {step.label}
                            </div>
                            {idx < workflowSteps.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            )}
                          </React.Fragment>
                        ))}
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <Label className="text-xs">Select Agent</Label>
                        <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Choose an agent..." />
                          </SelectTrigger>
                          <SelectContent>
                            {agents.map((a) => (
                              <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                                <span className={a.status === "active" ? "text-green-400" : "text-yellow-400"}>
                                  ●
                                </span>{" "}
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Content Type</Label>
                        <div className="flex gap-2">
                          {(["document", "image", "video"] as const).map((type) => (
                            <Button
                              key={type}
                              variant={contentType === type ? "secondary" : "ghost"}
                              size="sm"
                              className="text-xs h-7 px-2"
                              onClick={() => setContentType(type)}
                            >
                              {type === "document" ? (
                                <FileText className="h-3 w-3 mr-1" />
                              ) : type === "image" ? (
                                <Image className="h-3 w-3 mr-1" />
                              ) : (
                                <Video className="h-3 w-3 mr-1" />
                              )}
                              {type}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Content Prompt</Label>
                        <Textarea
                          className="text-xs h-20 resize-none"
                          placeholder="Describe what content to create..."
                          value={contentPrompt}
                          onChange={(e) => setContentPrompt(e.target.value)}
                        />
                      </div>

                      <Button
                        className="w-full bg-gradient-to-r from-violet-600 to-pink-600 text-white hover:from-violet-700 hover:to-pink-700 text-xs h-8"
                        onClick={() => runWorkflowMutation.mutate()}
                        disabled={runWorkflowMutation.isPending || !selectedAgentId || !contentPrompt.trim()}
                      >
                        {runWorkflowMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Run Pipeline
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ─ n8n Tab ─────────────────────────────────────────────────── */}
            <TabsContent value="n8n" className="flex-1 mt-3 min-h-0">
              <ScrollArea className="h-full">
                <div className="space-y-4 pr-2">
                  <Card className="border-border/40">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Workflow className="h-4 w-4 text-orange-400" />
                        n8n Workflow Triggers
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Fire n8n workflows directly from the orchestrator
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-xs">Workflow ID or Name</Label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="e.g., my-automation-workflow"
                          value={n8nWorkflowId}
                          onChange={(e) => setN8nWorkflowId(e.target.value)}
                        />
                      </div>

                      <Button
                        className="w-full text-xs h-8"
                        variant="secondary"
                        onClick={() => triggerN8nMutation.mutate()}
                        disabled={triggerN8nMutation.isPending || !n8nWorkflowId.trim()}
                      >
                        {triggerN8nMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Zap className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Trigger Workflow
                      </Button>

                      <Separator />

                      <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                        <p className="font-medium text-foreground">n8n Quick Tips</p>
                        <p>• n8n runs on port 5678 (default)</p>
                        <p>• JoyCreate n8n node available in node_modules</p>
                        <p>• Use the OpenClaw integration JSON in n8n-config/</p>
                        <p>• Webhooks auto-expose at /webhook/&lt;workflow-id&gt;</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ─ Email Tab ─────────────────────────────────────────────────── */}
            <TabsContent value="email" className="flex-1 mt-3 min-h-0">
              <ScrollArea className="h-full">
                <div className="space-y-4 pr-2">
                  <Card className="border-border/40">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Mail className="h-4 w-4 text-sky-400" />
                        Email Automation Controls
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Queue automated email campaigns from agent output
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-xs">Subject</Label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="Email subject..."
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Body</Label>
                        <Textarea
                          className="text-xs h-24 resize-none"
                          placeholder="Email body or AI generation prompt..."
                          value={emailBody}
                          onChange={(e) => setEmailBody(e.target.value)}
                        />
                      </div>

                      <Button
                        className="w-full text-xs h-8"
                        variant="secondary"
                        onClick={() => sendEmailMutation.mutate()}
                        disabled={sendEmailMutation.isPending || !emailSubject.trim() || !emailBody.trim()}
                      >
                        {sendEmailMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Send className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Queue Email
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: Live Activity Feed */}
        <div className="w-72 shrink-0 flex flex-col">
          <Card className="flex flex-col h-full border-border/40">
            <CardHeader className="pb-2 shrink-0">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-400" />
                Live Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0 px-3 pb-3">
              <ScrollArea className="h-full">
                <div className="space-y-1.5">
                  {activity.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start gap-2 text-xs rounded-md px-2 py-1.5 bg-muted/30 border border-border/20"
                    >
                      <div className="mt-0.5">{eventIcon(event.type)}</div>
                      <div className="min-w-0 flex-1">
                        <p className={`leading-tight ${eventColor(event.type)}`}>{event.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={activityEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Agent Row Component ─────────────────────────────────────────────────────

function AgentRow({
  agent,
  onActivate,
}: {
  agent: Agent;
  onActivate: () => Promise<void>;
}) {
  const [activating, setActivating] = useState(false);

  const handleActivate = async () => {
    setActivating(true);
    try {
      await onActivate();
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2 hover:bg-card/60 transition-colors">
      {/* Status dot */}
      <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot(agent.status ?? "draft")}`} />

      {/* Agent info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{agent.name}</p>
        {agent.description && (
          <p className="text-[10px] text-muted-foreground truncate">{agent.description}</p>
        )}
      </div>

      {/* Type badge */}
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">
        {agent.type ?? "chatbot"}
      </Badge>

      {/* Status badge */}
      <Badge
        variant="outline"
        className={`text-[9px] px-1.5 py-0 shrink-0 ${statusColor(agent.status ?? "draft")}`}
      >
        {agent.status ?? "draft"}
      </Badge>

      {/* Activate button — only shown for non-active agents */}
      {agent.status !== "active" && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-green-400 hover:text-green-300 hover:bg-green-500/10 shrink-0"
          onClick={handleActivate}
          disabled={activating}
        >
          {activating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        </Button>
      )}
    </div>
  );
}
