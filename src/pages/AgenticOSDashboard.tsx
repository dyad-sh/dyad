/**
 * Agentic OS Dashboard - Central Command Center
 * Unified control for 14 AI agents, workflows, marketplace, and enterprise deployment
 * 🦞 Terry's Complete Agentic Operating System
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Play,
  Pause,
  Stop,
  RefreshCw,
  Activity,
  Bot,
  Workflow,
  Store,
  GitBranch,
  Shield,
  Zap,
  Brain,
  Network,
  MonitorSpeaker,
  Database,
  Server,
  TrendingUp,
  Users,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Cpu,
  Globe,
  Settings,
  ExternalLink,
  BarChart3,
  Target,
  Rocket,
} from "lucide-react";

interface Agent {
  id: number;
  name: string;
  type: string;
  status: 'active' | 'dormant' | 'error';
  description: string;
  lastActive?: Date;
  performance: {
    tasks: number;
    success: number;
    avgTime: number;
  };
}

interface SystemMetric {
  service: string;
  port: number;
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  requests: number;
  errors: number;
}

export function AgenticOSDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  // Mock data - In production, these would come from actual APIs
  const systemMetrics: SystemMetric[] = [
    { service: "JoyCreate API", port: 18793, status: "healthy", uptime: 99.9, requests: 45230, errors: 12 },
    { service: "n8n Workflows", port: 5678, status: "healthy", uptime: 99.7, requests: 12450, errors: 3 },
    { service: "OpenClaw Gateway", port: 18789, status: "healthy", uptime: 99.8, requests: 78920, errors: 8 },
    { service: "Dashboard Server", port: 8081, status: "healthy", uptime: 99.6, requests: 5670, errors: 1 },
    { service: "PostgreSQL", port: 5432, status: "healthy", uptime: 99.9, requests: 156000, errors: 0 },
  ];

  const agents: Agent[] = [
    { id: 14, name: "CustomerCare Pro", type: "customer-support", status: "active", description: "Production-ready customer support", performance: { tasks: 1250, success: 98.4, avgTime: 2.3 } },
    { id: 12, name: "CI/CD Pipeline Agent", type: "devops", status: "dormant", description: "Automated deployment pipeline", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 11, name: "Compute Resource Orchestrator", type: "infrastructure", status: "dormant", description: "Multi-agent resource management", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 10, name: "DePIN Network Agent", type: "blockchain", status: "dormant", description: "Decentralized compute network", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 9, name: "Customer Support Agent", type: "support", status: "dormant", description: "RAG-powered support system", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 8, name: "MarketBot v2", type: "marketing", status: "dormant", description: "Advanced marketplace search", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 7, name: "MarketBot v1", type: "marketing", status: "dormant", description: "Marketplace search and analysis", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 6, name: "Agent 6", type: "general", status: "dormant", description: "Unnamed draft agent", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 5, name: "Agent 5", type: "general", status: "dormant", description: "Unnamed draft agent", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 4, name: "Agent 4", type: "general", status: "dormant", description: "Unnamed draft agent", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 3, name: "Agent 3", type: "general", status: "dormant", description: "Unnamed draft agent", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 2, name: "Agent 2", type: "general", status: "dormant", description: "Unnamed draft agent", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 1, name: "Agent 1", type: "general", status: "dormant", description: "Unnamed draft agent", performance: { tasks: 0, success: 0, avgTime: 0 } },
    { id: 13, name: "Agent 13", type: "general", status: "dormant", description: "Unnamed draft agent", performance: { tasks: 0, success: 0, avgTime: 0 } },
  ];

  const activateAgentMutation = useMutation({
    mutationFn: async (agentId: number) => {
      // Simulate API call to activate agent
      await new Promise(resolve => setTimeout(resolve, 1500));
      return { success: true, agentId };
    },
    onSuccess: (data) => {
      toast.success(`Agent ${data.agentId} activated successfully`);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (error) => {
      toast.error(`Failed to activate agent: ${error.message}`);
    },
  });

  const activeAgents = agents.filter(a => a.status === 'active').length;
  const dormantAgents = agents.filter(a => a.status === 'dormant').length;
  const totalTasks = agents.reduce((sum, a) => sum + a.performance.tasks, 0);
  const avgSuccess = agents.filter(a => a.performance.tasks > 0).reduce((sum, a) => sum + a.performance.success, 0) / Math.max(1, agents.filter(a => a.performance.tasks > 0).length);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 text-white">
            <Brain className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-500 to-cyan-500 bg-clip-text text-transparent">
              Agentic OS Command Center
            </h1>
            <p className="text-sm text-muted-foreground">
              14 AI Agents &bull; Multi-Agent Coordination &bull; Enterprise Platform 🦞
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="default" className="gap-1 bg-green-500">
            <CheckCircle2 className="h-3 w-3" />
            System Operational
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <Activity className="h-3 w-3" />
            {activeAgents}/14 Agents Active
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open("http://localhost:8081", "_blank")}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Live Dashboard
          </Button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 p-4">
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Active Agents</span>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{activeAgents}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Dormant</span>
            </div>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{dormantAgents}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Tasks</span>
            </div>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{totalTasks.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/10 border-purple-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Success Rate</span>
            </div>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">{avgSuccess.toFixed(1)}%</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-rose-500/10 to-pink-500/10 border-rose-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-rose-500" />
              <span className="text-xs text-muted-foreground">Services</span>
            </div>
            <p className="text-2xl font-bold text-rose-700 dark:text-rose-400">5/5</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border-indigo-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-indigo-500" />
              <span className="text-xs text-muted-foreground">Uptime</span>
            </div>
            <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">99.8%</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 w-fit">
          <TabsTrigger value="overview" className="gap-1">
            <Activity className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1">
            <Bot className="h-3.5 w-3.5" />
            Agents
          </TabsTrigger>
          <TabsTrigger value="workflows" className="gap-1">
            <Workflow className="h-3.5 w-3.5" />
            Workflows
          </TabsTrigger>
          <TabsTrigger value="marketplace" className="gap-1">
            <Store className="h-3.5 w-3.5" />
            Marketplace
          </TabsTrigger>
          <TabsTrigger value="cicd" className="gap-1">
            <GitBranch className="h-3.5 w-3.5" />
            CI/CD
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="gap-1">
            <MonitorSpeaker className="h-3.5 w-3.5" />
            Monitoring
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="flex-1 m-0 p-4 overflow-auto">
          <div className="space-y-6">
            {/* System Health Grid */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  System Health
                </CardTitle>
                <CardDescription>
                  Real-time status of all agentic OS components
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {systemMetrics.map((metric) => (
                    <div key={metric.service} className="p-3 rounded-lg border bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{metric.service}</span>
                        <Badge 
                          variant={metric.status === 'healthy' ? 'default' : metric.status === 'degraded' ? 'secondary' : 'destructive'}
                          className="text-xs"
                        >
                          {metric.status}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Port:</span>
                          <span>:{metric.port}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Uptime:</span>
                          <span>{metric.uptime}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Requests:</span>
                          <span>{metric.requests.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Errors:</span>
                          <span className={metric.errors === 0 ? "text-green-500" : "text-red-500"}>
                            {metric.errors}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <Button 
                    className="h-auto p-4 flex flex-col items-center gap-2 bg-gradient-to-br from-green-500 to-emerald-500 text-white"
                    onClick={() => {
                      toast.success("Activating all dormant agents...");
                      // In production, this would call the actual activation API
                    }}
                  >
                    <Play className="h-5 w-5" />
                    <span>Activate All Agents</span>
                  </Button>

                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2"
                    onClick={() => window.open("./agentic-marketplace.html", "_blank")}
                  >
                    <Store className="h-5 w-5" />
                    <span>Open Marketplace</span>
                  </Button>

                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2"
                    onClick={() => window.open("http://localhost:5678", "_blank")}
                  >
                    <Workflow className="h-5 w-5" />
                    <span>Open n8n Workflows</span>
                  </Button>

                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2"
                    onClick={() => setActiveTab("cicd")}
                  >
                    <GitBranch className="h-5 w-5" />
                    <span>Deploy to Production</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Agent Status Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  Agent Fleet Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {agents.slice(0, 6).map((agent) => (
                    <div
                      key={agent.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        agent.status === 'active' ? 'bg-green-500/5 border-green-500/20' :
                        'bg-gray-500/5 border-gray-500/20 hover:bg-gray-500/10'
                      }`}
                      onClick={() => setActiveTab("agents")}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{agent.name}</span>
                        <Badge 
                          variant={agent.status === 'active' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {agent.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {agent.description}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center mt-4">
                  <Button variant="outline" onClick={() => setActiveTab("agents")}>
                    View All {agents.length} Agents
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="flex-1 m-0 p-4 overflow-auto">
          <AgentManagement 
            agents={agents}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
            onActivateAgent={(id) => activateAgentMutation.mutate(id)}
            isActivating={activateAgentMutation.isPending}
          />
        </TabsContent>

        {/* Workflows Tab */}
        <TabsContent value="workflows" className="flex-1 m-0 p-4 overflow-auto">
          <WorkflowManagement />
        </TabsContent>

        {/* Marketplace Tab */}
        <TabsContent value="marketplace" className="flex-1 m-0 p-4 overflow-auto">
          <MarketplaceManagement />
        </TabsContent>

        {/* CI/CD Tab */}
        <TabsContent value="cicd" className="flex-1 m-0 p-4 overflow-auto">
          <CICDManagement />
        </TabsContent>

        {/* Monitoring Tab */}
        <TabsContent value="monitoring" className="flex-1 m-0 p-4 overflow-auto">
          <SystemMonitoring metrics={systemMetrics} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Agent Management Component
function AgentManagement({ 
  agents, 
  selectedAgent, 
  onSelectAgent, 
  onActivateAgent, 
  isActivating 
}: {
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelectAgent: (agent: Agent | null) => void;
  onActivateAgent: (id: number) => void;
  isActivating: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Agent Fleet</h2>
          <p className="text-sm text-muted-foreground">
            Manage 14 specialized AI agents across customer service, development, marketing, and infrastructure
          </p>
        </div>
        <Button 
          onClick={() => {
            const dormantAgents = agents.filter(a => a.status === 'dormant');
            dormantAgents.forEach(agent => onActivateAgent(agent.id));
          }}
          disabled={isActivating}
          className="bg-gradient-to-r from-green-500 to-emerald-500 text-white"
        >
          <Play className="h-4 w-4 mr-1" />
          Activate All Dormant
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Card 
            key={agent.id} 
            className={`cursor-pointer transition-all duration-200 ${
              agent.status === 'active' ? 'bg-green-500/5 border-green-500/20 shadow-md' :
              'hover:shadow-md hover:border-primary/40'
            }`}
            onClick={() => onSelectAgent(agent)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded ${
                    agent.status === 'active' ? 'bg-green-500/20 text-green-600' :
                    'bg-gray-500/20 text-gray-500'
                  }`}>
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                  <CardTitle className="text-sm">{agent.name}</CardTitle>
                </div>
                <Badge 
                  variant={agent.status === 'active' ? 'default' : agent.status === 'error' ? 'destructive' : 'secondary'}
                  className="text-xs"
                >
                  {agent.status}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                {agent.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center">
                  <p className="font-medium">{agent.performance.tasks}</p>
                  <p className="text-muted-foreground">Tasks</p>
                </div>
                <div className="text-center">
                  <p className="font-medium">{agent.performance.success}%</p>
                  <p className="text-muted-foreground">Success</p>
                </div>
                <div className="text-center">
                  <p className="font-medium">{agent.performance.avgTime}s</p>
                  <p className="text-muted-foreground">Avg Time</p>
                </div>
              </div>
              
              {agent.status === 'dormant' && (
                <Button 
                  size="sm" 
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-500 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    onActivateAgent(agent.id);
                  }}
                  disabled={isActivating}
                >
                  {isActivating ? (
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3 mr-1" />
                  )}
                  Activate Agent
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedAgent && (
        <Card>
          <CardHeader>
            <CardTitle>Agent Details: {selectedAgent.name}</CardTitle>
            <CardDescription>
              Detailed information and controls for {selectedAgent.name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Agent Type</Label>
                <Badge variant="outline">{selectedAgent.type}</Badge>
              </div>
              <div className="space-y-2">
                <Label>Current Status</Label>
                <Badge variant={selectedAgent.status === 'active' ? 'default' : 'secondary'}>
                  {selectedAgent.status}
                </Badge>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline">
                <Settings className="h-3 w-3 mr-1" />
                Configure
              </Button>
              <Button size="sm" variant="outline">
                <BarChart3 className="h-3 w-3 mr-1" />
                View Logs
              </Button>
              <Button size="sm" variant="outline">
                <ExternalLink className="h-3 w-3 mr-1" />
                Open in Agent Editor
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Workflow Management Component
function WorkflowManagement() {
  const workflows = [
    { name: "Customer Onboarding Flow", status: "active", agents: ["CustomerCare Pro", "Agent 2"], triggers: 45 },
    { name: "Content to Market Pipeline", status: "active", agents: ["MarketBot v1", "Agent 3"], triggers: 23 },
    { name: "Development Deployment Cycle", status: "ready", agents: ["CI/CD Pipeline Agent"], triggers: 0 },
    { name: "Business Intelligence Pipeline", status: "ready", agents: ["Agent 4", "Agent 5"], triggers: 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Multi-Agent Workflows</h2>
          <p className="text-sm text-muted-foreground">
            Coordinate multiple AI agents for complex business processes
          </p>
        </div>
        <Button 
          onClick={() => window.open("http://localhost:5678", "_blank")}
          className="bg-gradient-to-r from-purple-500 to-indigo-500 text-white"
        >
          <ExternalLink className="h-4 w-4 mr-1" />
          Open n8n Studio
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {workflows.map((workflow) => (
          <Card key={workflow.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{workflow.name}</CardTitle>
                <Badge variant={workflow.status === 'active' ? 'default' : 'secondary'}>
                  {workflow.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Connected Agents</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {workflow.agents.map(agent => (
                    <Badge key={agent} variant="outline" className="text-xs">
                      {agent}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Triggers This Month</Label>
                <p className="text-lg font-semibold">{workflow.triggers}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline">
                  <Settings className="h-3 w-3 mr-1" />
                  Configure
                </Button>
                <Button size="sm" variant="outline">
                  <Play className="h-3 w-3 mr-1" />
                  Test Run
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Marketplace Management Component
function MarketplaceManagement() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Agent Marketplace</h2>
          <p className="text-sm text-muted-foreground">
            Revenue sharing platform with 20% platform fee, 80% developer share
          </p>
        </div>
        <Button 
          onClick={() => window.open("./agentic-marketplace.html", "_blank")}
          className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white"
        >
          <ExternalLink className="h-4 w-4 mr-1" />
          Open Marketplace
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">Revenue</span>
            </div>
            <p className="text-2xl font-bold">$12,450</p>
            <p className="text-xs text-muted-foreground">This month</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">Active Customers</span>
            </div>
            <p className="text-2xl font-bold">847</p>
            <p className="text-xs text-muted-foreground">+15% this week</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Store className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium">Published Agents</span>
            </div>
            <p className="text-2xl font-bold">3</p>
            <p className="text-xs text-muted-foreground">11 pending review</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pricing Tiers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="p-3 border rounded-lg">
              <h3 className="font-medium">Free</h3>
              <p className="text-2xl font-bold">$0</p>
              <p className="text-xs text-muted-foreground">1K API calls/month</p>
            </div>
            <div className="p-3 border rounded-lg">
              <h3 className="font-medium">Startup</h3>
              <p className="text-2xl font-bold">$29</p>
              <p className="text-xs text-muted-foreground">10K calls/month</p>
            </div>
            <div className="p-3 border rounded-lg">
              <h3 className="font-medium">Professional</h3>
              <p className="text-2xl font-bold">$99</p>
              <p className="text-xs text-muted-foreground">100K calls/month</p>
            </div>
            <div className="p-3 border rounded-lg">
              <h3 className="font-medium">Enterprise</h3>
              <p className="text-2xl font-bold">$499</p>
              <p className="text-xs text-muted-foreground">Unlimited calls</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// CI/CD Management Component
function CICDManagement() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">CI/CD Pipeline</h2>
          <p className="text-sm text-muted-foreground">
            Production deployment with GitHub Actions, Docker, and blue-green deployment
          </p>
        </div>
        <Button 
          className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white"
          onClick={() => {
            toast.success("Deployment pipeline initiated");
            // In production, this would trigger the actual deployment
          }}
        >
          <Rocket className="h-4 w-4 mr-1" />
          Deploy to Production
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Deployment Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Build Tests</span>
              <Badge variant="default">✓ Passed</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Security Scan</span>
              <Badge variant="default">✓ Passed</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Docker Build</span>
              <Badge variant="default">✓ Ready</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Production Deploy</span>
              <Badge variant="secondary">Ready</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Environment Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="p-3 border rounded-lg">
              <h3 className="font-medium">Development</h3>
              <Badge variant="default" className="mt-1">Active</Badge>
              <p className="text-xs text-muted-foreground mt-1">localhost:18793</p>
            </div>
            <div className="p-3 border rounded-lg">
              <h3 className="font-medium">Staging</h3>
              <Badge variant="secondary" className="mt-1">Ready</Badge>
              <p className="text-xs text-muted-foreground mt-1">staging.joycreate.ai</p>
            </div>
            <div className="p-3 border rounded-lg">
              <h3 className="font-medium">Production</h3>
              <Badge variant="secondary" className="mt-1">Ready</Badge>
              <p className="text-xs text-muted-foreground mt-1">app.joycreate.ai</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// System Monitoring Component
function SystemMonitoring({ metrics }: { metrics: SystemMetric[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">System Monitoring</h2>
        <p className="text-sm text-muted-foreground">
          Real-time performance metrics and health monitoring
        </p>
      </div>

      <div className="grid gap-4">
        {metrics.map((metric) => (
          <Card key={metric.service}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{metric.service}</CardTitle>
                <Badge 
                  variant={
                    metric.status === 'healthy' ? 'default' :
                    metric.status === 'degraded' ? 'secondary' : 'destructive'
                  }
                >
                  {metric.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Port</p>
                  <p className="font-medium">:{metric.port}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Uptime</p>
                  <p className="font-medium">{metric.uptime}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Requests</p>
                  <p className="font-medium">{metric.requests.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Errors</p>
                  <p className={`font-medium ${metric.errors === 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {metric.errors}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                  <span>Health Score</span>
                  <span>{metric.uptime}%</span>
                </div>
                <Progress value={metric.uptime} className="h-2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}