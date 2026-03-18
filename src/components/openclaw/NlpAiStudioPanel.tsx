/**
 * NLP AI Studio Panel — Natural language → n8n workflows + agents
 *
 * Embedded as a tab in the OpenClaw Kanban page.
 * Users type what they want, Ollama generates the workflow/agent,
 * and it gets deployed directly to n8n.
 */

import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Sparkles,
  Workflow,
  Bot,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Play,
  Plus,
  ExternalLink,
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type Mode = "workflow" | "agent" | "both";

interface GeneratedWorkflow {
  name: string;
  nodes: any[];
  connections: any;
  settings?: any;
  active?: boolean;
}

interface GenerationResult {
  success: boolean;
  workflow?: GeneratedWorkflow;
  explanation?: string;
  warnings?: string[];
  errors?: string[];
}

interface DeployedItem {
  id: string;
  type: "workflow" | "agent";
  name: string;
  prompt: string;
  status: "deployed" | "failed";
  n8nId?: string;
  timestamp: number;
  explanation?: string;
  error?: string;
}

export function NlpAiStudioPanel() {
  const ipc = IpcClient.getInstance();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>("workflow");
  const [agentName, setAgentName] = useState("");
  const [generationResult, setGenerationResult] =
    useState<GenerationResult | null>(null);
  const [deployedItems, setDeployedItems] = useState<DeployedItem[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxNodes, setMaxNodes] = useState(10);

  // ── Fetch existing n8n workflows ──
  const { data: existingWorkflows } = useQuery({
    queryKey: ["n8n-workflows"],
    queryFn: () => ipc.listN8nWorkflows(),
    refetchInterval: 30_000,
  });

  // ── Setup Ollama credential in n8n ──
  const setupOllamaMutation = useMutation({
    mutationFn: () => ipc.setupN8nOllama(),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(
          result.created
            ? "Ollama credential created in n8n"
            : "Ollama credential already exists in n8n",
        );
      } else {
        toast.error(`Failed: ${result.error}`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Generate workflow from NLP ──
  const generateMutation = useMutation({
    mutationFn: async (input: { prompt: string; constraints?: any }) => {
      return ipc.generateN8nWorkflow(input) as Promise<GenerationResult>;
    },
    onSuccess: (result) => {
      setGenerationResult(result);
      if (result.success) {
        toast.success("Workflow generated from your description");
      } else {
        toast.error(
          `Generation failed: ${result.errors?.join(", ") || "Unknown error"}`,
        );
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setGenerationResult({
        success: false,
        errors: [err.message],
      });
    },
  });

  // ── Deploy generated workflow to n8n ──
  const deployWorkflowMutation = useMutation({
    mutationFn: async (workflow: GeneratedWorkflow) => {
      return ipc.createN8nWorkflow(workflow);
    },
    onSuccess: (result, workflow) => {
      const item: DeployedItem = {
        id: result?.id || crypto.randomUUID(),
        type: "workflow",
        name: workflow.name,
        prompt,
        status: "deployed",
        n8nId: result?.id,
        timestamp: Date.now(),
        explanation: generationResult?.explanation,
      };
      setDeployedItems((prev) => [item, ...prev]);
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
      toast.success(`"${workflow.name}" deployed to n8n`);
      setGenerationResult(null);
    },
    onError: (err: Error) => {
      toast.error(`Deploy failed: ${err.message}`);
    },
  });

  // ── Generate agent with n8n workflow ──
  const generateAgentMutation = useMutation({
    mutationFn: async (input: {
      prompt: string;
      name: string;
    }) => {
      // Step 1: Generate the workflow
      const wfResult = (await ipc.generateN8nWorkflow({
        prompt: `Create an AI agent workflow: ${input.prompt}. The agent should be named "${input.name}". Include a webhook trigger for receiving tasks, an HTTP Request node to call Ollama at http://host.docker.internal:11434/api/chat for AI processing, and a respond node to return results.`,
        constraints: { maxNodes: maxNodes },
      })) as GenerationResult;

      if (!wfResult.success || !wfResult.workflow) {
        throw new Error(
          wfResult.errors?.join(", ") || "Failed to generate agent workflow",
        );
      }

      // Name the workflow after the agent
      wfResult.workflow.name = `Agent: ${input.name}`;

      // Step 2: Deploy the workflow to n8n
      const deployed = await ipc.createN8nWorkflow(wfResult.workflow);

      return {
        workflow: wfResult.workflow,
        explanation: wfResult.explanation,
        n8nId: deployed?.id,
        agentName: input.name,
      };
    },
    onSuccess: (result) => {
      const item: DeployedItem = {
        id: result.n8nId || crypto.randomUUID(),
        type: "agent",
        name: result.agentName,
        prompt,
        status: "deployed",
        n8nId: result.n8nId,
        timestamp: Date.now(),
        explanation: result.explanation,
      };
      setDeployedItems((prev) => [item, ...prev]);
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
      toast.success(
        `Agent "${result.agentName}" created and deployed to n8n`,
      );
      setPrompt("");
      setAgentName("");
    },
    onError: (err: Error) => {
      toast.error(`Agent creation failed: ${err.message}`);
    },
  });

  // ── Deploy meta workflow builder ──
  const deployMetaBuilderMutation = useMutation({
    mutationFn: async () => {
      const metaWorkflow = await ipc.createMetaWorkflowBuilder();
      return ipc.createN8nWorkflow(metaWorkflow);
    },
    onSuccess: (result) => {
      const item: DeployedItem = {
        id: result?.id || crypto.randomUUID(),
        type: "workflow",
        name: "Meta Workflow Builder",
        prompt: "Auto-deployed meta-workflow that builds other workflows",
        status: "deployed",
        n8nId: result?.id,
        timestamp: Date.now(),
        explanation:
          "A workflow that accepts NLP prompts via webhook and creates new workflows using Ollama",
      };
      setDeployedItems((prev) => [item, ...prev]);
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
      toast.success("Meta Workflow Builder deployed to n8n");
    },
    onError: (err: Error) =>
      toast.error(`Meta builder deploy failed: ${err.message}`),
  });

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) {
      toast.error("Describe what you want to create");
      return;
    }

    if (mode === "agent" || mode === "both") {
      const name = agentName.trim() || "Custom Agent";
      generateAgentMutation.mutate({ prompt: prompt.trim(), name });
    }

    if (mode === "workflow" || mode === "both") {
      generateMutation.mutate({
        prompt: prompt.trim(),
        constraints: showAdvanced ? { maxNodes } : undefined,
      });
    }
  }, [prompt, mode, agentName, maxNodes, showAdvanced]);

  const isLoading =
    generateMutation.isPending ||
    generateAgentMutation.isPending ||
    deployWorkflowMutation.isPending;

  const workflowCount = existingWorkflows?.data?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Header + Quick Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-500" />
            AI Studio
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Describe what you need in plain English — Ollama + n8n handles the
            rest
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {workflowCount} workflows in n8n
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setupOllamaMutation.mutate()}
            disabled={setupOllamaMutation.isPending}
            className="text-xs"
          >
            {setupOllamaMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Zap className="w-3 h-3 mr-1" />
            )}
            Setup Ollama in n8n
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: NLP Input */}
        <div className="lg:col-span-2 space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Send className="w-4 h-4" />
                Describe Your Workflow or Agent
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Mode selector */}
              <div className="flex gap-2">
                <Button
                  variant={mode === "workflow" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("workflow")}
                  className="text-xs"
                >
                  <Workflow className="w-3.5 h-3.5 mr-1" />
                  Workflow
                </Button>
                <Button
                  variant={mode === "agent" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("agent")}
                  className="text-xs"
                >
                  <Bot className="w-3.5 h-3.5 mr-1" />
                  Agent
                </Button>
                <Button
                  variant={mode === "both" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("both")}
                  className="text-xs"
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1" />
                  Both
                </Button>
              </div>

              {/* Agent name (when mode includes agent) */}
              {(mode === "agent" || mode === "both") && (
                <div>
                  <Label className="text-xs">Agent Name</Label>
                  <Input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g. Support Bot, Data Analyst, Code Reviewer"
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              )}

              {/* NLP prompt */}
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === "agent"
                    ? "Describe what this agent should do...\n\nExample: An agent that monitors a webhook for customer support tickets, analyzes sentiment using AI, and routes high-priority items to Slack with a summary"
                    : "Describe the workflow you need...\n\nExample: When a webhook receives data, use AI to summarize it, then post to Slack and save to a Google Sheet"
                }
                className="min-h-[120px] text-sm"
              />

              {/* Advanced options */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showAdvanced ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                Advanced options
              </button>
              {showAdvanced && (
                <div className="flex items-center gap-4 p-2 bg-muted/50 rounded-md">
                  <div>
                    <Label className="text-xs">Max Nodes</Label>
                    <Input
                      type="number"
                      min={3}
                      max={25}
                      value={maxNodes}
                      onChange={(e) =>
                        setMaxNodes(Number.parseInt(e.target.value) || 10)
                      }
                      className="w-20 h-7 text-xs mt-0.5"
                    />
                  </div>
                </div>
              )}

              {/* Generate button */}
              <div className="flex gap-2">
                <Button
                  onClick={handleGenerate}
                  disabled={isLoading || !prompt.trim()}
                  className="flex-1"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  {mode === "agent"
                    ? "Generate & Deploy Agent"
                    : mode === "both"
                      ? "Generate Both"
                      : "Generate Workflow"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => deployMetaBuilderMutation.mutate()}
                  disabled={deployMetaBuilderMutation.isPending}
                  title="Deploy a meta-workflow that can build other workflows via webhook"
                >
                  {deployMetaBuilderMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Generation Result Preview */}
          {generationResult && (
            <Card
              className={
                generationResult.success
                  ? "border-green-500/30"
                  : "border-red-500/30"
              }
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {generationResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  Generated Workflow Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {generationResult.explanation && (
                  <p className="text-sm text-muted-foreground">
                    {generationResult.explanation}
                  </p>
                )}

                {generationResult.workflow && (
                  <>
                    <div className="text-xs font-medium">
                      {generationResult.workflow.name} —{" "}
                      {generationResult.workflow.nodes?.length || 0} nodes
                    </div>

                    {/* Node list */}
                    <div className="flex flex-wrap gap-1.5">
                      {generationResult.workflow.nodes?.map(
                        (node: any, i: number) => (
                          <Badge
                            key={node.id || i}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {node.name}
                          </Badge>
                        ),
                      )}
                    </div>

                    {generationResult.warnings &&
                      generationResult.warnings.length > 0 && (
                        <div className="text-xs text-yellow-500">
                          Warnings:{" "}
                          {generationResult.warnings.join(", ")}
                        </div>
                      )}

                    {/* Deploy button */}
                    <Button
                      onClick={() =>
                        deployWorkflowMutation.mutate(
                          generationResult.workflow!,
                        )
                      }
                      disabled={deployWorkflowMutation.isPending}
                      className="w-full"
                      variant="default"
                    >
                      {deployWorkflowMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      Deploy to n8n
                    </Button>
                  </>
                )}

                {generationResult.errors && (
                  <div className="text-xs text-red-400 space-y-1">
                    {generationResult.errors.map((e, i) => (
                      <p key={i}>• {e}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Deployed items + existing workflows */}
        <div className="space-y-3">
          {/* Recently deployed */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recently Deployed</CardTitle>
            </CardHeader>
            <CardContent>
              {deployedItems.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No deployments yet. Generate something above!
                </p>
              ) : (
                <ScrollArea className="max-h-[200px]">
                  <div className="space-y-2">
                    {deployedItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 p-2 rounded-md bg-muted/30 text-xs"
                      >
                        {item.type === "workflow" ? (
                          <Workflow className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                        ) : (
                          <Bot className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">
                            {item.name}
                          </div>
                          <div className="text-muted-foreground truncate">
                            {item.prompt.slice(0, 60)}
                            {item.prompt.length > 60 ? "..." : ""}
                          </div>
                          {item.n8nId && (
                            <a
                              href={`http://localhost:5678/workflow/${item.n8nId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 mt-0.5"
                            >
                              Open in n8n
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        <Badge
                          variant={
                            item.status === "deployed"
                              ? "default"
                              : "destructive"
                          }
                          className="text-[9px] shrink-0"
                        >
                          {item.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Existing n8n workflows */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>n8n Workflows</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    queryClient.invalidateQueries({
                      queryKey: ["n8n-workflows"],
                    })
                  }
                  className="h-6 w-6 p-0"
                >
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!existingWorkflows?.data ||
              existingWorkflows.data.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No workflows in n8n yet
                </p>
              ) : (
                <ScrollArea className="max-h-[250px]">
                  <div className="space-y-1.5">
                    {existingWorkflows.data.map((wf: any) => (
                      <div
                        key={wf.id}
                        className="flex items-center justify-between p-2 rounded-md bg-muted/30 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Workflow className="w-3 h-3 text-blue-400 shrink-0" />
                          <span className="truncate">{wf.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            variant={wf.active ? "default" : "secondary"}
                            className="text-[9px]"
                          >
                            {wf.active ? "active" : "inactive"}
                          </Badge>
                          <a
                            href={`http://localhost:5678/workflow/${wf.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Quick Templates */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Quick Templates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {[
                  {
                    label: "Webhook → AI → Slack",
                    prompt:
                      "Accept webhook data, analyze it with AI using Ollama, and post a summary to Slack",
                  },
                  {
                    label: "Scheduled Data Export",
                    prompt:
                      "Every 24 hours, fetch data from an HTTP API, transform it, and save to a PostgreSQL database",
                  },
                  {
                    label: "Support Ticket Agent",
                    prompt:
                      "An AI agent that receives support tickets via webhook, classifies urgency with Ollama, drafts a response, and sends notifications for high-priority items",
                  },
                  {
                    label: "Code Review Agent",
                    prompt:
                      "An agent that receives GitHub webhook events for pull requests, reviews the code changes with AI, and posts review comments back",
                  },
                ].map((tpl) => (
                  <button
                    key={tpl.label}
                    onClick={() => {
                      setPrompt(tpl.prompt);
                      if (
                        tpl.label.includes("Agent")
                      ) {
                        setMode("agent");
                        setAgentName(tpl.label);
                      } else {
                        setMode("workflow");
                      }
                    }}
                    className="w-full text-left p-2 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors text-xs"
                  >
                    <span className="font-medium">{tpl.label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
