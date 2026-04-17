/**
 * Agent Editor Page
 * Comprehensive single-screen agent configuration
 * - No duplicated sections
 * - AI-powered system prompt generation via local AI
 * - All agent settings in properly separated sidebar tabs
 */

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Save,
  Play,
  Settings,
  Wrench,
  Workflow,
  Database,
  Layout,
  Rocket,
  Trash2,
  Plus,
  Code,
  FileText,
  Brain,
  Globe,
  ExternalLink,
  Loader2,
  Box,
  Coins,
  Shield,
  Infinity as InfinityIcon,
  Zap,
  Sparkles,
  RefreshCw,
  WandSparkles,
  Expand,
  BarChart3,
  SlidersHorizontal,
  Share2,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { IpcClient } from "@/ipc/ipc_client";
import { agentBuilderClient } from "@/ipc/agent_builder_client";
import { showError, showSuccess } from "@/lib/toast";
import type { App } from "@/ipc/ipc_types";
import { PublishWizard } from "@/components/marketplace/PublishWizard";
import { usePublishAgent } from "@/hooks/use_publish_agent";
import AgentMemoryTab from "@/components/agent/AgentMemoryTab";
import AgentStackBuilder from "@/components/agent/AgentStackBuilder";
import AgentTasksPanel from "@/components/agent/AgentTasksPanel";
import AgentKnowledgePanel from "@/components/agent/AgentKnowledgePanel";
import { AgentFlywheelTab } from "@/components/agent/AgentFlywheelTab";
import AgentSharePanel from "@/components/agent/AgentSharePanel";
import {
  useDecentralizedPlatforms,
  useDecentralizedDeploy,
  useDecentralizedDeployments,
  type DecentralizedPlatformConfig,
} from "@/hooks/useDecentralizedDeploy";

import type {
  AgentTool,
  UpdateAgentRequest,
  CreateAgentToolRequest,
} from "@/types/agent_builder";

// =============================================================================
// SIDEBAR NAVIGATION ITEMS
// =============================================================================

