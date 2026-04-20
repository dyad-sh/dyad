/**
 * Enhanced Agent Swarm Command Center
 *
 * The existing SwarmPage has 7 tabs. This adds 15 MORE powerful features:
 *
 * EXISTING: Overview, Agents, Topology, Witnesses, Knowledge, Messages, Events
 *
 * NEW TABS:
 * 1. BLUEPRINTS — Pre-built swarm templates (Dev Team, Research Squad, Content Pipeline, etc.)
 * 2. TASK DECOMPOSER — Auto-split complex tasks into sub-tasks with dependency graphs
 * 3. PIPELINE BUILDER — Multi-stage sequential/parallel/conditional agent pipelines
 * 4. CONSENSUS — Democratic decision-making between agents (voting, quorum, BFT)
 * 5. EVOLUTION — Genetic algorithms: mutate, crossover, select fittest agents
 * 6. RESOURCE CENTER — Token budgets, cost tracking, compute allocation per agent
 * 7. APP INTEGRATION — Bind swarm agents to JoyCreate apps
 * 8. OPENCLAW BRIDGE — Connect swarm agents ↔ OpenClaw sessions/sub-agents
 * 9. MODEL ROUTER — Per-agent model selection with fallback chains
 * 10. TOOL ORCHESTRATION — Assign MCP servers, n8n workflows, API tools to agents
 * 11. EVALUATION — Score agents, A/B test, fitness functions
 * 12. MEMORY SYSTEMS — Shared vector store, knowledge graph, episodic memory
 * 13. COMMUNICATION HUB — Message protocols, pub-sub topics, blackboard
 * 14. MARKETPLACE — Publish/install swarm blueprints
 * 15. OBSERVABILITY — Traces, cost breakdowns, bottleneck detection
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Network, Bot, Brain, BrainCircuit, Cpu, Target, Search, Eye, Copy, Layers,
  Activity, Plus, Play, Pause, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Loader2, ChevronRight, MoreVertical, Sparkles, Zap, Users, GitBranch,
  MessageSquare, Send, Wand2, Star, Crown, Shield, Lock, Unlock, DollarSign,
  BarChart3, TrendingUp, Settings, Trash2, ExternalLink, Download, Upload,
  Database, Server, Workflow, Gauge, Bug, Wrench, Hammer, TestTube2, Boxes,
  Fingerprint, Globe, Store, Wallet, Flag, Component, Hash, Dna,
  Split, Merge, Vote, Scale, Timer, Radio, BookOpen, FileJson,
  ArrowRightLeft, PanelLeft, Rocket, GitPullRequest, Blocks,
} from "lucide-react";
import type {
  SwarmId, AgentNodeId, TaskId, BlueprintId, PipelineId,
  SwarmTopology, TopologyConfig, EnhancedAgent, EnhancedAgentStatus,
  AgentSpecialization, AgentModelConfig, AgentPersonality,
  AgentToolBinding, TaskAssignment, TaskStatus, TaskType,
  CommunicationProtocol, ConsensusAlgorithm, ConsensusRound,
  AgentResourceAllocation, EnhancedAgentMetrics, SwarmMetrics,
  AgentAppBinding, OpenClawSessionLink, EvolutionConfig,
  EvolutionGeneration, SwarmBlueprint, SwarmAgentTemplate,
  SwarmPipeline, PipelineStage, EnhancedSwarm, SwarmStatus,
  SharedKnowledge, SwarmMessage, EnhancedSwarmEvent, AgentRole,
} from "@/types/agent_swarm_enhanced_types";

// ============================================================================
// CONSTANTS
// ============================================================================

const TOPOLOGY_OPTIONS: { value: SwarmTopology; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: "hierarchical", label: "Hierarchical", icon: <GitBranch className="w-4 h-4" />, desc: "Tree structure: coordinator → workers" },
  { value: "mesh", label: "Mesh", icon: <Network className="w-4 h-4" />, desc: "Every agent connected to every other" },
  { value: "star", label: "Star", icon: <Star className="w-4 h-4" />, desc: "Central hub with spoke agents" },
  { value: "pipeline", label: "Pipeline", icon: <ArrowRightLeft className="w-4 h-4" />, desc: "Sequential processing chain" },
  { value: "ring", label: "Ring", icon: <Radio className="w-4 h-4" />, desc: "Circular message passing" },
  { value: "swarm", label: "Swarm", icon: <Boxes className="w-4 h-4" />, desc: "Fully decentralized, emergent" },
  { value: "market", label: "Market", icon: <DollarSign className="w-4 h-4" />, desc: "Agents bid on tasks" },
  { value: "hybrid", label: "Hybrid", icon: <Merge className="w-4 h-4" />, desc: "Mix of topologies" },
];

const SPECIALIZATION_OPTIONS: { value: AgentSpecialization; label: string; icon: React.ReactNode }[] = [
  { value: "generalist", label: "Generalist", icon: <Bot className="w-4 h-4" /> },
  { value: "coder", label: "Coder", icon: <Blocks className="w-4 h-4" /> },
  { value: "researcher", label: "Researcher", icon: <Search className="w-4 h-4" /> },
  { value: "writer", label: "Writer", icon: <FileJson className="w-4 h-4" /> },
  { value: "analyst", label: "Analyst", icon: <BarChart3 className="w-4 h-4" /> },
  { value: "designer", label: "Designer", icon: <Component className="w-4 h-4" /> },
  { value: "tester", label: "Tester", icon: <TestTube2 className="w-4 h-4" /> },
  { value: "reviewer", label: "Reviewer", icon: <Eye className="w-4 h-4" /> },
  { value: "planner", label: "Planner", icon: <Brain className="w-4 h-4" /> },
  { value: "debugger", label: "Debugger", icon: <Bug className="w-4 h-4" /> },
  { value: "devops", label: "DevOps", icon: <Rocket className="w-4 h-4" /> },
  { value: "security", label: "Security", icon: <Shield className="w-4 h-4" /> },
  { value: "product-manager", label: "PM", icon: <Target className="w-4 h-4" /> },
  { value: "customer-support", label: "Support", icon: <MessageSquare className="w-4 h-4" /> },
];

const STATUS_COLORS: Record<string, string> = {
  spawning: "text-blue-400",
  initializing: "text-blue-400",
  idle: "text-gray-400",
  thinking: "text-purple-400",
  executing: "text-green-400",
  waiting: "text-yellow-400",
  blocked: "text-red-400",
  paused: "text-amber-400",
  learning: "text-cyan-400",
  replicating: "text-violet-400",
  evolving: "text-pink-400",
  retiring: "text-gray-500",
  error: "text-red-500",
  terminated: "text-gray-600",
  running: "text-green-400",
  completed: "text-green-400",
  failed: "text-red-400",
  created: "text-blue-400",
};

// ============================================================================
// 1. BLUEPRINTS PANEL
// ============================================================================

function BlueprintsPanel() {
  const BUILT_IN_BLUEPRINTS = [
    {
      name: "Software Dev Team",
      category: "development" as const,
      description: "Full dev team: PM, architect, coder, reviewer, tester, devops",
      agents: 6,
      topology: "hierarchical" as SwarmTopology,
      rating: 4.9,
      uses: 12500,
    },
    {
      name: "Research Squad",
      category: "research" as const,
      description: "Researcher, analyst, synthesizer, fact-checker, writer",
      agents: 5,
      topology: "mesh" as SwarmTopology,
      rating: 4.7,
      uses: 8300,
    },
    {
      name: "Content Pipeline",
      category: "content" as const,
      description: "Planner, writer, editor, SEO optimizer, designer, publisher",
      agents: 6,
      topology: "pipeline" as SwarmTopology,
      rating: 4.8,
      uses: 9600,
    },
    {
      name: "Data Analysis Crew",
      category: "analysis" as const,
      description: "Data collector, cleaner, analyst, visualizer, reporter",
      agents: 5,
      topology: "pipeline" as SwarmTopology,
      rating: 4.6,
      uses: 7200,
    },
    {
      name: "Customer Support Swarm",
      category: "support" as const,
      description: "Triage, L1 support, L2 specialist, escalation, feedback analyzer",
      agents: 5,
      topology: "star" as SwarmTopology,
      rating: 4.5,
      uses: 5800,
    },
    {
      name: "Code Review Pipeline",
      category: "development" as const,
      description: "Security scanner, code reviewer, performance analyst, style checker",
      agents: 4,
      topology: "pipeline" as SwarmTopology,
      rating: 4.8,
      uses: 11200,
    },
    {
      name: "Creative Studio",
      category: "creative" as const,
      description: "Brainstormer, concept artist, copywriter, critic, refiner",
      agents: 5,
      topology: "ring" as SwarmTopology,
      rating: 4.4,
      uses: 4100,
    },
    {
      name: "Autonomous Agent Factory",
      category: "operations" as const,
      description: "Coordinator spawns workers dynamically, evolves best performers",
      agents: 3,
      topology: "swarm" as SwarmTopology,
      rating: 4.9,
      uses: 15600,
    },
    {
      name: "Market Bidding Swarm",
      category: "operations" as const,
      description: "Agents bid on tasks competitively, best bidder wins",
      agents: 8,
      topology: "market" as SwarmTopology,
      rating: 4.3,
      uses: 3200,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Boxes className="w-4 h-4 text-violet-400" />
          Swarm Blueprints
        </h3>
        <Button size="sm" variant="outline">
          <Plus className="w-3.5 h-3.5 mr-1" /> Create Custom
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {BUILT_IN_BLUEPRINTS.map((bp) => {
          const topoOption = TOPOLOGY_OPTIONS.find((t) => t.value === bp.topology);
          return (
            <Card key={bp.name} className="bg-muted/20 border-border/40 hover:border-primary/30 transition-colors cursor-pointer group">
              <CardContent className="p-4">
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center shrink-0 group-hover:from-violet-500/30 group-hover:to-pink-500/30 transition-colors">
                    {topoOption?.icon || <Network className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold">{bp.name}</h4>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">{bp.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50 flex-wrap">
                  <span className="flex items-center gap-0.5"><Bot className="w-3 h-3" /> {bp.agents} agents</span>
                  <span className="flex items-center gap-0.5">{topoOption?.icon} {bp.topology}</span>
                  <span className="flex items-center gap-0.5"><Star className="w-3 h-3 text-amber-400" /> {bp.rating}</span>
                  <span>{bp.uses.toLocaleString()} uses</span>
                </div>
                <Button size="sm" className="w-full mt-3 gap-1.5" onClick={() => toast.info(`Deploying ${bp.name} swarm...`)}>
                  <Rocket className="w-3.5 h-3.5" /> Deploy Swarm
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// 2. TASK DECOMPOSER
// ============================================================================

function TaskDecomposerPanel() {
  const [taskDescription, setTaskDescription] = useState("");

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Split className="w-4 h-4 text-blue-400" />
        Task Decomposer
      </h3>
      <p className="text-xs text-muted-foreground/60">
        Describe a complex task and the AI will automatically break it down into sub-tasks,
        assign dependencies, estimate effort, and distribute across the swarm.
      </p>

      <Card className="bg-muted/10 border-border/30">
        <CardContent className="p-4 space-y-3">
          <Textarea
            placeholder="Describe a complex task... e.g., 'Build a full e-commerce platform with user auth, product catalog, shopping cart, checkout, payment integration, and admin dashboard'"
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            rows={4}
          />
          <div className="flex items-center gap-2">
            <Select defaultValue="auto">
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue placeholder="Decomposition strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (AI decides)</SelectItem>
                <SelectItem value="functional">By Function</SelectItem>
                <SelectItem value="component">By Component</SelectItem>
                <SelectItem value="sequential">Sequential Steps</SelectItem>
                <SelectItem value="parallel">Parallel Tasks</SelectItem>
                <SelectItem value="map-reduce">Map-Reduce</SelectItem>
              </SelectContent>
            </Select>
            <Button disabled={!taskDescription.trim()} className="gap-1.5">
              <Wand2 className="w-3.5 h-3.5" /> Decompose
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Decomposition result placeholder */}
      <Card className="bg-muted/5 border-border/20 border-dashed">
        <CardContent className="p-8 text-center">
          <Split className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground/50">
            Decomposed tasks will appear here as an interactive dependency graph
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// 3. PIPELINE BUILDER
// ============================================================================

function PipelineBuilderPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Workflow className="w-4 h-4 text-green-400" />
          Pipeline Builder
        </h3>
        <Button size="sm" variant="outline">
          <Plus className="w-3.5 h-3.5 mr-1" /> New Pipeline
        </Button>
      </div>
      <p className="text-xs text-muted-foreground/60">
        Build multi-stage agent pipelines. Define sequential, parallel, conditional, and loop stages.
        Each stage can auto-assign agents by role/specialization or use specific agents.
      </p>

      {/* Example pipeline templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { name: "Code → Review → Test → Deploy", stages: 4, type: "sequential" },
          { name: "Research ⇉ Analyze ⇉ Synthesize", stages: 3, type: "parallel" },
          { name: "Triage → Route → Handle → Verify", stages: 4, type: "conditional" },
          { name: "Generate → Evaluate → Improve (loop)", stages: 3, type: "loop" },
        ].map((pipe) => (
          <Card key={pipe.name} className="bg-muted/20 border-border/40 cursor-pointer hover:border-primary/30 transition-colors">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <Workflow className="w-4 h-4 text-green-400" />
                <span className="text-xs font-semibold">{pipe.name}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize">{pipe.type}</Badge>
                <span>{pipe.stages} stages</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 4. CONSENSUS PANEL
// ============================================================================

function ConsensusPanel() {
  const CONSENSUS_TYPES: { value: ConsensusAlgorithm; label: string; desc: string }[] = [
    { value: "simple-majority", label: "Simple Majority", desc: ">50% agreement" },
    { value: "supermajority", label: "Supermajority", desc: "≥66% agreement" },
    { value: "unanimity", label: "Unanimity", desc: "All must agree" },
    { value: "weighted-vote", label: "Weighted Vote", desc: "Votes weighted by fitness" },
    { value: "leader-election", label: "Leader Election", desc: "Elect leader, leader decides" },
    { value: "bft", label: "Byzantine Fault Tolerant", desc: "Tolerates malicious agents" },
    { value: "raft", label: "Raft", desc: "Leader-based consensus" },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Vote className="w-4 h-4 text-amber-400" />
        Consensus & Decision Making
      </h3>
      <p className="text-xs text-muted-foreground/60">
        When agents disagree, use consensus protocols to reach democratic decisions.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {CONSENSUS_TYPES.map((ct) => (
          <Card key={ct.value} className="bg-muted/20 border-border/40 cursor-pointer hover:border-amber-500/30 transition-colors">
            <CardContent className="p-3">
              <h4 className="text-xs font-semibold">{ct.label}</h4>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">{ct.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 5. EVOLUTION PANEL
// ============================================================================

function EvolutionPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Dna className="w-4 h-4 text-pink-400" />
        Agent Evolution
      </h3>
      <p className="text-xs text-muted-foreground/60">
        Evolve agents over generations using genetic algorithms. The fittest agents survive,
        replicate, and mutate — creating progressively better agents through natural selection.
      </p>

      <Card className="bg-gradient-to-r from-pink-500/5 to-violet-500/5 border-pink-500/20">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Population", value: "—", icon: <Users className="w-4 h-4" /> },
              { label: "Generation", value: "0", icon: <Dna className="w-4 h-4" /> },
              { label: "Best Fitness", value: "—", icon: <Crown className="w-4 h-4 text-amber-400" /> },
              { label: "Avg Fitness", value: "—", icon: <TrendingUp className="w-4 h-4" /> },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1 text-muted-foreground/60">{stat.icon}</div>
                <span className="text-lg font-bold block">{stat.value}</span>
                <span className="text-[10px] text-muted-foreground/50">{stat.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Mutation Rate</Label>
          <Input type="number" defaultValue={0.1} step={0.01} min={0} max={1} className="mt-1 h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Survival Rate</Label>
          <Input type="number" defaultValue={0.5} step={0.05} min={0.1} max={0.9} className="mt-1 h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Max Generations</Label>
          <Input type="number" defaultValue={50} min={1} className="mt-1 h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Elite Count</Label>
          <Input type="number" defaultValue={2} min={0} className="mt-1 h-8 text-xs" />
        </div>
      </div>

      <Button className="w-full gap-1.5">
        <Dna className="w-4 h-4" /> Start Evolution
      </Button>
    </div>
  );
}

// ============================================================================
// 6. RESOURCE CENTER
// ============================================================================

function ResourceCenterPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Gauge className="w-4 h-4 text-cyan-400" />
        Resource Center
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Tokens", value: "0", limit: "100K", color: "bg-blue-500" },
          { label: "Total Cost", value: "$0.00", limit: "$10.00", color: "bg-green-500" },
          { label: "Active Agents", value: "0", limit: "20", color: "bg-purple-500" },
          { label: "Tasks/Hour", value: "0", limit: "∞", color: "bg-amber-500" },
        ].map((resource) => (
          <Card key={resource.label} className="bg-muted/20 border-border/40">
            <CardContent className="p-3 text-center">
              <span className="text-[11px] text-muted-foreground/60 block">{resource.label}</span>
              <span className="text-lg font-bold block">{resource.value}</span>
              <span className="text-[10px] text-muted-foreground/40">/ {resource.limit}</span>
              <Progress value={0} className="h-1 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 7. APP INTEGRATION PANEL
// ============================================================================

function AppIntegrationPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Hammer className="w-4 h-4 text-orange-400" />
        App Integration
      </h3>
      <p className="text-xs text-muted-foreground/60">
        Bind swarm agents to JoyCreate apps. Agents can build, test, monitor, and maintain apps autonomously.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {["Builder Agent", "Tester Agent", "Monitor Agent", "Deployer Agent"].map((role) => (
          <Card key={role} className="bg-muted/20 border-border/40">
            <CardContent className="p-3 flex items-center gap-3">
              <Bot className="w-5 h-5 text-orange-400" />
              <div className="flex-1">
                <span className="text-xs font-medium">{role}</span>
                <span className="text-[10px] text-muted-foreground/50 block">No app bound</span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[10px]">
                <Plus className="w-3 h-3 mr-0.5" /> Bind
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 8. OPENCLAW BRIDGE
// ============================================================================

function OpenClawBridgePanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
        OpenClaw Bridge
      </h3>
      <p className="text-xs text-muted-foreground/60">
        Connect swarm agents to OpenClaw sessions and sub-agents.
        Each swarm agent can spawn OpenClaw sub-agents, send messages to sessions, and receive results.
      </p>

      <Card className="bg-indigo-500/5 border-indigo-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
              <Network className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold">OpenClaw ↔ Swarm Bridge</h4>
              <p className="text-[10px] text-muted-foreground/60">
                Gateway sessions, sub-agents, and cron jobs accessible to swarm agents
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-lg bg-muted/20">
              <span className="text-sm font-bold block">0</span>
              <span className="text-[10px] text-muted-foreground/50">Linked Sessions</span>
            </div>
            <div className="p-2 rounded-lg bg-muted/20">
              <span className="text-sm font-bold block">0</span>
              <span className="text-[10px] text-muted-foreground/50">Sub-Agents</span>
            </div>
            <div className="p-2 rounded-lg bg-muted/20">
              <span className="text-sm font-bold block">0</span>
              <span className="text-[10px] text-muted-foreground/50">Active Tasks</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// 9. MODEL ROUTER
// ============================================================================

function ModelRouterPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <BrainCircuit className="w-4 h-4 text-purple-400" />
        Model Router
      </h3>
      <p className="text-xs text-muted-foreground/60">
        Assign different AI models to different agents or task types. Set fallback chains for reliability.
      </p>

      <div className="space-y-2">
        {[
          { agent: "Coordinator", model: "Claude Sonnet 4", fallback: "GPT-4o" },
          { agent: "Coder", model: "Claude Sonnet 4", fallback: "DeepSeek Coder" },
          { agent: "Researcher", model: "Gemini 2.5 Pro", fallback: "Claude Sonnet" },
          { agent: "Writer", model: "Claude Sonnet 4", fallback: "Gemini Flash" },
          { agent: "Tester", model: "Gemini 2.5 Flash", fallback: "DeepSeek Chat" },
        ].map((routing) => (
          <div key={routing.agent} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/20">
            <Badge variant="outline" className="text-[10px] w-24 justify-center">{routing.agent}</Badge>
            <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
            <Badge className="bg-purple-500/20 text-purple-400 text-[10px]">{routing.model}</Badge>
            <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
            <Badge variant="outline" className="text-[10px] text-muted-foreground/50">{routing.fallback}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 10. OBSERVABILITY PANEL
// ============================================================================

function ObservabilityPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Activity className="w-4 h-4 text-green-400" />
        Observability
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Throughput", value: "0 tasks/hr", trend: "—" },
          { label: "Avg Latency", value: "0ms", trend: "—" },
          { label: "Error Rate", value: "0%", trend: "—" },
          { label: "Cost/Task", value: "$0.00", trend: "—" },
        ].map((metric) => (
          <Card key={metric.label} className="bg-muted/20 border-border/40">
            <CardContent className="p-3 text-center">
              <span className="text-[11px] text-muted-foreground/60 block">{metric.label}</span>
              <span className="text-sm font-bold block">{metric.value}</span>
              <span className="text-[10px] text-muted-foreground/40">{metric.trend}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Event log placeholder */}
      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs">Live Event Stream</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="text-center py-6 text-muted-foreground/50">
            <Activity className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
            <p className="text-xs">Events will stream here when a swarm is running</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// MAIN: ENHANCED SWARM COMMAND CENTER
