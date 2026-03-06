/**
 * Agent Creation Wizard
 *
 * Multi-step review panel that shows an AI-generated blueprint section by section.
 * The user can review, edit each section, then "Confirm & Create" to auto-provision
 * the entire agent end-to-end.
 *
 * Rendered inline in the chat panel when agent creation intent is detected.
 */

import { useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bot,
  Brain,
  Wrench,
  Database,
  Zap,
  Layout,
  Workflow,
  Rocket,
  Check,
  ChevronRight,
  ChevronDown,
  Pencil,
  Loader2,
  Sparkles,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

import type { AgentType } from "@/types/agent_builder";
import type { AgentBlueprint } from "@/lib/agent_blueprint_generator";
import { autoSetupAgent, type AutoSetupProgress } from "@/lib/agent_auto_setup";
import { showError, showSuccess } from "@/lib/toast";

// =============================================================================
// TYPES
// =============================================================================

interface AgentCreationWizardProps {
  blueprint: AgentBlueprint;
  onBlueprintChange?: (blueprint: AgentBlueprint) => void;
  onCreated?: (agentId: number) => void;
  onDismiss?: () => void;
}

type WizardSection =
  | "overview"
  | "systemPrompt"
  | "tools"
  | "knowledge"
  | "triggers"
  | "ui"
  | "workflow"
  | "deployment";

interface SectionState {
  expanded: boolean;
  approved: boolean;
  editing: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AgentCreationWizard({
  blueprint: initialBlueprint,
  onBlueprintChange,
  onCreated,
  onDismiss,
}: AgentCreationWizardProps) {
  const navigate = useNavigate();
  const [blueprint, setBlueprint] = useState<AgentBlueprint>(initialBlueprint);
  const [sections, setSections] = useState<Record<WizardSection, SectionState>>({
    overview: { expanded: true, approved: false, editing: false },
    systemPrompt: { expanded: false, approved: false, editing: false },
    tools: { expanded: false, approved: false, editing: false },
    knowledge: { expanded: false, approved: false, editing: false },
    triggers: { expanded: false, approved: false, editing: false },
    ui: { expanded: false, approved: false, editing: false },
    workflow: { expanded: false, approved: false, editing: false },
    deployment: { expanded: false, approved: false, editing: false },
  });
  const [isCreating, setIsCreating] = useState(false);
  const [setupProgress, setSetupProgress] = useState<AutoSetupProgress[]>([]);
  const [createdAgentId, setCreatedAgentId] = useState<number | null>(null);

  // Helpers
  const updateBlueprint = useCallback(
    (updates: Partial<AgentBlueprint>) => {
      setBlueprint((prev) => {
        const next = { ...prev, ...updates };
        onBlueprintChange?.(next);
        return next;
      });
    },
    [onBlueprintChange],
  );

  const toggleSection = useCallback((section: WizardSection) => {
    setSections((prev) => ({
      ...prev,
      [section]: { ...prev[section], expanded: !prev[section].expanded },
    }));
  }, []);

  const approveSection = useCallback((section: WizardSection) => {
    setSections((prev) => ({
      ...prev,
      [section]: { ...prev[section], approved: true, editing: false },
    }));
  }, []);

  const toggleEditing = useCallback((section: WizardSection) => {
    setSections((prev) => ({
      ...prev,
      [section]: { ...prev[section], editing: !prev[section].editing, expanded: true },
    }));
  }, []);

  const approveAll = useCallback(() => {
    setSections((prev) => {
      const next = { ...prev };
      for (const key in next) {
        next[key as WizardSection] = { ...next[key as WizardSection], approved: true, editing: false };
      }
      return next;
    });
  }, []);

  const allApproved = Object.values(sections).every((s) => s.approved);
  const approvedCount = Object.values(sections).filter((s) => s.approved).length;
  const totalSections = Object.keys(sections).length;

  // Create agent
  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setSetupProgress([]);
    try {
      const result = await autoSetupAgent(blueprint, (progress) => {
        setSetupProgress((prev) => {
          const idx = prev.findIndex((p) => p.step === progress.step);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = progress;
            return next;
          }
          return [...prev, progress];
        });
      });

      if (result.success && result.agentId) {
        setCreatedAgentId(result.agentId);
        showSuccess(`Agent "${blueprint.name}" created successfully!`);
        onCreated?.(result.agentId);
      } else {
        showError(`Agent creation completed with errors: ${result.errors.join(", ")}`);
        if (result.agentId) {
          setCreatedAgentId(result.agentId);
          onCreated?.(result.agentId);
        }
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setIsCreating(false);
    }
  }, [blueprint, onCreated]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <Card className="w-full border-primary/20 bg-card/50 backdrop-blur">
      {/* Header */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Agent Blueprint</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {approvedCount}/{totalSections} reviewed
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {!allApproved && (
              <Button variant="ghost" size="sm" onClick={approveAll}>
                Approve All
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Review each section below, then create your agent.
        </p>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {/* Overview Section */}
        <WizardSectionCard
          title="Overview"
          icon={<Bot className="h-4 w-4" />}
          state={sections.overview}
          onToggle={() => toggleSection("overview")}
          onApprove={() => approveSection("overview")}
          onEdit={() => toggleEditing("overview")}
        >
          {sections.overview.editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Name</label>
                <Input
                  value={blueprint.name}
                  onChange={(e) => updateBlueprint({ name: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Description</label>
                <Textarea
                  value={blueprint.description}
                  onChange={(e) => updateBlueprint({ description: e.target.value })}
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Type</label>
                <Select
                  value={blueprint.type}
                  onValueChange={(v) => updateBlueprint({ type: v as AgentType })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chatbot">Chatbot</SelectItem>
                    <SelectItem value="task">Task Agent</SelectItem>
                    <SelectItem value="rag">RAG Agent</SelectItem>
                    <SelectItem value="workflow">Workflow Agent</SelectItem>
                    <SelectItem value="multi-agent">Multi-Agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Model</label>
                  <Input
                    value={blueprint.modelId}
                    onChange={(e) => updateBlueprint({ modelId: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Temperature</label>
                  <Input
                    type="number"
                    step={0.1}
                    min={0}
                    max={2}
                    value={blueprint.temperature}
                    onChange={(e) => updateBlueprint({ temperature: Number.parseFloat(e.target.value) })}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{blueprint.name}</span>
                <Badge variant="outline" className="text-xs">
                  {blueprint.type}
                </Badge>
              </div>
              <p className="text-muted-foreground">{blueprint.description}</p>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>Model: {blueprint.modelId}</span>
                <span>Temp: {blueprint.temperature}</span>
                <span>Max Tokens: {blueprint.maxTokens}</span>
              </div>
            </div>
          )}
        </WizardSectionCard>

        {/* System Prompt Section */}
        <WizardSectionCard
          title="System Prompt"
          icon={<Brain className="h-4 w-4" />}
          state={sections.systemPrompt}
          onToggle={() => toggleSection("systemPrompt")}
          onApprove={() => approveSection("systemPrompt")}
          onEdit={() => toggleEditing("systemPrompt")}
        >
          {sections.systemPrompt.editing ? (
            <Textarea
              value={blueprint.systemPrompt}
              onChange={(e) => updateBlueprint({ systemPrompt: e.target.value })}
              rows={10}
              className="font-mono text-xs"
            />
          ) : (
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
              {blueprint.systemPrompt.length > 300
                ? `${blueprint.systemPrompt.substring(0, 300)}...`
                : blueprint.systemPrompt}
            </pre>
          )}
        </WizardSectionCard>

        {/* Tools Section */}
        <WizardSectionCard
          title={`Tools (${blueprint.tools.length})`}
          icon={<Wrench className="h-4 w-4" />}
          state={sections.tools}
          onToggle={() => toggleSection("tools")}
          onApprove={() => approveSection("tools")}
          onEdit={() => toggleEditing("tools")}
        >
          {blueprint.tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tools configured</p>
          ) : (
            <div className="space-y-1">
              {blueprint.tools.map((tool, idx) => (
                <div
                  key={`tool-${tool.catalogId}-${idx}`}
                  className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Wrench className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{tool.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {tool.requiresApproval && (
                      <Badge variant="outline" className="text-[10px]">
                        Needs Approval
                      </Badge>
                    )}
                    {sections.tools.editing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1"
                        onClick={() => {
                          updateBlueprint({
                            tools: blueprint.tools.filter((_, i) => i !== idx),
                          });
                        }}
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </WizardSectionCard>

        {/* Knowledge Section */}
        <WizardSectionCard
          title={`Knowledge (${blueprint.knowledgeSources.length})`}
          icon={<Database className="h-4 w-4" />}
          state={sections.knowledge}
          onToggle={() => toggleSection("knowledge")}
          onApprove={() => approveSection("knowledge")}
          onEdit={() => toggleEditing("knowledge")}
        >
          {blueprint.knowledgeSources.length === 0 ? (
            <p className="text-xs text-muted-foreground">No knowledge sources configured</p>
          ) : (
            <div className="space-y-1">
              {blueprint.knowledgeSources.map((source, idx) => (
                <div
                  key={`kb-${source.type}-${idx}`}
                  className="flex items-center justify-between text-xs py-1"
                >
                  <div className="flex items-center gap-2">
                    <Database className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{source.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {source.type}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </WizardSectionCard>

        {/* Triggers Section */}
        <WizardSectionCard
          title={`Triggers (${blueprint.triggers.length})`}
          icon={<Zap className="h-4 w-4" />}
          state={sections.triggers}
          onToggle={() => toggleSection("triggers")}
          onApprove={() => approveSection("triggers")}
          onEdit={() => toggleEditing("triggers")}
        >
          {blueprint.triggers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No triggers configured</p>
          ) : (
            <div className="space-y-1">
              {blueprint.triggers.map((trigger, idx) => (
                <div
                  key={`trigger-${trigger.type}-${idx}`}
                  className="flex items-center justify-between text-xs py-1"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{trigger.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {trigger.type}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </WizardSectionCard>

        {/* UI Components Section */}
        <WizardSectionCard
          title={`UI Components (${blueprint.uiComponents.length})`}
          icon={<Layout className="h-4 w-4" />}
          state={sections.ui}
          onToggle={() => toggleSection("ui")}
          onApprove={() => approveSection("ui")}
          onEdit={() => toggleEditing("ui")}
        >
          {blueprint.uiComponents.length === 0 ? (
            <p className="text-xs text-muted-foreground">No UI components configured</p>
          ) : (
            <div className="space-y-1">
              {blueprint.uiComponents.map((comp, idx) => (
                <div
                  key={`ui-${comp.componentType}-${idx}`}
                  className="flex items-center justify-between text-xs py-1"
                >
                  <div className="flex items-center gap-2">
                    <Layout className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{comp.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {comp.componentType}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </WizardSectionCard>

        {/* Workflow Section (if applicable) */}
        {blueprint.workflow && (
          <WizardSectionCard
            title={`Workflow (${blueprint.workflow.steps.length} steps)`}
            icon={<Workflow className="h-4 w-4" />}
            state={sections.workflow}
            onToggle={() => toggleSection("workflow")}
            onApprove={() => approveSection("workflow")}
            onEdit={() => toggleEditing("workflow")}
          >
            <div className="space-y-1">
              {blueprint.workflow.steps.map((step, idx) => (
                <div
                  key={`wf-${step.name}-${idx}`}
                  className="flex items-center gap-2 text-xs py-1"
                >
                  <span className="text-muted-foreground">{idx + 1}.</span>
                  <span className="font-medium">{step.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {step.type}
                  </Badge>
                </div>
              ))}
            </div>
          </WizardSectionCard>
        )}

        {/* Deployment Section */}
        <WizardSectionCard
          title="Deployment"
          icon={<Rocket className="h-4 w-4" />}
          state={sections.deployment}
          onToggle={() => toggleSection("deployment")}
          onApprove={() => approveSection("deployment")}
          onEdit={() => toggleEditing("deployment")}
        >
          <div className="text-xs text-muted-foreground">
            <span>Target: {blueprint.deployment.target}</span>
            <span className="mx-2">·</span>
            <span>Auto-start: {blueprint.deployment.autoStart ? "Yes" : "No"}</span>
          </div>
        </WizardSectionCard>

        {/* Setup Progress */}
        {setupProgress.length > 0 && (
          <Card className="border-primary/10">
            <CardContent className="py-3 space-y-1">
              {setupProgress.map((p) => (
                <div key={p.step} className="flex items-center gap-2 text-xs">
                  {p.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                  {p.status === "completed" && <Check className="h-3 w-3 text-green-500" />}
                  {p.status === "failed" && <AlertCircle className="h-3 w-3 text-destructive" />}
                  {p.status === "pending" && <span className="h-3 w-3 rounded-full border" />}
                  <span className={p.status === "failed" ? "text-destructive" : ""}>{p.message}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-2">
          {createdAgentId ? (
            <div className="flex items-center gap-2 w-full">
              <Button
                onClick={() => navigate({ to: "/agents/$agentId", params: { agentId: String(createdAgentId) } })}
                className="flex-1"
              >
                <Bot className="h-4 w-4 mr-2" />
                Open Agent Editor
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/agents/$agentId/test", params: { agentId: String(createdAgentId) } })}
              >
                Test Agent
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 w-full">
              <Button
                onClick={handleCreate}
                disabled={isCreating}
                className="flex-1"
                variant={allApproved ? "default" : "secondary"}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {allApproved ? "Create Agent" : "Create Agent (review pending)"}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface WizardSectionCardProps {
  title: string;
  icon: React.ReactNode;
  state: SectionState;
  onToggle: () => void;
  onApprove: () => void;
  onEdit: () => void;
  children: React.ReactNode;
}

function WizardSectionCard({
  title,
  icon,
  state,
  onToggle,
  onApprove,
  onEdit,
  children,
}: WizardSectionCardProps) {
  return (
    <div className="border rounded-md overflow-hidden">
      {/* Section header */}
      <button
        type="button"
        className="flex items-center justify-between w-full px-3 py-2 hover:bg-accent/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          {state.expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          {icon}
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {state.approved && (
            <Badge variant="default" className="text-[10px] bg-green-600 hover:bg-green-700">
              <Check className="h-2.5 w-2.5 mr-0.5" />
              Approved
            </Badge>
          )}
        </div>
      </button>

      {/* Section content */}
      {state.expanded && (
        <div className="px-3 pb-3 border-t">
          <div className="pt-2">{children}</div>
          <div className="flex justify-end gap-1 mt-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>
              <Pencil className="h-3 w-3 mr-1" />
              {state.editing ? "Done" : "Edit"}
            </Button>
            {!state.approved && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onApprove}>
                <Check className="h-3 w-3 mr-1" />
                Approve
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
