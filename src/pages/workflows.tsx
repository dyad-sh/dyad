/**
 * Workflow Management Page
 * View, create, and manage n8n workflows
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { n8nClient } from "@/ipc/n8n_client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Play,
  Square,
  Plus,
  Trash2,
  RefreshCw,
  Zap,
  Bot,
  GitBranch,
  Sparkles,
  Power,
  PowerOff,
  Workflow,
  MessageSquare,
  Settings,
  Database,
} from "lucide-react";
import type { N8nWorkflow } from "@/types/n8n_types";
import type { N8nDatabaseConfig } from "@/ipc/n8n_client";

export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [workflowPrompt, setWorkflowPrompt] = useState("");
  const [activeTab, setActiveTab] = useState("workflows");

  // Query n8n status
  const { data: n8nStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ["n8n-status"],
    queryFn: () => n8nClient.getN8nStatus(),
    refetchInterval: 5000,
  });

  // Query workflows
  const { data: workflowsData, isLoading: isWorkflowsLoading } = useQuery({
    queryKey: ["n8n-workflows"],
    queryFn: () => n8nClient.listWorkflows(),
    enabled: n8nStatus?.running,
  });

  // Query collaborations
  const { data: collaborations } = useQuery({
    queryKey: ["n8n-collaborations"],
    queryFn: () => n8nClient.listCollaborations(),
  });

  // Start n8n mutation
  const startN8nMutation = useMutation({
    mutationFn: () => n8nClient.startN8n(),
    onSuccess: (result) => {
      if (result.success) {
        toast.success("n8n started successfully");
        queryClient.invalidateQueries({ queryKey: ["n8n-status"] });
      } else {
        toast.error(`Failed to start n8n: ${result.error}`);
      }
    },
    onError: (error) => {
      toast.error(`Error starting n8n: ${error}`);
    },
  });

  // Stop n8n mutation
  const stopN8nMutation = useMutation({
    mutationFn: () => n8nClient.stopN8n(),
    onSuccess: () => {
      toast.success("n8n stopped");
      queryClient.invalidateQueries({ queryKey: ["n8n-status"] });
    },
  });

  // Generate workflow mutation
  const generateWorkflowMutation = useMutation({
    mutationFn: (prompt: string) => n8nClient.generateWorkflow({ prompt }),
    onSuccess: async (result) => {
      if (result.success && result.workflow) {
        // Create the workflow in n8n
        try {
          await n8nClient.createWorkflow(result.workflow);
          toast.success("Workflow generated and created!");
          queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
          setIsGenerateDialogOpen(false);
          setWorkflowPrompt("");
        } catch (error) {
          toast.error(`Failed to create workflow: ${error}`);
        }
      } else {
        toast.error(`Generation failed: ${result.errors?.join(", ")}`);
      }
    },
  });

  // Create meta-workflow mutation
  const createMetaWorkflowMutation = useMutation({
    mutationFn: async () => {
      const metaWorkflow = await n8nClient.createMetaWorkflowBuilder();
      return n8nClient.createWorkflow(metaWorkflow);
    },
    onSuccess: () => {
      toast.success("Meta Workflow Builder created!");
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });

  // Activate workflow mutation
  const activateWorkflowMutation = useMutation({
    mutationFn: (id: string) => n8nClient.activateWorkflow(id),
    onSuccess: () => {
      toast.success("Workflow activated");
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });

  // Deactivate workflow mutation
  const deactivateWorkflowMutation = useMutation({
    mutationFn: (id: string) => n8nClient.deactivateWorkflow(id),
    onSuccess: () => {
      toast.success("Workflow deactivated");
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });

  // Execute workflow mutation
  const executeWorkflowMutation = useMutation({
    mutationFn: (id: string) => n8nClient.executeWorkflow(id),
    onSuccess: (result) => {
      if (result.status === "success") {
        toast.success("Workflow executed successfully");
      } else {
        toast.error(`Workflow execution ${result.status}`);
      }
    },
  });

  // Delete workflow mutation
  const deleteWorkflowMutation = useMutation({
    mutationFn: (id: string) => n8nClient.deleteWorkflow(id),
    onSuccess: () => {
      toast.success("Workflow deleted");
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });

  const workflows = workflowsData?.data || [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/50 p-6 bg-gradient-to-r from-orange-500/5 via-red-500/5 to-rose-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500/20 via-red-500/20 to-rose-500/20 border border-orange-500/20">
              <Workflow className="h-7 w-7 text-orange-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-600 via-red-600 to-rose-600 bg-clip-text text-transparent">
                Workflow Automation
              </h1>
              <p className="text-sm text-muted-foreground">
                Create and manage n8n workflows for your agents
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* n8n Status */}
            <Badge 
              variant={n8nStatus?.running ? "default" : "secondary"}
              className={n8nStatus?.running 
                ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" 
                : "bg-muted/50"
              }
            >
              {n8nStatus?.running ? (
                <>
                  <Power className="h-3 w-3 mr-1" />
                  n8n Running
                </>
              ) : (
                <>
                  <PowerOff className="h-3 w-3 mr-1" />
                  n8n Stopped
                </>
              )}
            </Badge>

            {n8nStatus?.running ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => stopN8nMutation.mutate()}
                disabled={stopN8nMutation.isPending}
                className="border-border/50 hover:border-red-500/30 hover:bg-red-500/10"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop n8n
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => startN8nMutation.mutate()}
                disabled={startN8nMutation.isPending}
                className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 border-0 shadow-lg shadow-orange-500/20"
              >
                <Play className="h-4 w-4 mr-2" />
                Start n8n
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="bg-background/50 backdrop-blur-sm border border-border/50">
            <TabsTrigger value="workflows" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-600">
              <GitBranch className="h-4 w-4 mr-2" />
              Workflows
            </TabsTrigger>
            <TabsTrigger value="generate" className="data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-600">
              <Sparkles className="h-4 w-4 mr-2" />
              AI Generator
            </TabsTrigger>
            <TabsTrigger value="collaborations" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-600">
              <MessageSquare className="h-4 w-4 mr-2" />
              Agent Collaborations
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-gray-500/20 data-[state=active]:text-gray-600">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Workflows Tab */}
          <TabsContent value="workflows" className="flex-1 overflow-hidden">
            <div className="flex flex-col h-full gap-4">
              <div className="flex justify-between items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] })}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => createMetaWorkflowMutation.mutate()}
                    disabled={!n8nStatus?.running || createMetaWorkflowMutation.isPending}
                  >
                    <Bot className="h-4 w-4 mr-2" />
                    Create Meta Builder
                  </Button>
                  
                  <Dialog open={isGenerateDialogOpen} onOpenChange={setIsGenerateDialogOpen}>
                    <DialogTrigger asChild>
                      <Button disabled={!n8nStatus?.running}>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Generate Workflow
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Generate Workflow with AI</DialogTitle>
                        <DialogDescription>
                          Describe what you want your workflow to do and we'll generate it for you.
                        </DialogDescription>
                      </DialogHeader>
                      
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Workflow Description</Label>
                          <Textarea
                            placeholder="E.g., Create a workflow that triggers on a webhook, sends the data to OpenAI for analysis, and posts the result to Slack"
                            value={workflowPrompt}
                            onChange={(e) => setWorkflowPrompt(e.target.value)}
                            rows={6}
                          />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setWorkflowPrompt("Create a scheduled workflow that fetches data from an API every hour and saves it to a database")}
                          >
                            API Data Sync
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setWorkflowPrompt("Create a webhook that receives data, processes it with AI, and sends an email notification")}
                          >
                            AI Processing Pipeline
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setWorkflowPrompt("Create a Slack bot that responds to messages using OpenAI GPT-4")}
                          >
                            Slack AI Bot
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setWorkflowPrompt("Create an error monitoring workflow that sends alerts when issues occur")}
                          >
                            Error Monitor
                          </Button>
                        </div>
                      </div>

                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsGenerateDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          onClick={() => generateWorkflowMutation.mutate(workflowPrompt)}
                          disabled={!workflowPrompt.trim() || generateWorkflowMutation.isPending}
                        >
                          {generateWorkflowMutation.isPending ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4 mr-2" />
                              Generate
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              <ScrollArea className="flex-1">
                {!n8nStatus?.running ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <PowerOff className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium">n8n is not running</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Start n8n to view and manage your workflows
                    </p>
                    <Button onClick={() => startN8nMutation.mutate()}>
                      <Play className="h-4 w-4 mr-2" />
                      Start n8n
                    </Button>
                  </div>
                ) : isWorkflowsLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <RefreshCw className="h-6 w-6 animate-spin" />
                  </div>
                ) : workflows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium">No workflows yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Create your first workflow or generate one with AI
                    </p>
                    <Button onClick={() => setIsGenerateDialogOpen(true)}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Workflow
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {workflows.map((workflow) => (
                      <WorkflowCard
                        key={workflow.id}
                        workflow={workflow}
                        onActivate={() => activateWorkflowMutation.mutate(workflow.id!)}
                        onDeactivate={() => deactivateWorkflowMutation.mutate(workflow.id!)}
                        onExecute={() => executeWorkflowMutation.mutate(workflow.id!)}
                        onDelete={() => deleteWorkflowMutation.mutate(workflow.id!)}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </TabsContent>

          {/* AI Generator Tab */}
          <TabsContent value="generate" className="flex-1 overflow-auto">
            <WorkflowGenerator />
          </TabsContent>

          {/* Collaborations Tab */}
          <TabsContent value="collaborations" className="flex-1 overflow-auto">
            <AgentCollaborations collaborations={collaborations || []} />
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="flex-1 overflow-auto">
            <N8nSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function WorkflowCard({
  workflow,
  onActivate,
  onDeactivate,
  onExecute,
  onDelete,
}: {
  workflow: N8nWorkflow;
  onActivate: () => void;
  onDeactivate: () => void;
  onExecute: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{workflow.name}</CardTitle>
            <CardDescription className="text-xs">
              {workflow.nodes?.length || 0} nodes
            </CardDescription>
          </div>
          <Badge variant={workflow.active ? "default" : "secondary"}>
            {workflow.active ? "Active" : "Inactive"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 flex-wrap">
          {workflow.active ? (
            <Button variant="outline" size="sm" onClick={onDeactivate}>
              <Square className="h-3 w-3 mr-1" />
              Deactivate
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onActivate}>
              <Zap className="h-3 w-3 mr-1" />
              Activate
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onExecute}>
            <Play className="h-3 w-3 mr-1" />
            Execute
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowGenerator() {
  const [prompt, setPrompt] = useState("");
  const [generatedWorkflow, setGeneratedWorkflow] = useState<N8nWorkflow | null>(null);
  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: (p: string) => n8nClient.generateWorkflow({ prompt: p }),
    onSuccess: (result) => {
      if (result.success && result.workflow) {
        setGeneratedWorkflow(result.workflow);
        toast.success(result.explanation || "Workflow generated!");
        if (result.warnings?.length) {
          result.warnings.forEach((w) => toast.warning(w));
        }
      } else {
        toast.error(`Generation failed: ${result.errors?.join(", ")}`);
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: (workflow: N8nWorkflow) => n8nClient.createWorkflow(workflow),
    onSuccess: () => {
      toast.success("Workflow created in n8n!");
      setGeneratedWorkflow(null);
      setPrompt("");
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });

  return (
    <div className="grid md:grid-cols-2 gap-6 p-4">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Workflow Generator
          </CardTitle>
          <CardDescription>
            Describe your automation needs and AI will design the workflow
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>What should this workflow do?</Label>
            <Textarea
              placeholder="E.g., When a new email arrives, analyze it with AI and create a task in my project management tool if it's urgent..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Quick Templates</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Webhook → AI → Slack", prompt: "Create a webhook that processes incoming data with OpenAI and posts results to Slack" },
                { label: "Schedule → API → DB", prompt: "Run every hour to fetch data from an API and save to Postgres database" },
                { label: "Email → AI Analysis", prompt: "Monitor email inbox and analyze incoming messages with AI for sentiment" },
                { label: "Multi-Agent Task", prompt: "Create a workflow where multiple agents collaborate to complete a research task" },
              ].map((t) => (
                <Button
                  key={t.label}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setPrompt(t.prompt)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>

          <Button
            onClick={() => generateMutation.mutate(prompt)}
            disabled={!prompt.trim() || generateMutation.isPending}
            className="w-full"
          >
            {generateMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Workflow
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Generated Workflow
          </CardTitle>
          <CardDescription>
            Preview and deploy your generated workflow
          </CardDescription>
        </CardHeader>
        <CardContent>
          {generatedWorkflow ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Workflow Name</Label>
                <Input value={generatedWorkflow.name} readOnly />
              </div>

              <div className="space-y-2">
                <Label>Nodes ({generatedWorkflow.nodes?.length || 0})</Label>
                <div className="border rounded-lg p-3 space-y-2 max-h-64 overflow-auto">
                  {generatedWorkflow.nodes?.map((node, i) => (
                    <div key={node.id || i} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="text-xs">
                        {i + 1}
                      </Badge>
                      <span className="font-medium">{node.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({node.type.split(".").pop()})
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Raw JSON</Label>
                <pre className="text-xs bg-muted p-2 rounded-lg overflow-auto max-h-32">
                  {JSON.stringify(generatedWorkflow, null, 2)}
                </pre>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setGeneratedWorkflow(null)}
                >
                  Clear
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => createMutation.mutate(generatedWorkflow)}
                  disabled={createMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create in n8n
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
              <GitBranch className="h-12 w-12 mb-4" />
              <p>No workflow generated yet</p>
              <p className="text-sm">Describe your workflow on the left</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import type { AgentCollaboration } from "@/types/n8n_types";

function AgentCollaborations({ collaborations }: { collaborations: AgentCollaboration[] }) {
  const [name, setName] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<number[]>([]);
  const queryClient = useQueryClient();

  const createCollabMutation = useMutation({
    mutationFn: () => n8nClient.createCollaboration(name, selectedAgents),
    onSuccess: () => {
      toast.success("Collaboration created!");
      setName("");
      setSelectedAgents([]);
      queryClient.invalidateQueries({ queryKey: ["n8n-collaborations"] });
    },
  });

  const createWorkflowMutation = useMutation({
    mutationFn: (agentIds: number[]) => n8nClient.createCollaborationWorkflow(agentIds),
    onSuccess: async (workflow) => {
      try {
        await n8nClient.createWorkflow(workflow);
        toast.success("Collaboration workflow created!");
        queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
      } catch (error) {
        toast.error(`Failed to create workflow: ${error}`);
      }
    },
  });

  return (
    <div className="grid md:grid-cols-2 gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Agent Collaborations
          </CardTitle>
          <CardDescription>
            Create groups of agents that can work together
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Collaboration Name</Label>
            <Input
              placeholder="E.g., Research Team"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Selected Agents</Label>
            <div className="text-sm text-muted-foreground">
              {selectedAgents.length > 0
                ? `${selectedAgents.length} agents selected`
                : "Select agents from your agent list"}
            </div>
          </div>

          <Button
            onClick={() => createCollabMutation.mutate()}
            disabled={!name.trim() || selectedAgents.length < 2 || createCollabMutation.isPending}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Collaboration
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Active Collaborations
          </CardTitle>
          <CardDescription>
            Manage ongoing agent collaborations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {collaborations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-4" />
              <p>No collaborations yet</p>
              <p className="text-sm">Create one to enable agents to work together</p>
            </div>
          ) : (
            <div className="space-y-3">
              {collaborations.map((collab) => (
                <div key={collab.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{collab.name}</span>
                    <Badge variant={collab.status === "active" ? "default" : "secondary"}>
                      {collab.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {collab.agentIds.length} agents • {collab.messages?.length || 0} messages
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => createWorkflowMutation.mutate(collab.agentIds)}
                  >
                    <GitBranch className="h-3 w-3 mr-1" />
                    Create Workflow
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// n8n Settings Component
// ============================================================================

function N8nSettings() {
  const queryClient = useQueryClient();
  
  // Fetch current database config
  const { data: dbConfig, isLoading } = useQuery({
    queryKey: ["n8n-db-config"],
    queryFn: () => n8nClient.getDatabaseConfig(),
  });

  // Local state for form
  const [config, setConfig] = useState<Partial<N8nDatabaseConfig>>({
    type: "postgresdb",
    postgresHost: "localhost",
    postgresPort: 5432,
    postgresDatabase: "n8n",
    postgresUser: "postgres",
    postgresPassword: "postgres",
    postgresSchema: "public",
    postgresSsl: false,
  });

  // Update local state when config is loaded
  useState(() => {
    if (dbConfig) {
      setConfig(dbConfig);
    }
  });

  // Save configuration mutation
  const saveConfigMutation = useMutation({
    mutationFn: (newConfig: Partial<N8nDatabaseConfig>) => n8nClient.configureDatabase(newConfig),
    onSuccess: () => {
      toast.success("Database configuration saved. Restart n8n to apply changes.");
      queryClient.invalidateQueries({ queryKey: ["n8n-db-config"] });
    },
    onError: (error) => {
      toast.error(`Failed to save configuration: ${error}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Configuration
          </CardTitle>
          <CardDescription>
            Configure the database for n8n. PostgreSQL is recommended for better compatibility
            and to avoid native module compilation issues.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Database Type Selection */}
          <div className="space-y-2">
            <Label>Database Type</Label>
            <div className="flex gap-4">
              <Button
                variant={config.type === "postgresdb" ? "default" : "outline"}
                onClick={() => setConfig({ ...config, type: "postgresdb" })}
                className="flex-1"
              >
                <Database className="h-4 w-4 mr-2" />
                PostgreSQL (Recommended)
              </Button>
              <Button
                variant={config.type === "sqlite" ? "default" : "outline"}
                onClick={() => setConfig({ ...config, type: "sqlite" })}
                className="flex-1"
              >
                <Database className="h-4 w-4 mr-2" />
                SQLite
              </Button>
            </div>
            {config.type === "sqlite" && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                ⚠️ SQLite requires native module compilation (Visual Studio C++ Build Tools on Windows).
              </p>
            )}
          </div>

          {/* PostgreSQL Configuration */}
          {config.type === "postgresdb" && (
            <div className="space-y-4 border rounded-lg p-4 bg-muted/50">
              <h4 className="font-medium">PostgreSQL Connection</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pg-host">Host</Label>
                  <Input
                    id="pg-host"
                    value={config.postgresHost || ""}
                    onChange={(e) => setConfig({ ...config, postgresHost: e.target.value })}
                    placeholder="localhost"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pg-port">Port</Label>
                  <Input
                    id="pg-port"
                    type="number"
                    value={config.postgresPort || 5432}
                    onChange={(e) => setConfig({ ...config, postgresPort: parseInt(e.target.value) || 5432 })}
                    placeholder="5432"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pg-database">Database Name</Label>
                <Input
                  id="pg-database"
                  value={config.postgresDatabase || ""}
                  onChange={(e) => setConfig({ ...config, postgresDatabase: e.target.value })}
                  placeholder="n8n"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pg-user">Username</Label>
                  <Input
                    id="pg-user"
                    value={config.postgresUser || ""}
                    onChange={(e) => setConfig({ ...config, postgresUser: e.target.value })}
                    placeholder="postgres"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pg-password">Password</Label>
                  <Input
                    id="pg-password"
                    type="password"
                    value={config.postgresPassword || ""}
                    onChange={(e) => setConfig({ ...config, postgresPassword: e.target.value })}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pg-schema">Schema</Label>
                <Input
                  id="pg-schema"
                  value={config.postgresSchema || ""}
                  onChange={(e) => setConfig({ ...config, postgresSchema: e.target.value })}
                  placeholder="public"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pg-ssl"
                  checked={config.postgresSsl || false}
                  onChange={(e) => setConfig({ ...config, postgresSsl: e.target.checked })}
                  className="rounded"
                />
                <Label htmlFor="pg-ssl" className="cursor-pointer">
                  Enable SSL Connection
                </Label>
              </div>
            </div>
          )}

          {/* Quick Setup with Docker */}
          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Quick Setup with Docker
            </h4>
            <p className="text-sm text-muted-foreground">
              Run a PostgreSQL database locally with Docker:
            </p>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
{`docker run -d \\
  --name n8n-postgres \\
  -e POSTGRES_USER=postgres \\
  -e POSTGRES_PASSWORD=postgres \\
  -e POSTGRES_DB=n8n \\
  -p 5432:5432 \\
  postgres:15`}
            </pre>
            <p className="text-xs text-muted-foreground">
              Then use the default settings above to connect.
            </p>
          </div>

          {/* Save Button */}
          <Button
            onClick={() => saveConfigMutation.mutate(config)}
            disabled={saveConfigMutation.isPending}
            className="w-full"
          >
            {saveConfigMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Database className="h-4 w-4 mr-2" />
            )}
            Save Configuration
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Note: You need to restart n8n after changing the database configuration.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
