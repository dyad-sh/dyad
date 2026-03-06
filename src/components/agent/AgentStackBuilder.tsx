/**
 * AgentStackBuilder Component
 * Comprehensive UI for building an end-to-end agent stack:
 * - Triggers (Gmail, Slack, Google Sheets, Webhook, Schedule, etc.)
 * - Tools from catalog (14+ tools)
 * - n8n workflow connection & sync
 * - Knowledge base drag-and-drop
 * - OpenClaw routing integration
 */

import { useState, useMemo, useCallback } from "react";
import {
  Zap,
  Plus,
  Trash2,
  Play,
  Pause,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Check,
  AlertCircle,
  Loader2,
  Upload,
  Workflow,
  Cable,
  Power,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import {
  useAgentTriggers,
  useCreateTrigger,
  useDeleteTrigger,
  useActivateTrigger,
  usePauseTrigger,
  useToolCatalog,
  useAddToolFromCatalog,
  useN8nStatus,
  useStartN8n,
  useSyncStackToN8n,
  useBuildAgentStack,
  TRIGGER_TEMPLATES,
} from "@/hooks/useAgentStack";

import { TOOL_CATEGORIES, type CatalogTool, type ToolCategory } from "@/types/agent_tool_catalog";
import type { TriggerType, TriggerConfig } from "@/types/agent_triggers";
import { showError, showSuccess } from "@/lib/toast";

// ============================================================================
// Props
// ============================================================================

interface AgentStackBuilderProps {
  agentId: number;
  tools: Array<{
    id: number;
    name: string;
    description: string;
    enabled: boolean;
  }>;
}

// ============================================================================
// Main Component
// ============================================================================

export default function AgentStackBuilder({ agentId, tools }: AgentStackBuilderProps) {
  // --- hooks ---
  const { data: triggers = [], isLoading: triggersLoading } = useAgentTriggers(agentId);
  const { data: n8nStatus } = useN8nStatus();
  const { data: catalog = [] } = useToolCatalog();
  const createTrigger = useCreateTrigger();
  const deleteTrigger = useDeleteTrigger(agentId);
  const activateTrigger = useActivateTrigger(agentId);
  const pauseTrigger = usePauseTrigger(agentId);
  const addToolFromCatalog = useAddToolFromCatalog(agentId);
  const startN8n = useStartN8n();
  const syncToN8n = useSyncStackToN8n(agentId);
  const buildStack = useBuildAgentStack();

  // --- state ---
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
  const [toolCatalogOpen, setToolCatalogOpen] = useState(false);
  const [selectedTriggerType, setSelectedTriggerType] = useState<TriggerType>("gmail");
  const [triggerName, setTriggerName] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | "all">("all");
  const [knowledgeFiles, setKnowledgeFiles] = useState<File[]>([]);

  const n8nRunning = n8nStatus?.running ?? false;

  // --- filtered catalog ---
  const filteredCatalog = useMemo(() => {
    let results = catalog;
    if (selectedCategory !== "all") {
      results = results.filter((t) => t.category === selectedCategory);
    }
    if (toolSearch) {
      const q = toolSearch.toLowerCase();
      results = results.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.includes(q))
      );
    }
    return results;
  }, [catalog, selectedCategory, toolSearch]);

  // --- already-added tool names ---
  const addedToolNames = useMemo(() => new Set(tools.map((t) => t.name)), [tools]);

  // --- handlers ---
  const handleAddTrigger = useCallback(() => {
    const template = TRIGGER_TEMPLATES.find((t) => t.type === selectedTriggerType);
    const name = triggerName || template?.name || selectedTriggerType;

    createTrigger.mutate(
      {
        agentId,
        name,
        type: selectedTriggerType,
        config: buildDefaultTriggerConfig(selectedTriggerType),
      },
      {
        onSuccess: () => {
          showSuccess(`Trigger "${name}" created`);
          setTriggerDialogOpen(false);
          setTriggerName("");
        },
        onError: (err) => showError(`Failed: ${err.message}`),
      }
    );
  }, [agentId, selectedTriggerType, triggerName, createTrigger]);

  const handleAddCatalogTool = useCallback(
    (catalogToolId: string) => {
      addToolFromCatalog.mutate(catalogToolId, {
        onSuccess: () => {
          showSuccess("Tool added to agent");
        },
        onError: (err) => showError(`Failed: ${err.message}`),
      });
    },
    [addToolFromCatalog]
  );

  const handleSyncN8n = useCallback(() => {
    syncToN8n.mutate(undefined, {
      onSuccess: (result) => {
        if (result.success) {
          showSuccess(`Synced to n8n workflow ${result.n8nWorkflowId}`);
        } else {
          showError(result.error || "Failed to sync");
        }
      },
      onError: (err) => showError(`Sync failed: ${err.message}`),
    });
  }, [syncToN8n]);

  const handleKnowledgeDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    setKnowledgeFiles((prev) => [...prev, ...files]);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header with n8n status */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            Agent Stack Builder
          </h2>
          <p className="text-sm text-muted-foreground">
            Build a complete agent with triggers, tools, and n8n workflows
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* n8n Status */}
          <Badge
            variant="outline"
            className={
              n8nRunning
                ? "text-green-500 border-green-500/30"
                : "text-yellow-500 border-yellow-500/30"
            }
          >
            <Power className="h-3 w-3 mr-1" />
            n8n: {n8nRunning ? "Running" : "Stopped"}
          </Badge>
          {!n8nRunning && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                startN8n.mutate(undefined, {
                  onSuccess: (r) => {
                    if (r.success) showSuccess("n8n started");
                    else showError(r.error || "Failed to start n8n");
                  },
                })
              }
              disabled={startN8n.isPending}
            >
              {startN8n.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1" />
              )}
              Start n8n
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={handleSyncN8n}
            disabled={!n8nRunning || syncToN8n.isPending}
          >
            {syncToN8n.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Cable className="h-3.5 w-3.5 mr-1" />
            )}
            Sync to n8n
          </Button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* TRIGGERS SECTION                                                    */}
      {/* ================================================================== */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-yellow-500" />
              Triggers
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Events that start your agent automatically
            </p>
          </div>
          <Button size="sm" onClick={() => setTriggerDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Trigger
          </Button>
        </div>

        {triggersLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading triggers...
          </div>
        ) : triggers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Zap className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium mb-1">No triggers configured</p>
              <p className="text-xs text-muted-foreground mb-3">
                Add triggers like Gmail, Slack, or Google Sheets to auto-start your agent
              </p>
              <Button size="sm" variant="outline" onClick={() => setTriggerDialogOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add First Trigger
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {triggers.map((trigger) => {
              const template = TRIGGER_TEMPLATES.find((t) => t.type === trigger.type);
              return (
                <Card key={trigger.id} className="relative">
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{template?.icon || "⚡"}</span>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm">{trigger.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {template?.description || trigger.type}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            trigger.status === "active"
                              ? "text-green-500 border-green-500/30"
                              : trigger.status === "paused"
                                ? "text-yellow-500 border-yellow-500/30"
                                : trigger.status === "error"
                                  ? "text-red-500 border-red-500/30"
                                  : "text-gray-500 border-gray-500/30"
                          }`}
                        >
                          {trigger.status}
                        </Badge>
                        {trigger.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => pauseTrigger.mutate(trigger.id)}
                          >
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => activateTrigger.mutate(trigger.id)}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteTrigger.mutate(trigger.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {trigger.n8nWorkflowId && (
                    <CardContent className="py-0 pb-3 px-4">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Cable className="h-3 w-3" />
                        <span>n8n: {trigger.n8nWorkflowId}</span>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* TOOLS SECTION (Catalog + Active)                                    */}
      {/* ================================================================== */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              🛠️ Tools
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tools.length} tools active &middot; {catalog.length} available in catalog
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setToolCatalogOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Browse Catalog
          </Button>
        </div>

        {/* Active tools grid */}
        {tools.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <span className="text-4xl mb-3">🧰</span>
              <p className="text-sm font-medium mb-1">No tools added yet</p>
              <p className="text-xs text-muted-foreground mb-3">
                Browse the catalog to add tools like Knowledge Search, LLM, PDF Conversion, and more
              </p>
              <Button size="sm" variant="outline" onClick={() => setToolCatalogOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Browse Tool Catalog
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {tools.map((tool) => {
              const catalogEntry = catalog.find((c) => c.name === tool.name);
              return (
                <Card key={tool.id} className="py-0">
                  <CardHeader className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{catalogEntry?.icon || "🔧"}</span>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-xs font-medium truncate">{tool.name}</CardTitle>
                        <CardDescription className="text-[10px] truncate">
                          {tool.description}
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          tool.enabled ? "text-green-500 border-green-500/30" : "text-gray-400"
                        }`}
                      >
                        {tool.enabled ? "on" : "off"}
                      </Badge>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* KNOWLEDGE BASE (Drag & Drop)                                       */}
      {/* ================================================================== */}
      <section>
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-3">
          📚 Knowledge
        </h3>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleKnowledgeDrop}
          className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors"
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">Drag & drop files here</p>
          <p className="text-xs text-muted-foreground mt-1">
            PDF, DOCX, TXT, CSV, Markdown — files will be indexed for RAG
          </p>
          {knowledgeFiles.length > 0 && (
            <div className="mt-3 space-y-1">
              {knowledgeFiles.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2 text-xs bg-muted/50 rounded px-3 py-1.5"
                >
                  <Check className="h-3 w-3 text-green-500" />
                  <span className="truncate flex-1">{file.name}</span>
                  <span className="text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() =>
                      setKnowledgeFiles((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ================================================================== */}
      {/* n8n WORKFLOW PREVIEW                                               */}
      {/* ================================================================== */}
      <section>
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-3">
          <Workflow className="h-4 w-4" />
          n8n Workflow
        </h3>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              {/* Visual pipeline representation */}
              <div className="flex items-center gap-1 flex-1 overflow-x-auto pb-2">
                {/* Trigger nodes */}
                {triggers.length > 0 ? (
                  triggers.map((t, i) => {
                    const tmpl = TRIGGER_TEMPLATES.find((tp) => tp.type === t.type);
                    return (
                      <div key={t.id} className="flex items-center gap-1">
                        {i > 0 && (
                          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-xs whitespace-nowrap">
                          <span>{tmpl?.icon || "⚡"}</span>
                          <span>{t.name}</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-1 rounded-md bg-muted text-xs text-muted-foreground">
                    No Trigger
                  </div>
                )}

                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />

                {/* AI Agent node */}
                <div className="px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/30 text-xs whitespace-nowrap flex items-center gap-1">
                  🤖 AI Agent
                </div>

                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />

                {/* Tool nodes */}
                {tools.length > 0 ? (
                  <div className="flex items-center gap-1">
                    {tools.slice(0, 4).map((tool) => {
                      const ce = catalog.find((c) => c.name === tool.name);
                      return (
                        <div
                          key={tool.id}
                          className="px-2 py-1 rounded-md bg-green-500/10 border border-green-500/30 text-xs whitespace-nowrap"
                        >
                          {ce?.icon || "🔧"} {tool.name}
                        </div>
                      );
                    })}
                    {tools.length > 4 && (
                      <Badge variant="secondary" className="text-[10px]">
                        +{tools.length - 4}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <div className="px-2 py-1 rounded-md bg-muted text-xs text-muted-foreground">
                    No Tools
                  </div>
                )}

                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />

                {/* Output */}
                <div className="px-2 py-1 rounded-md bg-purple-500/10 border border-purple-500/30 text-xs whitespace-nowrap">
                  📤 Output
                </div>
              </div>
            </div>

            {!n8nRunning && (
              <div className="mt-3 flex items-center gap-2 text-xs text-yellow-600 bg-yellow-500/10 rounded px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5" />
                n8n is not running. Start n8n to activate triggers and sync workflows.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ================================================================== */}
      {/* TRIGGER DIALOG                                                     */}
      {/* ================================================================== */}
      <Dialog open={triggerDialogOpen} onOpenChange={setTriggerDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Trigger</DialogTitle>
            <DialogDescription>
              Choose a trigger type that will auto-start your agent
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div>
              <Label>Trigger Type</Label>
              <Select
                value={selectedTriggerType}
                onValueChange={(v) => setSelectedTriggerType(v as TriggerType)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_TEMPLATES.map((t) => (
                    <SelectItem key={t.type} value={t.type}>
                      <span className="flex items-center gap-2">
                        <span>{t.icon}</span>
                        <span>{t.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name (optional)</Label>
              <Input
                value={triggerName}
                onChange={(e) => setTriggerName(e.target.value)}
                placeholder={
                  TRIGGER_TEMPLATES.find((t) => t.type === selectedTriggerType)?.name || "My Trigger"
                }
                className="mt-1"
              />
            </div>
            {/* Type-specific config preview */}
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                {TRIGGER_TEMPLATES.find((t) => t.type === selectedTriggerType)?.description}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                n8n node:{" "}
                <code className="text-xs">
                  {TRIGGER_TEMPLATES.find((t) => t.type === selectedTriggerType)?.n8nNodeType}
                </code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTriggerDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTrigger} disabled={createTrigger.isPending}>
              {createTrigger.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Add Trigger
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* TOOL CATALOG DIALOG                                                */}
      {/* ================================================================== */}
      <Dialog open={toolCatalogOpen} onOpenChange={setToolCatalogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Tool Catalog</DialogTitle>
            <DialogDescription>
              Browse and add pre-built tools to your agent
            </DialogDescription>
          </DialogHeader>

          {/* Search + filter */}
          <div className="flex gap-2 pb-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                placeholder="Search tools..."
                className="pl-9"
              />
            </div>
            <Select
              value={selectedCategory}
              onValueChange={(v) => setSelectedCategory(v as ToolCategory | "all")}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {TOOL_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.icon} {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tool Grid */}
          <div className="flex-1 overflow-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
              {filteredCatalog.map((tool) => {
                const isAdded = addedToolNames.has(tool.name);
                return (
                  <Card
                    key={tool.id}
                    className={`transition-all ${
                      isAdded ? "opacity-60" : "hover:shadow-md cursor-pointer"
                    }`}
                  >
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{tool.icon}</span>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm flex items-center gap-2">
                            {tool.name}
                            {tool.requiresCredentials && (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-orange-500 border-orange-500/30"
                              >
                                credentials
                              </Badge>
                            )}
                            {tool.requiresApproval && (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-red-500 border-red-500/30"
                              >
                                approval
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="text-xs mt-0.5">
                            {tool.description}
                          </CardDescription>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {tool.tags.slice(0, 4).map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px] py-0">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={isAdded ? "secondary" : "default"}
                          disabled={isAdded || addToolFromCatalog.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddCatalogTool(tool.id);
                          }}
                          className="shrink-0"
                        >
                          {isAdded ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1" />
                              Added
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add
                            </>
                          )}
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
              {filteredCatalog.length === 0 && (
                <div className="col-span-2 text-center py-8 text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm">No tools found for "{toolSearch}"</p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setToolCatalogOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function buildDefaultTriggerConfig(type: TriggerType): TriggerConfig {
  switch (type) {
    case "gmail":
      return {
        type: "gmail",
        pollInterval: 60,
        unreadOnly: true,
      };
    case "slack":
      return {
        type: "slack",
        onMessage: true,
        onMention: true,
        onReaction: false,
      };
    case "google-sheets":
      return {
        type: "google-sheets",
        spreadsheetId: "",
        onRowAdded: true,
        onCellChanged: false,
        pollInterval: 60,
      };
    case "webhook":
      return {
        type: "webhook",
        method: "POST",
        responseMode: "immediate",
      };
    case "schedule":
      return {
        type: "schedule",
        cronExpression: "0 */5 * * *",
        timezone: "UTC",
        scheduleDescription: "Every 5 hours",
      };
    case "calendar":
      return {
        type: "calendar",
        calendarId: "primary",
        minutesBefore: 15,
        onEventCreated: true,
        onEventUpdated: false,
      };
    case "discord":
      return {
        type: "discord",
        onMessage: true,
      };
    case "telegram":
      return {
        type: "telegram",
        onMessage: true,
      };
    case "manual":
    default:
      return { type: "manual" };
  }
}