const SIDEBAR_ITEMS = [
  { id: "overview", label: "Overview", icon: Bot },
  { id: "prompt", label: "System Prompt", icon: FileText },
  { id: "model", label: "Model & Params", icon: SlidersHorizontal },
  { id: "tasks", label: "Tasks", icon: Zap },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "workflows", label: "Stack Builder", icon: Workflow },
  { id: "knowledge", label: "Knowledge", icon: Database },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "flywheel", label: "Data Flywheel", icon: RefreshCw },
  { id: "ui", label: "UI Components", icon: Layout },
  { id: "deploy", label: "Deployment", icon: Rocket },
  { id: "share", label: "Share", icon: Share2 },
] as const;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function AgentEditorPage() {
  const navigate = useNavigate();
  const { agentId } = useParams({ from: "/agents/$agentId" });
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [hasChanges, setHasChanges] = useState(false);

  // ---- Form state ----
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);

  // ---- Tool dialog state ----
  const [toolDialogOpen, setToolDialogOpen] = useState(false);
  const [newToolName, setNewToolName] = useState("");
  const [newToolDescription, setNewToolDescription] = useState("");
  const [newToolCode, setNewToolCode] = useState("");

  // ---- AI Prompt generation state ----
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isAnalyzingPrompt, setIsAnalyzingPrompt] = useState(false);
  const [promptAnalysis, setPromptAnalysis] = useState<{
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
    clarity_score: number;
    completeness_score: number;
  } | null>(null);
  const [aiUpdateInstruction, setAiUpdateInstruction] = useState("");
  const [aiUpdateMode, setAiUpdateMode] = useState<
    "refine" | "expand" | "regenerate" | "custom"
  >("refine");
  const [showAiUpdatePanel, setShowAiUpdatePanel] = useState(false);

  // ===========================================================================
  // DATA FETCHING
  // ===========================================================================

  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => agentBuilderClient.getAgent(Number(agentId)),
    enabled: !!agentId,
  });

  const { data: tools = [] } = useQuery({
    queryKey: ["agent-tools", agentId],
    queryFn: () => agentBuilderClient.getAgentTools(Number(agentId)),
    enabled: !!agentId,
  });

  const { data: workflows = [] } = useQuery({
    queryKey: ["agent-workflows", agentId],
    queryFn: () => agentBuilderClient.getAgentWorkflows(Number(agentId)),
    enabled: !!agentId,
  });

  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ["agent-knowledge-bases", agentId],
    queryFn: () => agentBuilderClient.getKnowledgeBases(Number(agentId)),
    enabled: !!agentId,
  });

  const { data: uiComponents = [] } = useQuery({
    queryKey: ["agent-ui-components", agentId],
    queryFn: () => agentBuilderClient.getUIComponents(Number(agentId)),
    enabled: !!agentId,
  });

  const { data: appsData } = useQuery({
    queryKey: ["apps"],
    queryFn: () => IpcClient.getInstance().listApps(),
  });

  // Populate form when agent loads
  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setDescription(agent.description || "");
      setSystemPrompt(agent.systemPrompt || "");
      setModelId(agent.modelId || "");
      setTemperature(agent.temperature ?? 0.7);
      setMaxTokens(agent.maxTokens ?? 4096);
      setSelectedAppId(agent.appId ?? null);
    }
  }, [agent]);

  // ===========================================================================
  // MUTATIONS
  // ===========================================================================

  const updateAgentMutation = useMutation({
    mutationFn: (request: UpdateAgentRequest) =>
      agentBuilderClient.updateAgent(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      showSuccess("Agent saved successfully");
      setHasChanges(false);
    },
    onError: (error) => {
      showError(`Failed to save agent: ${error.message}`);
    },
  });

  const createToolMutation = useMutation({
    mutationFn: (request: CreateAgentToolRequest) =>
      agentBuilderClient.createAgentTool(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tools", agentId] });
      showSuccess("Tool created successfully");
      setToolDialogOpen(false);
      setNewToolName("");
      setNewToolDescription("");
      setNewToolCode("");
    },
    onError: (error) => {
      showError(`Failed to create tool: ${error.message}`);
    },
  });

  const deleteToolMutation = useMutation({
    mutationFn: (toolId: number) => agentBuilderClient.deleteAgentTool(toolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tools", agentId] });
      showSuccess("Tool deleted");
    },
    onError: (error) => {
      showError(`Failed to delete tool: ${error.message}`);
    },
  });

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleSave = () => {
    updateAgentMutation.mutate({
      id: Number(agentId),
      name,
      description,
      systemPrompt,
      modelId,
      temperature,
      maxTokens,
      appId: selectedAppId,
    });
  };

  const handleCreateTool = () => {
    createToolMutation.mutate({
      agentId: Number(agentId),
      name: newToolName,
      description: newToolDescription,
      implementationCode: newToolCode,
    });
  };

  const handleFieldChange = () => {
    setHasChanges(true);
  };

  // ---- AI system prompt handlers ----

  const handleGeneratePrompt = async () => {
    setIsGeneratingPrompt(true);
    try {
      const ipc = IpcClient.getInstance();
      const result = await ipc.generateAgentSystemPrompt({
        name,
        description,
        type: agent?.type || "chatbot",
        capabilities: tools.map((t) => t.name),
      });
      if (result.success && result.systemPrompt) {
        setSystemPrompt(result.systemPrompt);
        setHasChanges(true);
        showSuccess(
          `System prompt generated via ${result.localProcessed ? "local AI" : result.provider}`,
        );
      }
    } catch (error: any) {
      showError(`Failed to generate prompt: ${error.message}`);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const handleAiUpdatePrompt = async () => {
    if (!agent || !aiUpdateInstruction.trim()) return;
    setIsGeneratingPrompt(true);
    try {
      const ipc = IpcClient.getInstance();
      const result = await ipc.updateAgentSystemPromptWithAI({
        agentId: String(agent.id),
        instruction: aiUpdateInstruction,
        mode: aiUpdateMode,
      });
      if (result.success && result.newPrompt) {
        setSystemPrompt(result.newPrompt);
        setHasChanges(true);
        setAiUpdateInstruction("");
        setShowAiUpdatePanel(false);
        showSuccess(
          `Prompt ${aiUpdateMode}d via ${result.localProcessed ? "local AI" : result.provider}`,
        );
      }
    } catch (error: any) {
      showError(`Failed to update prompt: ${error.message}`);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const handleAnalyzePrompt = async () => {
    if (!agent) return;
    setIsAnalyzingPrompt(true);
    setPromptAnalysis(null);
    try {
      const ipc = IpcClient.getInstance();
      const result = await ipc.analyzeAgentSystemPrompt(String(agent.id));
      if (result.success) {
        setPromptAnalysis(result.analysis);
      }
    } catch (error: any) {
      showError(`Failed to analyze prompt: ${error.message}`);
    } finally {
      setIsAnalyzingPrompt(false);
    }
  };

  // ===========================================================================
  // LOADING / NOT FOUND
  // ===========================================================================

  if (agentLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <h2 className="text-lg font-medium">Agent not found</h2>
        <Button variant="outline" onClick={() => navigate({ to: "/agents" })}>
          Back to Agents
        </Button>
      </div>
    );
  }

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="flex flex-col h-full">
      {/* ===== Header ===== */}
      <div className="border-b px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate({ to: "/agents" })}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Bot className="h-5 w-5" />
                {agent.name}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="secondary">{agent.type}</Badge>
                <Badge
                  className={`${
                    agent.status === "deployed"
                      ? "bg-green-500"
                      : agent.status === "testing"
                        ? "bg-yellow-500"
                        : "bg-gray-500"
                  } text-white`}
                >
                  {agent.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  v{agent.version}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  to: "/agents/$agentId/test",
                  params: { agentId: String(agent.id) },
                })
              }
            >
              <Play className="h-4 w-4 mr-2" />
              Test
            </Button>
            <PublishAgentButton agent={agent} />
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateAgentMutation.isPending}
            >
              <Save className="h-4 w-4 mr-2" />
              {updateAgentMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* ===== Body: Sidebar + Content ===== */}
      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar */}
        <div className="w-52 border-r bg-muted/30 p-2 shrink-0">
          <nav className="space-y-0.5">
            {SIDEBAR_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  activeTab === item.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <ScrollArea className="flex-1">
          <div className="p-6">
            {/* ============================================================ */}
            {/* OVERVIEW TAB                                                 */}
            {/* Agent identity + stats — NO model params here               */}
            {/* ============================================================ */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold">Overview</h2>

                {/* Quick Stats */}
                <div className="grid grid-cols-4 gap-3">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Wrench className="h-3.5 w-3.5" />
                        Tools
                      </div>
                      <p className="text-2xl font-bold mt-1">{tools.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Workflow className="h-3.5 w-3.5" />
                        Workflows
                      </div>
                      <p className="text-2xl font-bold mt-1">
                        {workflows.length}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Database className="h-3.5 w-3.5" />
                        Knowledge Bases
                      </div>
                      <p className="text-2xl font-bold mt-1">
                        {knowledgeBases.length}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Layout className="h-3.5 w-3.5" />
                        UI Components
                      </div>
                      <p className="text-2xl font-bold mt-1">
                        {uiComponents.length}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Name & Description */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Identity</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="name">Name</Label>
                      <Input
                        id="name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          handleFieldChange();
                        }}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(e) => {
                          setDescription(e.target.value);
                          handleFieldChange();
                        }}
                        className="mt-1"
                        rows={3}
                        placeholder="Describe what this agent does..."
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Linked App */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      Linked App
                    </CardTitle>
                    <CardDescription>
                      Attach a built app to this agent as its UI skin
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Select
                      value={selectedAppId ? String(selectedAppId) : "none"}
                      onValueChange={(value) => {
                        setSelectedAppId(value === "none" ? null : Number(value));
                        handleFieldChange();
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select an app..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No app linked</SelectItem>
                        {appsData?.apps.map((app) => (
                          <SelectItem key={app.id} value={String(app.id)}>
                            {app.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedAppId && appsData?.apps.find((a) => a.id === selectedAppId) && (
                      <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm">
                        <Smartphone className="h-4 w-4 text-violet-500 shrink-0" />
                        <span className="text-muted-foreground truncate">
                          {appsData.apps.find((a) => a.id === selectedAppId)?.name}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Configuration Summary (read-only overview) */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      Configuration Summary
                    </CardTitle>
                    <CardDescription>
                      Edit these values in their respective tabs
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Type</span>
                        <Badge variant="outline">{agent.type}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant="outline">{agent.status}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Model</span>
                        <span className="font-medium">
                          {modelId || "Not set"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Temperature
                        </span>
                        <span className="font-medium">{temperature}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Max Tokens
                        </span>
                        <span className="font-medium">{maxTokens}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          System Prompt
                        </span>
                        <span className="font-medium">
                          {systemPrompt
                            ? `${systemPrompt.length} chars`
                            : "Not set"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Linked App
                        </span>
                        <span className="font-medium">
                          {selectedAppId
                            ? appsData?.apps.find((a) => a.id === selectedAppId)?.name || "Unknown"
                            : "None"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ============================================================ */}
            {/* SYSTEM PROMPT TAB (with AI generation)                       */}
            {/* ============================================================ */}
            {activeTab === "prompt" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">System Prompt</h2>
                    <p className="text-sm text-muted-foreground">
                      Define the personality, capabilities, and behavior of your
                      agent. Use AI to generate or refine the prompt.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAnalyzePrompt}
                            disabled={isAnalyzingPrompt || !systemPrompt}
                          >
                            {isAnalyzingPrompt ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <BarChart3 className="h-4 w-4" />
                            )}
                            <span className="ml-1.5">Analyze</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Analyze prompt quality with local AI
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setShowAiUpdatePanel(!showAiUpdatePanel)
                            }
                            disabled={!systemPrompt}
                          >
                            <WandSparkles className="h-4 w-4" />
                            <span className="ml-1.5">Refine with AI</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Use AI to refine, expand, or regenerate
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <Button
                      size="sm"
                      onClick={handleGeneratePrompt}
                      disabled={isGeneratingPrompt}
                    >
                      {isGeneratingPrompt ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-1.5" />
                      )}
                      Generate with AI
                    </Button>
                  </div>
                </div>

                {/* AI Analysis Results */}
                {promptAnalysis && (
                  <Card className="border-blue-500/30 bg-blue-500/5">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Prompt Analysis
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => setPromptAnalysis(null)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            Clarity:
                          </span>
                          <Progress
                            value={promptAnalysis.clarity_score * 10}
                            className="w-20 h-2"
                          />
                          <span className="font-medium">
                            {promptAnalysis.clarity_score}/10
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            Completeness:
                          </span>
                          <Progress
                            value={promptAnalysis.completeness_score * 10}
                            className="w-20 h-2"
                          />
                          <span className="font-medium">
                            {promptAnalysis.completeness_score}/10
                          </span>
                        </div>
                      </div>

                      {promptAnalysis.strengths.length > 0 && (
                        <div>
                          <span className="font-medium text-green-600">
                            Strengths:
                          </span>
                          <ul className="mt-1 space-y-0.5 list-disc list-inside text-muted-foreground">
                            {promptAnalysis.strengths.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {promptAnalysis.suggestions.length > 0 && (
                        <div>
                          <span className="font-medium text-amber-600">
                            Suggestions:
                          </span>
                          <ul className="mt-1 space-y-0.5 list-disc list-inside text-muted-foreground">
                            {promptAnalysis.suggestions.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* AI Update Panel */}
                {showAiUpdatePanel && (
                  <Card className="border-purple-500/30 bg-purple-500/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <WandSparkles className="h-4 w-4" />
                        Refine Prompt with AI
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex gap-2">
                        {(
                          [
                            {
                              value: "refine" as const,
                              label: "Refine",
                              icon: RefreshCw,
                            },
                            {
                              value: "expand" as const,
                              label: "Expand",
                              icon: Expand,
                            },
                            {
                              value: "regenerate" as const,
                              label: "Regenerate",
                              icon: Sparkles,
                            },
                            {
                              value: "custom" as const,
                              label: "Custom",
                              icon: Settings,
                            },
                          ] as const
                        ).map((mode) => (
                          <Button
                            key={mode.value}
                            variant={
                              aiUpdateMode === mode.value
                                ? "default"
                                : "outline"
                            }
                            size="sm"
                            onClick={() => setAiUpdateMode(mode.value)}
                          >
                            <mode.icon className="h-3.5 w-3.5 mr-1" />
                            {mode.label}
                          </Button>
                        ))}
                      </div>
                      <Textarea
                        value={aiUpdateInstruction}
                        onChange={(e) =>
                          setAiUpdateInstruction(e.target.value)
                        }
                        placeholder={
                          aiUpdateMode === "refine"
                            ? "What should be improved? e.g., Make it more concise..."
                            : aiUpdateMode === "expand"
                              ? "What should be added? e.g., Add error handling guidance..."
                              : aiUpdateMode === "regenerate"
                                ? "New requirements for the prompt..."
                                : "Custom instructions for updating the prompt..."
                        }
                        rows={2}
                        className="text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowAiUpdatePanel(false);
                            setAiUpdateInstruction("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleAiUpdatePrompt}
                          disabled={
                            isGeneratingPrompt || !aiUpdateInstruction.trim()
                          }
                        >
                          {isGeneratingPrompt ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                          ) : (
                            <WandSparkles className="h-4 w-4 mr-1.5" />
                          )}
                          Apply {aiUpdateMode}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Prompt Editor */}
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => {
                    setSystemPrompt(e.target.value);
                    handleFieldChange();
                  }}
                  className="min-h-[500px] font-mono text-sm"
                  placeholder="You are a helpful AI assistant..."
                />
                <p className="text-xs text-muted-foreground text-right">
                  {systemPrompt.length} characters
                </p>
              </div>
            )}

            {/* ============================================================ */}
            {/* MODEL & PARAMETERS TAB                                       */}
            {/* ============================================================ */}
            {activeTab === "model" && (
              <div className="max-w-5xl space-y-6">
                <h2 className="text-lg font-semibold">Model & Parameters</h2>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Language Model</CardTitle>
                    <CardDescription>
                      Select the AI model and tune generation parameters
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div>
                      <Label htmlFor="model">Model</Label>
                      <Select
                        value={modelId}
                        onValueChange={(value) => {
                          setModelId(value);
                          handleFieldChange();
                        }}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gpt-5.1">GPT 5.1</SelectItem>
                          <SelectItem value="gpt-5-mini">
                            GPT 5 Mini
                          </SelectItem>
                          <SelectItem value="claude-opus-4-6">
                            Claude Opus 4.6
                          </SelectItem>
                          <SelectItem value="claude-sonnet-4-20250514">
                            Claude Sonnet 4
                          </SelectItem>
                          <SelectItem value="gemini-3-pro-preview">Gemini 3 Pro</SelectItem>
                          <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash</SelectItem>
                          <SelectItem value="llama3.2:8b">
                            Llama 3.2 8B (Local)
                          </SelectItem>
                          <SelectItem value="qwen2.5-coder:7b">
                            Qwen 2.5 Coder 7B (Local)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Separator />

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label>Temperature</Label>
                        <span className="text-sm font-mono text-muted-foreground">
                          {temperature}
                        </span>
                      </div>
                      <Slider
                        value={[temperature]}
                        onValueChange={(values: number[]) => {
                          setTemperature(values[0]);
                          handleFieldChange();
                        }}
                        min={0}
                        max={2}
                        step={0.1}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Lower = more focused and deterministic. Higher = more
                        creative and varied.
                      </p>
                    </div>

                    <Separator />

                    <div>
                      <Label htmlFor="maxTokens">Max Tokens</Label>
                      <Input
                        id="maxTokens"
                        type="number"
                        value={maxTokens}
                        onChange={(e) => {
                          setMaxTokens(Number(e.target.value));
                          handleFieldChange();
                        }}
                        className="mt-1"
                        min={256}
                        max={128000}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Maximum number of tokens in the model's response.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ============================================================ */}
            {/* TASKS TAB                                                    */}
            {/* ============================================================ */}
            {activeTab === "tasks" && (
              <AgentTasksPanel
                agentId={Number(agentId)}
                agentType={agent?.type}
              />
            )}

            {/* ============================================================ */}
            {/* TOOLS TAB                                                    */}
            {/* ============================================================ */}
            {activeTab === "tools" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Tools</h2>
                    <p className="text-sm text-muted-foreground">
                      Define custom tools your agent can use
                    </p>
                  </div>
                  <Dialog
                    open={toolDialogOpen}
                    onOpenChange={setToolDialogOpen}
                  >
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Tool
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Create New Tool</DialogTitle>
                        <DialogDescription>
                          Define a custom tool for your agent
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div>
                          <Label>Tool Name</Label>
                          <Input
                            value={newToolName}
                            onChange={(e) => setNewToolName(e.target.value)}
                            placeholder="get_weather"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>Description</Label>
                          <Textarea
                            value={newToolDescription}
                            onChange={(e) =>
                              setNewToolDescription(e.target.value)
                            }
                            placeholder="Get the current weather for a location"
                            className="mt-1"
                            rows={2}
                          />
                        </div>
                        <div>
                          <Label>Implementation Code</Label>
                          <Textarea
                            value={newToolCode}
                            onChange={(e) => setNewToolCode(e.target.value)}
                            placeholder="// JavaScript code for the tool"
                            className="mt-1 font-mono text-sm"
                            rows={10}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setToolDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleCreateTool}
                          disabled={createToolMutation.isPending}
                        >
                          {createToolMutation.isPending
                            ? "Creating..."
                            : "Create Tool"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

                {tools.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                      <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="font-medium mb-2">No tools yet</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Add tools to extend your agent's capabilities
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {tools.map((tool) => (
                      <Card key={tool.id}>
                        <CardHeader className="py-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-base flex items-center gap-2">
                                <Code className="h-4 w-4" />
                                {tool.name}
                              </CardTitle>
                              <CardDescription>
                                {tool.description}
                              </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch checked={tool.enabled} />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() =>
                                  deleteToolMutation.mutate(tool.id)
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ============================================================ */}
            {/* WORKFLOWS / STACK BUILDER TAB                                */}
            {/* ============================================================ */}
            {activeTab === "workflows" && (
              <AgentStackBuilder
                agentId={Number(agentId)}
                tools={tools.map((t) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  enabled: t.enabled,
                }))}
              />
            )}

            {/* ============================================================ */}
            {/* KNOWLEDGE TAB                                                */}
            {/* ============================================================ */}
            {activeTab === "knowledge" && (
              <AgentKnowledgePanel agentId={Number(agentId)} />
            )}

            {/* ============================================================ */}
            {/* MEMORY TAB                                                   */}
            {/* ============================================================ */}
            {activeTab === "memory" && (
              <AgentMemoryTab agentId={Number(agentId)} />
            )}

            {/* ============================================================ */}
            {/* FLYWHEEL TAB                                                 */}
            {/* ============================================================ */}
            {activeTab === "flywheel" && (
              <AgentFlywheelTab agentId={Number(agentId)} />
            )}

            {/* ============================================================ */}
            {/* UI COMPONENTS TAB                                            */}
            {/* ============================================================ */}
            {activeTab === "ui" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">UI Components</h2>
                    <p className="text-sm text-muted-foreground">
                      Design the user interface for your agent
                    </p>
                  </div>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Component
                  </Button>
                </div>

                {uiComponents.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                      <Layout className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="font-medium mb-2">No UI components</h3>
                      <p className="text-sm text-muted-foreground">
                        Add UI components to create your agent's interface
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {uiComponents.map((component) => (
                      <Card key={component.id}>
                        <CardHeader>
                          <CardTitle className="text-base">
                            {component.name}
                          </CardTitle>
                          <Badge variant="secondary">
                            {component.componentType}
                          </Badge>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ============================================================ */}
            {/* DEPLOYMENT TAB                                               */}
            {/* ============================================================ */}
            {activeTab === "deploy" && (
              <div className="max-w-5xl space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-2">Deployment</h2>
                  <p className="text-sm text-muted-foreground">
                    Deploy your agent to various platforms
                  </p>
                </div>

                {/* Traditional Deployment */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Traditional
                  </h3>
                  <div className="grid gap-3">
                    {[
                      {
                        id: "web-chat",
                        title: "Chat Widget",
                        description:
                          "Export as embeddable web chat widget (works with any AI provider)",
                        icon: "💬",
                      },
                      {
                        id: "local",
                        title: "Local",
                        description:
                          "Run the agent locally on your machine",
                        icon: "💻",
                      },
                      {
                        id: "docker",
                        title: "Docker",
                        description: "Export as a Docker container",
                        icon: "🐳",
                      },
                      {
                        id: "vercel",
                        title: "Vercel",
                        description: "Deploy to Vercel Edge Functions",
                        icon: "▲",
                      },
                      {
                        id: "aws",
                        title: "AWS Lambda",
                        description: "Deploy to AWS Lambda",
                        icon: "☁️",
                      },
                    ].map((option) => (
                      <Card
                        key={option.id}
                        className="cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => {
                          if (option.id === "web-chat") {
                            agentBuilderClient.exportAgentWebChat(agent.id).then((r) => {
                              if (r.success) showSuccess(`Chat widget exported to: ${r.exportPath}`);
                              else showError(r.error || "Export failed");
                            }).catch((e) => showError(e.message));
                          } else if (option.id === "docker") {
                            agentBuilderClient.exportAgentDocker(agent.id).then((r) => {
                              if (r.success) showSuccess(`Docker export: ${r.exportPath}`);
                              else showError(r.error || "Export failed");
                            }).catch((e) => showError(e.message));
                          } else if (option.id === "local") {
                            agentBuilderClient.exportAgentStandalone(agent.id).then((r) => {
                              if (r.success) showSuccess(`Standalone export: ${r.exportPath}`);
                              else showError(r.error || "Export failed");
                            }).catch((e) => showError(e.message));
                          }
                        }}
                      >
                        <CardHeader className="py-3">
                          <div className="flex items-center gap-4">
                            <span className="text-2xl">{option.icon}</span>
                            <div>
                              <CardTitle className="text-base">
                                {option.title}
                              </CardTitle>
                              <CardDescription>
                                {option.description}
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Decentralized Deploy */}
                <AgentDecentralizedDeploy appId={agent.appId} />
              </div>
            )}

            {/* ============================================================ */}
            {/* SHARE TAB                                                    */}
            {/* ============================================================ */}
            {activeTab === "share" && (
              <div className="max-w-5xl space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-2">Share</h2>
                  <p className="text-sm text-muted-foreground">
                    Configure backend, customize appearance, and get share codes
                    (widget, SDK, link, embed, iframe).
                  </p>
                </div>
                <AgentSharePanel
                  agentId={parseInt(agentId)}
                  agentName={agent.name}
                />
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// =============================================================================
// Decentralized Deploy sub-component
// =============================================================================

const PLATFORM_ICON_MAP: Record<string, React.ReactNode> = {
  "4everland": <Box className="h-5 w-5 text-blue-500" />,
  fleek: <Globe className="h-5 w-5 text-yellow-500" />,
  "ipfs-pinata": <Database className="h-5 w-5 text-purple-500" />,
  "ipfs-infura": <Database className="h-5 w-5 text-orange-500" />,
  "ipfs-web3storage": <Database className="h-5 w-5 text-cyan-500" />,
  arweave: <InfinityIcon className="h-5 w-5 text-gray-400" />,
  filecoin: <Coins className="h-5 w-5 text-green-500" />,
  skynet: <Globe className="h-5 w-5 text-red-500" />,
  spheron: <Shield className="h-5 w-5 text-indigo-500" />,
  filebase: <Database className="h-5 w-5 text-pink-500" />,
};

const PERMANENCE_BADGE: Record<string, string> = {
  permanent: "bg-purple-500/10 text-purple-500 border-purple-500/30",
  pinned: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  temporary: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
};

function AgentDecentralizedDeploy({ appId }: { appId?: number }) {
  const navigate = useNavigate();
  const { data: platforms, isLoading: platformsLoading } =
    useDecentralizedPlatforms();
  const { data: deployments = [] } = useDecentralizedDeployments(
    appId ?? undefined,
  );
  const deployMutation = useDecentralizedDeploy();
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);

  const platformList = platforms
    ? (Object.values(platforms) as DecentralizedPlatformConfig[])
    : [];

  const handleDeploy = () => {
    if (!appId || !selectedPlatform) return;
    deployMutation.mutate(
      { appId, platform: selectedPlatform },
      { onSuccess: () => setDeployDialogOpen(false) },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Decentralized Deploy
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Deploy your app to Web3 storage platforms like IPFS, Arweave, and
            more
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate({ to: "/decentralized-deploy" })}
        >
          <Settings className="h-3.5 w-3.5 mr-1" />
          Full Dashboard
        </Button>
      </div>

      {platformsLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Loading platforms...
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {platformList.map((platform) => {
            const icon = PLATFORM_ICON_MAP[platform.id] ?? (
              <Globe className="h-5 w-5" />
            );
            return (
              <Card
                key={platform.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => {
                  if (!appId) {
                    showError(
                      new Error(
                        "Agent must be linked to an app before deploying",
                      ),
                    );
                    return;
                  }
                  setSelectedPlatform(platform.id);
                  setDeployDialogOpen(true);
                }}
              >
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {icon}
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm">
                        {platform.name}
                      </CardTitle>
                      <CardDescription className="text-xs line-clamp-1">
                        {platform.description}
                      </CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${
                        PERMANENCE_BADGE[platform.permanence] ?? ""
                      }`}
                    >
                      {platform.permanence}
                    </Badge>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}

      {deployments.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Recent Deployments
          </h4>
          <div className="space-y-1.5">
            {deployments.slice(0, 5).map((dep) => (
              <div
                key={dep.id}
                className="flex items-center gap-2 text-xs p-2 rounded-md border bg-muted/20"
              >
                {PLATFORM_ICON_MAP[dep.platform] ?? (
                  <Globe className="h-3.5 w-3.5" />
                )}
                <span className="font-medium">{dep.platform}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    dep.status === "live"
                      ? "text-green-500 border-green-500/30"
                      : dep.status === "failed"
                        ? "text-red-500 border-red-500/30"
                        : "text-yellow-500 border-yellow-500/30"
                  }`}
                >
                  {dep.status}
                </Badge>
                {dep.cid && (
                  <span className="font-mono text-muted-foreground truncate max-w-[120px]">
                    {dep.cid}
                  </span>
                )}
                <span className="ml-auto text-muted-foreground shrink-0">
                  {new Date(dep.createdAt).toLocaleDateString()}
                </span>
                {dep.url && (
                  <a
                    href={dep.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-primary hover:text-primary/80"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={deployDialogOpen} onOpenChange={setDeployDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Deploy to{" "}
              {platformList.find((p) => p.id === selectedPlatform)?.name ??
                selectedPlatform}
            </DialogTitle>
            <DialogDescription>
              This will build your app and deploy it to the selected Web3
              platform. Make sure your credentials are configured in the{" "}
              <button
                className="underline text-primary"
                onClick={() => {
                  setDeployDialogOpen(false);
                  navigate({ to: "/decentralized-deploy" });
                }}
              >
                Decentralized Deploy dashboard
              </button>
              .
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeployDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeploy}
              disabled={deployMutation.isPending}
            >
              {deployMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-2" />
                  Deploy
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Publish Agent Button (self-contained)
// ---------------------------------------------------------------------------

function PublishAgentButton({ agent }: { agent: { id: number; name: string; description?: string | null; type: string } }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const publishAgent = usePublishAgent();

  return (
    <>
      <Button variant="outline" onClick={() => setWizardOpen(true)}>
        <Rocket className="h-4 w-4 mr-2" />
        Publish
      </Button>
      <PublishWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        assetType="agent"
        sourceId={agent.id}
        defaultName={agent.name}
        defaultDescription={agent.description ?? ""}
        defaultCategory="ai-agent"
        isPublishing={publishAgent.isPending}
        onPublish={(payload) => {
          publishAgent.mutate(payload, {
            onSuccess: () => {
              setWizardOpen(false);
              showSuccess("Agent published to JoyMarketplace!");
            },
          });
        }}
      />
    </>
  );
}
