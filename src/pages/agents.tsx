/**
 * Agent Builder Page
 * Main page for creating and managing AI agents
 */

import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Bot,
  Settings,
  Play,
  Trash2,
  Copy,
  MoreHorizontal,
  Search,
  Filter,
  Grid,
  List,
  Sparkles,
  Workflow,
  Database,
  Code,
  MessageSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { agentBuilderClient } from "@/ipc/agent_builder_client";
import { AGENT_TEMPLATES, TEMPLATE_CATEGORIES } from "@/constants/agent_templates";
import { showError, showSuccess } from "@/lib/toast";

import type { Agent, AgentType, AgentStatus, CreateAgentRequest } from "@/types/agent_builder";

const AGENT_TYPE_ICONS: Record<AgentType, React.ReactNode> = {
  chatbot: <MessageSquare className="h-4 w-4" />,
  task: <Sparkles className="h-4 w-4" />,
  "multi-agent": <Bot className="h-4 w-4" />,
  workflow: <Workflow className="h-4 w-4" />,
  rag: <Database className="h-4 w-4" />,
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  draft: "bg-gray-500/80",
  testing: "bg-amber-500/80",
  deployed: "bg-emerald-500/80",
  archived: "bg-gray-400/80",
};

const AGENT_TYPE_GRADIENTS: Record<AgentType, string> = {
  chatbot: "from-blue-500/10 via-cyan-500/10 to-teal-500/10 hover:from-blue-500/20 hover:via-cyan-500/20 hover:to-teal-500/20",
  task: "from-violet-500/10 via-purple-500/10 to-pink-500/10 hover:from-violet-500/20 hover:via-purple-500/20 hover:to-pink-500/20",
  "multi-agent": "from-orange-500/10 via-amber-500/10 to-yellow-500/10 hover:from-orange-500/20 hover:via-amber-500/20 hover:to-yellow-500/20",
  workflow: "from-emerald-500/10 via-green-500/10 to-lime-500/10 hover:from-emerald-500/20 hover:via-green-500/20 hover:to-lime-500/20",
  rag: "from-rose-500/10 via-pink-500/10 to-fuchsia-500/10 hover:from-rose-500/20 hover:via-pink-500/20 hover:to-fuchsia-500/20",
};

const AGENT_TYPE_ICON_COLORS: Record<AgentType, string> = {
  chatbot: "text-blue-500",
  task: "text-violet-500",
  "multi-agent": "text-orange-500",
  workflow: "text-emerald-500",
  rag: "text-rose-500",
};