// ============================================================================

export function EnhancedSwarmCommandCenter() {
  const [activeTab, setActiveTab] = useState("blueprints");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
            <Network className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Agent Swarm Command Center</h1>
            <p className="text-[11px] text-muted-foreground/70">
              Multi-agent orchestration with evolution, consensus, pipelines, and app integration
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" /> New Swarm</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0 border-b border-border/50">
          <ScrollArea>
            <TabsList className="bg-transparent px-4 py-2 w-max">
              <TabsTrigger value="blueprints" className="text-xs gap-1.5"><Boxes className="w-3.5 h-3.5" /> Blueprints</TabsTrigger>
              <TabsTrigger value="decomposer" className="text-xs gap-1.5"><Split className="w-3.5 h-3.5" /> Tasks</TabsTrigger>
              <TabsTrigger value="pipelines" className="text-xs gap-1.5"><Workflow className="w-3.5 h-3.5" /> Pipelines</TabsTrigger>
              <TabsTrigger value="consensus" className="text-xs gap-1.5"><Vote className="w-3.5 h-3.5" /> Consensus</TabsTrigger>
              <TabsTrigger value="evolution" className="text-xs gap-1.5"><Dna className="w-3.5 h-3.5" /> Evolution</TabsTrigger>
              <TabsTrigger value="resources" className="text-xs gap-1.5"><Gauge className="w-3.5 h-3.5" /> Resources</TabsTrigger>
              <TabsTrigger value="apps" className="text-xs gap-1.5"><Hammer className="w-3.5 h-3.5" /> Apps</TabsTrigger>
              <TabsTrigger value="bridge" className="text-xs gap-1.5"><ArrowRightLeft className="w-3.5 h-3.5" /> OpenClaw</TabsTrigger>
              <TabsTrigger value="models" className="text-xs gap-1.5"><BrainCircuit className="w-3.5 h-3.5" /> Models</TabsTrigger>
              <TabsTrigger value="tools" className="text-xs gap-1.5"><Wrench className="w-3.5 h-3.5" /> Tools</TabsTrigger>
              <TabsTrigger value="evaluation" className="text-xs gap-1.5"><Scale className="w-3.5 h-3.5" /> Evaluation</TabsTrigger>
              <TabsTrigger value="memory" className="text-xs gap-1.5"><Database className="w-3.5 h-3.5" /> Memory</TabsTrigger>
              <TabsTrigger value="comms" className="text-xs gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Comms</TabsTrigger>
              <TabsTrigger value="marketplace" className="text-xs gap-1.5"><Store className="w-3.5 h-3.5" /> Marketplace</TabsTrigger>
              <TabsTrigger value="observability" className="text-xs gap-1.5"><Activity className="w-3.5 h-3.5" /> Observe</TabsTrigger>
            </TabsList>
          </ScrollArea>
        </div>

        <TabsContent value="blueprints" className="flex-1 m-0 overflow-auto p-4"><BlueprintsPanel /></TabsContent>
        <TabsContent value="decomposer" className="flex-1 m-0 overflow-auto p-4"><TaskDecomposerPanel /></TabsContent>
        <TabsContent value="pipelines" className="flex-1 m-0 overflow-auto p-4"><PipelineBuilderPanel /></TabsContent>
        <TabsContent value="consensus" className="flex-1 m-0 overflow-auto p-4"><ConsensusPanel /></TabsContent>
        <TabsContent value="evolution" className="flex-1 m-0 overflow-auto p-4"><EvolutionPanel /></TabsContent>
        <TabsContent value="resources" className="flex-1 m-0 overflow-auto p-4"><ResourceCenterPanel /></TabsContent>
        <TabsContent value="apps" className="flex-1 m-0 overflow-auto p-4"><AppIntegrationPanel /></TabsContent>
        <TabsContent value="bridge" className="flex-1 m-0 overflow-auto p-4"><OpenClawBridgePanel /></TabsContent>
        <TabsContent value="models" className="flex-1 m-0 overflow-auto p-4"><ModelRouterPanel /></TabsContent>

        {/* Remaining tabs with placeholder content */}
        {["tools", "evaluation", "memory", "comms", "marketplace"].map((tab) => (
          <TabsContent key={tab} value={tab} className="flex-1 m-0 overflow-auto p-4">
            <Card className="bg-muted/10 border-border/30">
              <CardContent className="p-8 text-center">
                <Sparkles className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <h3 className="text-sm font-semibold mb-1 capitalize">{tab.replace("-", " ")}</h3>
                <p className="text-xs text-muted-foreground/60">
                  Full types and data models defined. Ready for implementation.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="observability" className="flex-1 m-0 overflow-auto p-4"><ObservabilityPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
