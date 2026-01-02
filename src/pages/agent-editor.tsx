/**
 * Agent Editor Page
 * Configure and customize an AI agent
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
  ChevronRight,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { agentBuilderClient } from "@/ipc/agent_builder_client";
import { showError, showSuccess } from "@/lib/toast";

import type {
  Agent,
  AgentTool,
  AgentWorkflow,
  AgentKnowledgeBase,
  AgentUIComponent,
  UpdateAgentRequest,
  CreateAgentToolRequest,
} from "@/types/agent_builder";

export default function AgentEditorPage() {
  const navigate = useNavigate();
  const { agentId } = useParams({ from: "/agents/$agentId" });
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("general");
  const [hasChanges, setHasChanges] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);

  // Tool dialog state
  const [toolDialogOpen, setToolDialogOpen] = useState(false);
  const [newToolName, setNewToolName] = useState("");
  const [newToolDescription, setNewToolDescription] = useState("");
  const [newToolCode, setNewToolCode] = useState("");

  // Fetch agent data
  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => agentBuilderClient.getAgent(Number(agentId)),
    enabled: !!agentId,
  });

  // Fetch agent tools
  const { data: tools = [] } = useQuery({
    queryKey: ["agent-tools", agentId],
    queryFn: () => agentBuilderClient.getAgentTools(Number(agentId)),
    enabled: !!agentId,
  });

  // Fetch agent workflows
  const { data: workflows = [] } = useQuery({
    queryKey: ["agent-workflows", agentId],
    queryFn: () => agentBuilderClient.getAgentWorkflows(Number(agentId)),
    enabled: !!agentId,
  });

  // Fetch knowledge bases
  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ["agent-knowledge-bases", agentId],
    queryFn: () => agentBuilderClient.getKnowledgeBases(Number(agentId)),
    enabled: !!agentId,
  });

  // Fetch UI components
  const { data: uiComponents = [] } = useQuery({
    queryKey: ["agent-ui-components", agentId],
    queryFn: () => agentBuilderClient.getUIComponents(Number(agentId)),
    enabled: !!agentId,
  });

  // Update form when agent loads
  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setDescription(agent.description || "");
      setSystemPrompt(agent.systemPrompt || "");
      setModelId(agent.modelId || "");
      setTemperature(agent.temperature ?? 0.7);
      setMaxTokens(agent.maxTokens ?? 4096);
    }
  }, [agent]);

  // Update agent mutation
  const updateAgentMutation = useMutation({
    mutationFn: (request: UpdateAgentRequest) => agentBuilderClient.updateAgent(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      showSuccess("Agent saved successfully");
      setHasChanges(false);
    },
    onError: (error) => {
      showError(`Failed to save agent: ${error.message}`);
    },
  });

  // Create tool mutation
  const createToolMutation = useMutation({
    mutationFn: (request: CreateAgentToolRequest) => agentBuilderClient.createAgentTool(request),
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

  // Delete tool mutation
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

  const handleSave = () => {
    updateAgentMutation.mutate({
      id: Number(agentId),
      name,
      description,
      systemPrompt,
      modelId,
      temperature,
      maxTokens,
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

  if (agentLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading agent...</div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <h2 className="text-lg font-medium mb-2">Agent not found</h2>
        <Button variant="outline" onClick={() => navigate({ to: "/agents" })}>
          Back to Agents
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/agents" })}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Bot className="h-5 w-5" />
                {agent.name}
              </h1>
              <div className="flex items-center gap-2 mt-1">
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
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                navigate({ to: "/agents/$agentId/test", params: { agentId: String(agent.id) } })
              }
            >
              <Play className="h-4 w-4 mr-2" />
              Test Agent
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || updateAgentMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {updateAgentMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar */}
        <div className="w-56 border-r bg-muted/30 p-2">
          <nav className="space-y-1">
            {[
              { id: "general", label: "General", icon: Settings },
              { id: "prompt", label: "System Prompt", icon: FileText },
              { id: "tools", label: "Tools", icon: Wrench },
              { id: "workflows", label: "Workflows", icon: Workflow },
              { id: "knowledge", label: "Knowledge Base", icon: Database },
              { id: "ui", label: "UI Components", icon: Layout },
              { id: "deploy", label: "Deployment", icon: Rocket },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  activeTab === item.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* General Settings */}
          {activeTab === "general" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-4">General Settings</h2>
                <div className="space-y-4">
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
                    />
                  </div>
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
                        <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                        <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                        <SelectItem value="claude-3.5-sonnet">Claude 3.5 Sonnet</SelectItem>
                        <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                        <SelectItem value="gemini-pro">Gemini Pro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Temperature: {temperature}</Label>
                    <Slider
                      value={[temperature]}
                      onValueChange={(values: number[]) => {
                        setTemperature(values[0]);
                        handleFieldChange();
                      }}
                      min={0}
                      max={2}
                      step={0.1}
                      className="mt-2"
                    />
                  </div>
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
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* System Prompt */}
          {activeTab === "prompt" && (
            <div className="max-w-4xl space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-2">System Prompt</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Define the personality, capabilities, and behavior of your agent.
                </p>
              </div>
              <Textarea
                value={systemPrompt}
                onChange={(e) => {
                  setSystemPrompt(e.target.value);
                  handleFieldChange();
                }}
                className="min-h-[500px] font-mono text-sm"
                placeholder="You are a helpful AI assistant..."
              />
            </div>
          )}

          {/* Tools */}
          {activeTab === "tools" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Tools</h2>
                  <p className="text-sm text-muted-foreground">
                    Define custom tools your agent can use
                  </p>
                </div>
                <Dialog open={toolDialogOpen} onOpenChange={setToolDialogOpen}>
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
                          onChange={(e) => setNewToolDescription(e.target.value)}
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
                      <Button variant="outline" onClick={() => setToolDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleCreateTool} disabled={createToolMutation.isPending}>
                        {createToolMutation.isPending ? "Creating..." : "Create Tool"}
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
                            <CardDescription>{tool.description}</CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch checked={tool.enabled} />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => deleteToolMutation.mutate(tool.id)}
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

          {/* Workflows */}
          {activeTab === "workflows" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Workflows</h2>
                  <p className="text-sm text-muted-foreground">
                    Create multi-step agent workflows
                  </p>
                </div>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New Workflow
                </Button>
              </div>

              {workflows.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-8">
                    <Workflow className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="font-medium mb-2">No workflows yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Create workflows for complex multi-step tasks
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {workflows.map((workflow) => (
                    <Card key={workflow.id} className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardHeader className="py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base">{workflow.name}</CardTitle>
                            <CardDescription>{workflow.description}</CardDescription>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Knowledge Base */}
          {activeTab === "knowledge" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Knowledge Base</h2>
                  <p className="text-sm text-muted-foreground">
                    Add documents and data for RAG capabilities
                  </p>
                </div>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Source
                </Button>
              </div>

              {knowledgeBases.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-8">
                    <Database className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="font-medium mb-2">No knowledge bases</h3>
                    <p className="text-sm text-muted-foreground">
                      Add documents or data sources for your agent to reference
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {knowledgeBases.map((kb) => (
                    <Card key={kb.id}>
                      <CardHeader>
                        <CardTitle className="text-base">{kb.name}</CardTitle>
                        <CardDescription>{kb.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {kb.documentCount} documents
                          </span>
                          <Badge
                            variant={kb.indexStatus === "indexed" ? "default" : "secondary"}
                          >
                            {kb.indexStatus}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* UI Components */}
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
                        <CardTitle className="text-base">{component.name}</CardTitle>
                        <Badge variant="secondary">{component.componentType}</Badge>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Deployment */}
          {activeTab === "deploy" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-2">Deployment</h2>
                <p className="text-sm text-muted-foreground">
                  Deploy your agent to various platforms
                </p>
              </div>

              <div className="grid gap-4">
                {[
                  {
                    id: "local",
                    title: "Local",
                    description: "Run the agent locally on your machine",
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
                  >
                    <CardHeader>
                      <div className="flex items-center gap-4">
                        <span className="text-2xl">{option.icon}</span>
                        <div>
                          <CardTitle className="text-base">{option.title}</CardTitle>
                          <CardDescription>{option.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
