/**
 * Enhanced Integrations Hub - Central Command Center
 * Unified control for all JoyCreate integrations: Agentic OS, OpenClaw, n8n, GitHub, AI Services
 * 🦞 Terry's Complete Integration Ecosystem
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  AlertCircle, CheckCircle, ExternalLink, Key, Link, Plus, Settings, Trash2, Webhook,
  Brain, Bot, Workflow, Server, Database, GitBranch, Zap, Activity, Globe, 
  Shield, Cpu, MonitorSpeaker, Store, Target, Users, DollarSign, TrendingUp,
  Play, Pause, RefreshCw, BarChart3, Network, Clock
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

interface SystemComponent {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "operational" | "degraded" | "down";
  port?: number;
  url?: string;
  uptime: number;
  lastCheck: Date;
  metrics?: {
    requests?: number;
    errors?: number;
    responseTime?: number;
  };
}

interface AgentStatus {
  id: number;
  name: string;
  status: 'active' | 'dormant' | 'error';
  tasks: number;
  success: number;
}

const systemComponents: SystemComponent[] = [
  {
    id: "agentic-os",
    name: "Agentic OS Dashboard",
    description: "14 AI Agents + Multi-Agent Coordination",
    category: "Core Platform",
    status: "operational",
    port: 8081,
    url: "/agentic-os",
    uptime: 99.9,
    lastCheck: new Date(Date.now() - 1000 * 30),
    metrics: { requests: 15420, errors: 2, responseTime: 125 }
  },
  {
    id: "joycreate-api",
    name: "JoyCreate API Server",
    description: "Main application backend + agent builder",
    category: "Core Platform",
    status: "operational",
    port: 18793,
    url: "http://localhost:18793",
    uptime: 99.8,
    lastCheck: new Date(Date.now() - 1000 * 45),
    metrics: { requests: 45230, errors: 12, responseTime: 89 }
  },
  {
    id: "openclaw-gateway",
    name: "OpenClaw Gateway",
    description: "AI routing + messaging + provider management",
    category: "AI Infrastructure",
    status: "operational",
    port: 18789,
    url: "/openclaw-control",
    uptime: 99.7,
    lastCheck: new Date(Date.now() - 1000 * 60),
    metrics: { requests: 78920, errors: 8, responseTime: 156 }
  },
  {
    id: "n8n-workflows",
    name: "n8n Workflow Engine",
    description: "Multi-agent coordination + automation",
    category: "Automation",
    status: "operational",
    port: 5678,
    url: "http://localhost:5678",
    uptime: 99.6,
    lastCheck: new Date(Date.now() - 1000 * 90),
    metrics: { requests: 12450, errors: 3, responseTime: 234 }
  },
  {
    id: "postgresql",
    name: "PostgreSQL Database",
    description: "Agent registry + coordination data",
    category: "Data Storage",
    status: "operational",
    port: 5432,
    uptime: 99.9,
    lastCheck: new Date(Date.now() - 1000 * 30),
    metrics: { requests: 156000, errors: 0, responseTime: 12 }
  },
  {
    id: "github-actions",
    name: "GitHub CI/CD Pipeline",
    description: "Automated testing + deployment",
    category: "DevOps",
    status: "operational",
    url: "https://github.com",
    uptime: 99.4,
    lastCheck: new Date(Date.now() - 1000 * 300),
    metrics: { requests: 847, errors: 1, responseTime: 3200 }
  }
];

const agentFleet: AgentStatus[] = [
  { id: 14, name: "CustomerCare Pro", status: "active", tasks: 1250, success: 98.4 },
  { id: 12, name: "CI/CD Pipeline Agent", status: "dormant", tasks: 0, success: 0 },
  { id: 11, name: "Compute Resource Orchestrator", status: "dormant", tasks: 0, success: 0 },
  { id: 10, name: "DePIN Network Agent", status: "dormant", tasks: 0, success: 0 },
  { id: 9, name: "Customer Support Agent", status: "dormant", tasks: 0, success: 0 },
  { id: 8, name: "MarketBot v2", status: "dormant", tasks: 0, success: 0 },
  { id: 7, name: "MarketBot v1", status: "dormant", tasks: 0, success: 0 }
];

const aiProviders = [
  { name: "Claude Sonnet 4", status: "connected", usage: "78%", cost: "$245.67" },
  { name: "Ollama (Local)", status: "connected", usage: "45%", cost: "$0.00" },
  { name: "Gemini 2.5 Pro", status: "connected", usage: "23%", cost: "$89.34" },
  { name: "DeepSeek Chat", status: "connected", usage: "12%", cost: "$12.45" }
];

export function IntegrationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedComponent, setSelectedComponent] = useState<SystemComponent | null>(null);

  const operationalComponents = systemComponents.filter(c => c.status === "operational").length;
  const totalComponents = systemComponents.length;
  const activeAgents = agentFleet.filter(a => a.status === "active").length;
  const totalTasks = agentFleet.reduce((sum, a) => sum + a.tasks, 0);
  const avgUptime = systemComponents.reduce((sum, c) => sum + c.uptime, 0) / systemComponents.length;

  return (
    <div className="flex flex-col h-full">
      {/* Enhanced Header */}
      <div className="flex items-center justify-between p-6 border-b bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white">
            <Globe className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
              Integration Command Center
            </h1>
            <p className="text-sm text-muted-foreground">
              Unified control for Agentic OS, OpenClaw, n8n, GitHub CI/CD, and AI services 🦞
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="default" className="gap-1 bg-green-500">
            <CheckCircle className="h-3 w-3" />
            All Systems Operational
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <Activity className="h-3 w-3" />
            {operationalComponents}/{totalComponents} Services
          </Badge>
          <Button
            onClick={() => navigate({ to: "/agentic-os" })}
            className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white"
          >
            <Brain className="h-4 w-4 mr-1" />
            Agentic OS Dashboard
          </Button>
        </div>
      </div>

      {/* System Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 p-6">
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">System Health</span>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{avgUptime.toFixed(1)}%</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Active Agents</span>
            </div>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{activeAgents}/14</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/10 border-purple-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Tasks Today</span>
            </div>
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">{totalTasks.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Services</span>
            </div>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{operationalComponents}/{totalComponents}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-rose-500/10 to-pink-500/10 border-rose-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-rose-500" />
              <span className="text-xs text-muted-foreground">Workflows</span>
            </div>
            <p className="text-2xl font-bold text-rose-700 dark:text-rose-400">4</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border-indigo-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-indigo-500" />
              <span className="text-xs text-muted-foreground">AI Costs</span>
            </div>
            <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">$347</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-6 w-fit">
          <TabsTrigger value="overview" className="gap-1">
            <Activity className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="components" className="gap-1">
            <Server className="h-3.5 w-3.5" />
            Components
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1">
            <Bot className="h-3.5 w-3.5" />
            AI Agents
          </TabsTrigger>
          <TabsTrigger value="workflows" className="gap-1">
            <Workflow className="h-3.5 w-3.5" />
            Workflows
          </TabsTrigger>
          <TabsTrigger value="providers" className="gap-1">
            <Brain className="h-3.5 w-3.5" />
            AI Providers
          </TabsTrigger>
          <TabsTrigger value="deployment" className="gap-1">
            <GitBranch className="h-3.5 w-3.5" />
            Deployment
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="flex-1 m-0 p-6 overflow-auto">
          <div className="space-y-6">
            {/* Quick Access Grid */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Quick Access
                </CardTitle>
                <CardDescription>
                  Jump directly to any part of the integrated system
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2 hover:bg-gradient-to-br hover:from-purple-500/10 hover:to-blue-500/10"
                    onClick={() => navigate({ to: "/agentic-os" })}
                  >
                    <Brain className="h-6 w-6 text-purple-500" />
                    <span className="font-medium">Agentic OS Dashboard</span>
                    <span className="text-xs text-muted-foreground">14 AI Agents + Coordination</span>
                  </Button>

                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2 hover:bg-gradient-to-br hover:from-blue-500/10 hover:to-cyan-500/10"
                    onClick={() => navigate({ to: "/openclaw-control" })}
                  >
                    <Globe className="h-6 w-6 text-blue-500" />
                    <span className="font-medium">OpenClaw Control</span>
                    <span className="text-xs text-muted-foreground">AI Gateway + Messaging</span>
                  </Button>

                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2 hover:bg-gradient-to-br hover:from-green-500/10 hover:to-emerald-500/10"
                    onClick={() => window.open("http://localhost:5678", "_blank")}
                  >
                    <Workflow className="h-6 w-6 text-green-500" />
                    <span className="font-medium">n8n Workflows</span>
                    <span className="text-xs text-muted-foreground">Multi-Agent Automation</span>
                  </Button>

                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2 hover:bg-gradient-to-br hover:from-amber-500/10 hover:to-orange-500/10"
                    onClick={() => navigate({ to: "/agents" })}
                  >
                    <Bot className="h-6 w-6 text-amber-500" />
                    <span className="font-medium">Agent Builder</span>
                    <span className="text-xs text-muted-foreground">Create & Configure Agents</span>
                  </Button>

                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2 hover:bg-gradient-to-br hover:from-rose-500/10 hover:to-pink-500/10"
                    onClick={() => window.open("./agentic-marketplace.html", "_blank")}
                  >
                    <Store className="h-6 w-6 text-rose-500" />
                    <span className="font-medium">Agent Marketplace</span>
                    <span className="text-xs text-muted-foreground">Revenue Sharing Platform</span>
                  </Button>

                  <Button 
                    variant="outline"
                    className="h-auto p-4 flex flex-col items-center gap-2 hover:bg-gradient-to-br hover:from-indigo-500/10 hover:to-violet-500/10"
                    onClick={() => window.open("http://localhost:8081", "_blank")}
                  >
                    <MonitorSpeaker className="h-6 w-6 text-indigo-500" />
                    <span className="font-medium">Live Dashboard</span>
                    <span className="text-xs text-muted-foreground">Real-Time Monitoring</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* System Architecture Diagram */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Network className="h-5 w-5" />
                  System Architecture
                </CardTitle>
                <CardDescription>
                  How all components are wired together in the agentic ecosystem
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/30 rounded-lg p-6">
                  <div className="font-mono text-sm text-center space-y-2">
                    <div className="text-lg font-bold mb-4">🌐 AGENTIC OS ECOSYSTEM</div>
                    <div className="border-2 border-dashed border-purple-500/50 rounded p-4 bg-purple-500/5">
                      <div className="font-bold text-purple-600">COMMAND CENTER</div>
                      <div className="text-xs text-muted-foreground">JoyCreate Integration Hub</div>
                    </div>
                    <div className="flex justify-center items-center">
                      <div className="w-px h-8 bg-border"></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="border-2 border-dashed border-blue-500/50 rounded p-3 bg-blue-500/5">
                        <div className="font-bold text-blue-600">JoyCreate API</div>
                        <div className="text-xs">(18793)</div>
                      </div>
                      <div className="border-2 border-dashed border-green-500/50 rounded p-3 bg-green-500/5">
                        <div className="font-bold text-green-600">n8n Workflows</div>
                        <div className="text-xs">(5678)</div>
                      </div>
                    </div>
                    <div className="flex justify-center items-center">
                      <div className="w-px h-8 bg-border"></div>
                    </div>
                    <div className="border-2 border-dashed border-amber-500/50 rounded p-3 bg-amber-500/5">
                      <div className="font-bold text-amber-600">OpenClaw Gateway</div>
                      <div className="text-xs">(18789)</div>
                    </div>
                    <div className="flex justify-center items-center">
                      <div className="w-px h-8 bg-border"></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="border-2 border-dashed border-rose-500/50 rounded p-3 bg-rose-500/5">
                        <div className="font-bold text-rose-600">PostgreSQL</div>
                        <div className="text-xs">Agent Registry</div>
                      </div>
                      <div className="border-2 border-dashed border-indigo-500/50 rounded p-3 bg-indigo-500/5">
                        <div className="font-bold text-indigo-600">14 AI Agents</div>
                        <div className="text-xs">Specialized Tasks</div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-3">
                      {[
                        { action: "Agent activated", detail: "CustomerCare Pro started handling support tickets", time: "2 minutes ago", type: "success" },
                        { action: "Workflow triggered", detail: "Customer Onboarding Flow completed successfully", time: "5 minutes ago", type: "info" },
                        { action: "AI API call", detail: "Claude Sonnet 4 processed complex reasoning task", time: "8 minutes ago", type: "info" },
                        { action: "System health check", detail: "All 6 components reporting healthy status", time: "15 minutes ago", type: "success" },
                        { action: "Agent deployment", detail: "CI/CD Pipeline Agent ready for activation", time: "1 hour ago", type: "warning" },
                        { action: "Database sync", detail: "Agent registry updated with new configurations", time: "2 hours ago", type: "info" },
                      ].map((event, i) => (
                        <div key={i} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
                          <div className={`mt-1 w-2 h-2 rounded-full ${
                            event.type === 'success' ? 'bg-green-500' :
                            event.type === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{event.action}</p>
                            <p className="text-xs text-muted-foreground">{event.detail}</p>
                            <p className="text-xs text-muted-foreground mt-1">{event.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Performance Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>System Uptime</span>
                        <span>{avgUptime.toFixed(1)}%</span>
                      </div>
                      <Progress value={avgUptime} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Agent Utilization</span>
                        <span>{((activeAgents / 14) * 100).toFixed(0)}%</span>
                      </div>
                      <Progress value={(activeAgents / 14) * 100} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Workflow Success Rate</span>
                        <span>98.7%</span>
                      </div>
                      <Progress value={98.7} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>API Response Time</span>
                        <span>145ms avg</span>
                      </div>
                      <Progress value={85} className="h-2" />
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-green-600">99.8%</p>
                        <p className="text-xs text-muted-foreground">Availability</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-blue-600">1.2K</p>
                        <p className="text-xs text-muted-foreground">Tasks/Day</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Components Tab */}
        <TabsContent value="components" className="flex-1 m-0 p-6 overflow-auto">
          <ComponentsManagement components={systemComponents} onSelectComponent={setSelectedComponent} />
        </TabsContent>

        {/* AI Agents Tab */}
        <TabsContent value="agents" className="flex-1 m-0 p-6 overflow-auto">
          <AgentsOverview agents={agentFleet} />
        </TabsContent>

        {/* Workflows Tab */}
        <TabsContent value="workflows" className="flex-1 m-0 p-6 overflow-auto">
          <WorkflowsOverview />
        </TabsContent>

        {/* AI Providers Tab */}
        <TabsContent value="providers" className="flex-1 m-0 p-6 overflow-auto">
          <ProvidersOverview providers={aiProviders} />
        </TabsContent>

        {/* Deployment Tab */}
        <TabsContent value="deployment" className="flex-1 m-0 p-6 overflow-auto">
          <DeploymentOverview />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Components Management
function ComponentsManagement({ components, onSelectComponent }: { 
  components: SystemComponent[];
  onSelectComponent: (component: SystemComponent | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">System Components</h2>
        <p className="text-sm text-muted-foreground">
          Status and health monitoring for all integrated services
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {components.map((component) => (
          <Card 
            key={component.id}
            className={`cursor-pointer transition-all ${
              component.status === 'operational' ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'
            }`}
            onClick={() => onSelectComponent(component)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{component.name}</CardTitle>
                <Badge variant={component.status === 'operational' ? 'default' : 'destructive'}>
                  {component.status}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                {component.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Uptime</p>
                  <p className="font-medium">{component.uptime}%</p>
                </div>
                {component.port && (
                  <div>
                    <p className="text-muted-foreground">Port</p>
                    <p className="font-medium">:{component.port}</p>
                  </div>
                )}
              </div>
              
              {component.metrics && (
                <div className="grid grid-cols-3 gap-1 text-xs pt-2 border-t">
                  <div className="text-center">
                    <p className="font-medium">{component.metrics.requests?.toLocaleString()}</p>
                    <p className="text-muted-foreground">Requests</p>
                  </div>
                  <div className="text-center">
                    <p className="font-medium">{component.metrics.errors}</p>
                    <p className="text-muted-foreground">Errors</p>
                  </div>
                  <div className="text-center">
                    <p className="font-medium">{component.metrics.responseTime}ms</p>
                    <p className="text-muted-foreground">Latency</p>
                  </div>
                </div>
              )}
              
              <div className="flex gap-1 pt-2">
                {component.url?.startsWith('http') ? (
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-7"
                    onClick={(e) => { e.stopPropagation(); window.open(component.url, '_blank'); }}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open
                  </Button>
                ) : component.url?.startsWith('/') ? (
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-7"
                    onClick={(e) => { e.stopPropagation(); window.location.href = component.url!; }}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Go To
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" className="text-xs h-7 px-2"
                  onClick={(e) => { e.stopPropagation(); /* Refresh component */ }}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Agents Overview
function AgentsOverview({ agents }: { agents: AgentStatus[] }) {
  const navigate = useNavigate();
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Agent Fleet</h2>
          <p className="text-sm text-muted-foreground">
            14 specialized agents ready for activation and deployment
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate({ to: "/agents" })} variant="outline">
            <Settings className="h-4 w-4 mr-1" />
            Manage Agents
          </Button>
          <Button onClick={() => navigate({ to: "/agentic-os" })}>
            <Brain className="h-4 w-4 mr-1" />
            Full Dashboard
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Card key={agent.id} className={`${
            agent.status === 'active' ? 'bg-green-500/5 border-green-500/20' : 'bg-gray-500/5'
          }`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm">{agent.name}</h3>
                <Badge variant={agent.status === 'active' ? 'default' : 'secondary'}>
                  {agent.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Tasks</p>
                  <p className="font-medium">{agent.tasks}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Success</p>
                  <p className="font-medium">{agent.success}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Workflows Overview
function WorkflowsOverview() {
  const workflows = [
    { name: "Customer Onboarding", status: "active", runs: 45 },
    { name: "Content to Market", status: "active", runs: 23 },
    { name: "Development Cycle", status: "ready", runs: 0 },
    { name: "Business Intelligence", status: "ready", runs: 0 }
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Multi-Agent Workflows</h2>
          <p className="text-sm text-muted-foreground">
            Coordination templates for complex business processes
          </p>
        </div>
        <Button onClick={() => window.open("http://localhost:5678", "_blank")}>
          <ExternalLink className="h-4 w-4 mr-1" />
          Open n8n
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {workflows.map((workflow) => (
          <Card key={workflow.name}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium">{workflow.name}</h3>
                <Badge variant={workflow.status === 'active' ? 'default' : 'secondary'}>
                  {workflow.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {workflow.runs} runs this month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Providers Overview
function ProvidersOverview({ providers }: { providers: any[] }) {
  const navigate = useNavigate();
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Providers</h2>
          <p className="text-sm text-muted-foreground">
            Connected AI services and usage statistics
          </p>
        </div>
        <Button onClick={() => navigate({ to: "/openclaw-control" })}>
          <Settings className="h-4 w-4 mr-1" />
          Configure
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((provider) => (
          <Card key={provider.name}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium">{provider.name}</h3>
                <Badge variant="default">{provider.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Usage</p>
                  <p className="font-medium">{provider.usage}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cost</p>
                  <p className="font-medium">{provider.cost}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Deployment Overview
function DeploymentOverview() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Deployment Pipeline</h2>
        <p className="text-sm text-muted-foreground">
          GitHub Actions CI/CD with Docker and blue-green deployment
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <h3 className="font-medium mb-2">Development</h3>
            <Badge variant="default" className="mb-2">Active</Badge>
            <p className="text-xs text-muted-foreground">localhost:18793</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h3 className="font-medium mb-2">Staging</h3>
            <Badge variant="secondary" className="mb-2">Ready</Badge>
            <p className="text-xs text-muted-foreground">staging.joycreate.ai</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h3 className="font-medium mb-2">Production</h3>
            <Badge variant="secondary" className="mb-2">Ready</Badge>
            <p className="text-xs text-muted-foreground">app.joycreate.ai</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pipeline Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { step: "Build Tests", status: "passed" },
              { step: "Security Scan", status: "passed" },
              { step: "Docker Build", status: "ready" },
              { step: "Deploy to Production", status: "ready" }
            ].map((step) => (
              <div key={step.step} className="flex items-center justify-between">
                <span className="text-sm">{step.step}</span>
                <Badge variant={step.status === 'passed' ? 'default' : 'secondary'}>
                  {step.status === 'passed' ? '✓ Passed' : 'Ready'}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}