export default function AgentBuilderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [newAgentName, setNewAgentName] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Fetch agents
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => agentBuilderClient.listAgents(),
  });

  // Create agent mutation
  const createAgentMutation = useMutation({
    mutationFn: (request: CreateAgentRequest) => agentBuilderClient.createAgent(request),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      showSuccess(`Agent "${agent.name}" created successfully`);
      setCreateDialogOpen(false);
      navigate({ to: "/agents/$agentId", params: { agentId: String(agent.id) } });
    },
    onError: (error) => {
      showError(`Failed to create agent: ${error.message}`);
    },
  });

  // Delete agent mutation
  const deleteAgentMutation = useMutation({
    mutationFn: (agentId: number) => agentBuilderClient.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      showSuccess("Agent deleted successfully");
    },
    onError: (error) => {
      showError(`Failed to delete agent: ${error.message}`);
    },
  });

  // Duplicate agent mutation
  const duplicateAgentMutation = useMutation({
    mutationFn: (agentId: number) => agentBuilderClient.duplicateAgent(agentId),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      showSuccess(`Agent duplicated as "${agent.name}"`);
    },
    onError: (error) => {
      showError(`Failed to duplicate agent: ${error.message}`);
    },
  });

  // Filter agents based on search and tab
  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === "all" || agent.type === activeTab;
    return matchesSearch && matchesTab;
  });

  const handleCreateAgent = () => {
    const template = selectedTemplate
      ? AGENT_TEMPLATES.find((t) => t.id === selectedTemplate)
      : null;

    const request: CreateAgentRequest = {
      name: newAgentName || "New Agent",
      type: template?.type || "chatbot",
      templateId: selectedTemplate || undefined,
      systemPrompt: template?.systemPrompt,
      config: template?.config,
    };

    createAgentMutation.mutate(request);
  };

  const renderAgentCard = (agent: Agent) => (
    <Card 
      key={agent.id} 
      className={`group relative overflow-hidden border-border/50 transition-all duration-300 cursor-pointer
        bg-gradient-to-br ${AGENT_TYPE_GRADIENTS[agent.type]}
        hover:shadow-xl hover:shadow-violet-500/5 hover:border-violet-500/30 hover:scale-[1.02]`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-background/80 via-background/60 to-background/80 backdrop-blur-sm" />
      <CardHeader className="relative pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-gradient-to-br ${AGENT_TYPE_GRADIENTS[agent.type]} border border-border/50`}>
              <span className={AGENT_TYPE_ICON_COLORS[agent.type]}>
                {AGENT_TYPE_ICONS[agent.type]}
              </span>
            </div>
            <CardTitle className="text-lg font-semibold">{agent.name}</CardTitle>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border/50 bg-background/95 backdrop-blur-sm">
              <DropdownMenuItem
                onClick={() =>
                  navigate({ to: "/agents/$agentId", params: { agentId: String(agent.id) } })
                }
              >
                <Settings className="h-4 w-4 mr-2" />
                Configure
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  navigate({
                    to: "/agents/$agentId/test",
                    params: { agentId: String(agent.id) },
                  })
                }
              >
                <Play className="h-4 w-4 mr-2" />
                Test
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => duplicateAgentMutation.mutate(agent.id)}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => deleteAgentMutation.mutate(agent.id)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardDescription className="line-clamp-2 mt-2">
          {agent.description || "No description"}
        </CardDescription>
      </CardHeader>
      <CardContent className="relative">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs bg-background/80 border border-border/50">
            {agent.type}
          </Badge>
          <Badge className={`${STATUS_COLORS[agent.status]} text-white text-xs border-0`}>
            {agent.status}
          </Badge>
        </div>
      </CardContent>
      <CardFooter className="relative pt-0">
        <div className="text-xs text-muted-foreground">
          Updated {new Date(agent.updatedAt).toLocaleDateString()}
        </div>
      </CardFooter>
    </Card>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/50 p-6 bg-gradient-to-r from-violet-500/5 via-purple-500/5 to-pink-500/5">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/20 via-purple-500/20 to-pink-500/20 border border-violet-500/20">
                <Bot className="h-6 w-6 text-violet-500" />
              </div>
              <span className="bg-gradient-to-r from-violet-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                Agent Builder
              </span>
            </h1>
            <p className="text-muted-foreground mt-1">
              Create, configure, and deploy AI agents
            </p>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-lg shadow-violet-500/20 border-0">
                <Plus className="h-4 w-4 mr-2" />
                New Agent
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto border-border/50 bg-background/95 backdrop-blur-sm">
              <DialogHeader>
                <DialogTitle className="text-xl bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Create New Agent</DialogTitle>
                <DialogDescription>
                  Choose a template or start from scratch
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium">Agent Name</label>
                  <Input
                    placeholder="My Awesome Agent"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Choose a Template
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {AGENT_TEMPLATES.map((template) => (
                      <Card
                        key={template.id}
                        className={`cursor-pointer transition-all duration-300 border-border/50
                          bg-gradient-to-br ${AGENT_TYPE_GRADIENTS[template.type]}
                          ${selectedTemplate === template.id
                            ? "ring-2 ring-violet-500 shadow-lg shadow-violet-500/10"
                            : "hover:shadow-md hover:border-violet-500/30"
                          }`}
                        onClick={() => setSelectedTemplate(template.id)}
                      >
                        <CardHeader className="p-3">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <span className={AGENT_TYPE_ICON_COLORS[template.type]}>
                              {AGENT_TYPE_ICONS[template.type]}
                            </span>
                            {template.name}
                          </CardTitle>
                          <CardDescription className="text-xs line-clamp-2">
                            {template.description}
                          </CardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)} className="border-border/50">
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreateAgent} 
                  disabled={createAgentMutation.isPending}
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 border-0"
                >
                  {createAgentMutation.isPending ? "Creating..." : "Create Agent"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 border-border/50 bg-background/50 backdrop-blur-sm focus:border-violet-500/50 focus:ring-violet-500/20"
            />
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-background/50 backdrop-blur-sm border border-border/50">
              <TabsTrigger value="all" className="data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-600">All</TabsTrigger>
              <TabsTrigger value="chatbot" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-600">Chatbots</TabsTrigger>
              <TabsTrigger value="task" className="data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-600">Task Agents</TabsTrigger>
              <TabsTrigger value="workflow" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-600">Workflows</TabsTrigger>
              <TabsTrigger value="rag" className="data-[state=active]:bg-rose-500/20 data-[state=active]:text-rose-600">RAG</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1 border border-border/50 rounded-lg p-1 bg-background/50 backdrop-blur-sm">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className={`h-8 w-8 ${viewMode === "grid" ? "bg-violet-500/20 text-violet-600" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className={`h-8 w-8 ${viewMode === "list" ? "bg-violet-500/20 text-violet-600" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">Loading agents...</div>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No agents yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first AI agent to get started
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Agent
            </Button>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAgents.map(renderAgentCard)}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredAgents.map((agent) => (
              <Card
                key={agent.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    {AGENT_TYPE_ICONS[agent.type]}
                    <div>
                      <h3 className="font-medium">{agent.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {agent.description || "No description"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{agent.type}</Badge>
                    <Badge className={`${STATUS_COLORS[agent.status]} text-white`}>
                      {agent.status}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            navigate({
                              to: "/agents/$agentId",
                              params: { agentId: String(agent.id) },
                            })
                          }
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Configure
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            navigate({
                              to: "/agents/$agentId/test",
                              params: { agentId: String(agent.id) },
                            })
                          }
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Test
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => duplicateAgentMutation.mutate(agent.id)}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => deleteAgentMutation.mutate(agent.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
