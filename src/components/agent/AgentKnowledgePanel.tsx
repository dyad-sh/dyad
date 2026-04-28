/**
 * Agent Knowledge Panel
 * Manage knowledge sources for an agent â€” scraping engine, AI queries, local vault,
 * file uploads, APIs, web search, RSS feeds, and manual entries.
 * Query knowledge across all sources via unified search.
 */

import { useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCcw,
  Search,
  Database,
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  useKnowledgeSources,
  useAddKnowledgeSource,
  useUpdateKnowledgeSource,
  useDeleteKnowledgeSource,
  useSyncKnowledgeSource,
  useQueryKnowledge,
  KNOWLEDGE_SOURCE_TEMPLATES,
} from "@/hooks/useAgentWorkspace";
import type {
  AgentKnowledgeSource,
  KnowledgeSourceType,
  KnowledgeSourceStatus,
  KnowledgeSourceConfig,
  AddKnowledgeSourceRequest,
  ScrapingKnowledgeConfig,
  AIQueryKnowledgeConfig,
  LocalVaultKnowledgeConfig,
  LocalFileKnowledgeConfig,
  ApiEndpointKnowledgeConfig,
  WebSearchKnowledgeConfig,
  DocumentUploadKnowledgeConfig,
  RssFeedKnowledgeConfig,
  ManualKnowledgeConfig,
} from "@/types/agent_workspace";

// =============================================================================
// STATUS HELPERS
// =============================================================================

function statusColor(status: KnowledgeSourceStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "connected":
      return "default";
    case "syncing":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

// =============================================================================
// SOURCE CONFIG FORMS
// =============================================================================

function ScrapingConfigForm({
  config,
  onChange,
}: {
  config: Partial<ScrapingKnowledgeConfig>;
  onChange: (c: Partial<ScrapingKnowledgeConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>URLs to Scrape</Label>
        <Textarea
          placeholder="https://example.com&#10;https://docs.example.com"
          value={(config.urls || []).join("\n")}
          onChange={(e) =>
            onChange({
              ...config,
              urls: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          rows={3}
        />
        <p className="text-xs text-muted-foreground">One URL per line</p>
      </div>
      <div className="space-y-2">
        <Label>Scraping Template</Label>
        <Select
          value={config.templateId || ""}
          onValueChange={(v) => onChange({ ...config, templateId: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Auto-detect" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="article">Article / Blog</SelectItem>
            <SelectItem value="docs">Documentation</SelectItem>
            <SelectItem value="ecommerce">E-commerce</SelectItem>
            <SelectItem value="social-media">Social Media</SelectItem>
            <SelectItem value="reddit">Reddit</SelectItem>
            <SelectItem value="github-repo">GitHub Repo</SelectItem>
            <SelectItem value="legal-document">Legal Document</SelectItem>
            <SelectItem value="financial-report">Financial Report</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Max Pages</Label>
        <Input
          type="number"
          value={config.maxPages || 50}
          onChange={(e) => onChange({ ...config, maxPages: Number(e.target.value) })}
          min={1}
          max={1000}
        />
      </div>
    </div>
  );
}

function AIQueryConfigForm({
  config,
  onChange,
}: {
  config: Partial<AIQueryKnowledgeConfig>;
  onChange: (c: Partial<AIQueryKnowledgeConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Query Prompt</Label>
        <Textarea
          placeholder="What are the key concepts of..."
          value={config.query || ""}
          onChange={(e) =>
            onChange({
              ...config,
              query: e.target.value,
            })
          }
          rows={3}
        />
        <p className="text-xs text-muted-foreground">Enter the knowledge query to send to the AI</p>
      </div>
      <div className="space-y-2">
        <Label>Model</Label>
        <Select
          value={config.model || "default"}
          onValueChange={(v) => onChange({ ...config, model: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default (Local)</SelectItem>
            <SelectItem value="gpt-5.1">GPT 5.1</SelectItem>
            <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4</SelectItem>
            <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash</SelectItem>
            <SelectItem value="llama3.2:8b">Llama 3.2 (Local)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Context Window</Label>
        <Select
          value={config.contextWindow || "standard"}
          onValueChange={(v) => onChange({ ...config, contextWindow: v as "standard" | "large" | "2m" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="large">Large</SelectItem>
            <SelectItem value="2m">2M (CAG)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label>CAG Mode (Cache Augmented Generation)</Label>
          <p className="text-xs text-muted-foreground">Uses 2M context window</p>
        </div>
        <Switch
          checked={config.useCag || false}
          onCheckedChange={(v) => onChange({ ...config, useCag: v })}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label>Prefer Local LLM</Label>
          <p className="text-xs text-muted-foreground">Use local Ollama model</p>
        </div>
        <Switch
          checked={config.preferLocal || false}
          onCheckedChange={(v) => onChange({ ...config, preferLocal: v })}
        />
      </div>
    </div>
  );
}

function LocalVaultConfigForm({
  config,
  onChange,
}: {
  config: Partial<LocalVaultKnowledgeConfig>;
  onChange: (c: Partial<LocalVaultKnowledgeConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Connector IDs</Label>
        <Textarea
          placeholder="connector-id-1&#10;connector-id-2"
          value={(config.connectorIds || []).join("\n")}
          onChange={(e) =>
            onChange({
              ...config,
              connectorIds: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          IDs of Local Vault connectors to use as knowledge sources
        </p>
      </div>
      <div className="space-y-2">
        <Label>Asset Type Filters</Label>
        <Input
          placeholder="pdf, json, csv"
          value={(config.assetTypes || []).join(", ")}
          onChange={(e) =>
            onChange({
              ...config,
              assetTypes: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
    </div>
  );
}

function LocalFileConfigForm({
  config,
  onChange,
}: {
  config: Partial<LocalFileKnowledgeConfig>;
  onChange: (c: Partial<LocalFileKnowledgeConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>File/Folder Paths</Label>
        <Textarea
          placeholder="C:\Documents\my-docs&#10;/home/user/data"
          value={(config.paths || []).join("\n")}
          onChange={(e) =>
            onChange({
              ...config,
              paths: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          rows={3}
        />
      </div>
      <div className="space-y-2">
        <Label>Glob Patterns</Label>
        <Input
          placeholder="**/*.pdf, **/*.md, **/*.docx"
          value={(config.patterns || []).join(", ")}
          onChange={(e) =>
            onChange({
              ...config,
              patterns: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label>Watch for Changes</Label>
          <p className="text-xs text-muted-foreground">Auto-sync when files change</p>
        </div>
        <Switch
          checked={config.watchChanges || false}
          onCheckedChange={(v) => onChange({ ...config, watchChanges: v })}
        />
      </div>
    </div>
  );
}

function ApiEndpointConfigForm({
  config,
  onChange,
}: {
  config: Partial<ApiEndpointKnowledgeConfig>;
  onChange: (c: Partial<ApiEndpointKnowledgeConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>API URL</Label>
        <Input
          placeholder="https://api.example.com/data"
          value={config.url || ""}
          onChange={(e) => onChange({ ...config, url: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Method</Label>
          <Select
            value={config.method || "GET"}
            onValueChange={(v) => onChange({ ...config, method: v as "GET" | "POST" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Poll Interval (ms)</Label>
          <Input
            type="number"
            value={config.pollIntervalMs || 3600000}
            onChange={(e) => onChange({ ...config, pollIntervalMs: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Headers (JSON)</Label>
        <Textarea
          className="font-mono text-xs"
          placeholder='{"Authorization": "Bearer ..."}'
          value={JSON.stringify(config.headers || {}, null, 2)}
          onChange={(e) => {
            try {
              onChange({ ...config, headers: JSON.parse(e.target.value) });
            } catch {
              /* ignore parse errors while typing */
            }
          }}
          rows={2}
        />
      </div>
    </div>
  );
}

function WebSearchConfigForm({
  config,
  onChange,
}: {
  config: Partial<WebSearchKnowledgeConfig>;
  onChange: (c: Partial<WebSearchKnowledgeConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Search Queries</Label>
        <Textarea
          placeholder="latest news about...&#10;how to build..."
          value={(config.queries || []).join("\n")}
          onChange={(e) =>
            onChange({
              ...config,
              queries: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          rows={3}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Engine</Label>
          <Select
            value={config.engine || "google"}
            onValueChange={(v) =>
              onChange({ ...config, engine: v as "google" | "perplexity" | "bing" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="perplexity">Perplexity</SelectItem>
              <SelectItem value="bing">Bing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Max Results</Label>
          <Input
            type="number"
            value={config.maxResults || 10}
            onChange={(e) => onChange({ ...config, maxResults: Number(e.target.value) })}
            min={1}
            max={100}
          />
        </div>
      </div>
    </div>
  );
}

function DocumentUploadConfigForm({
  config,
  onChange,
}: {
  config: Partial<DocumentUploadKnowledgeConfig>;
  onChange: (c: Partial<DocumentUploadKnowledgeConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Processing Mode</Label>
        <Select
          value={config.processingMode || "text"}
          onValueChange={(v) =>
            onChange({ ...config, processingMode: v as "text" | "ocr" | "ai_extract" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text Extraction</SelectItem>
            <SelectItem value="ocr">OCR (Images & Scanned)</SelectItem>
            <SelectItem value="ai_extract">AI Extraction</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Chunk Size</Label>
          <Input
            type="number"
            value={config.chunkSize || 1000}
            onChange={(e) => onChange({ ...config, chunkSize: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>Chunk Overlap</Label>
          <Input
            type="number"
            value={config.chunkOverlap || 200}
            onChange={(e) => onChange({ ...config, chunkOverlap: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}

function RssFeedConfigForm({
  config,
  onChange,
}: {
  config: Partial<RssFeedKnowledgeConfig>;
  onChange: (c: Partial<RssFeedKnowledgeConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Feed URLs</Label>
        <Textarea
          placeholder="https://blog.example.com/feed&#10;https://news.example.com/rss"
          value={(config.feedUrls || []).join("\n")}
          onChange={(e) =>
            onChange({
              ...config,
              feedUrls: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          rows={3}
        />
      </div>
      <div className="space-y-2">
        <Label>Poll Interval (ms)</Label>
        <Input
          type="number"
          value={config.pollIntervalMs || 3600000}
          onChange={(e) => onChange({ ...config, pollIntervalMs: Number(e.target.value) })}
        />
      </div>
      <div className="space-y-2">
        <Label>Max Items per Feed</Label>
        <Input
          type="number"
          value={config.maxItems || 50}
          onChange={(e) => onChange({ ...config, maxItems: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}

function ManualConfigForm({
  config,
  onChange,
}: {
  config: Partial<ManualKnowledgeConfig>;
  onChange: (c: Partial<ManualKnowledgeConfig>) => void;
}) {
  const entries = config.entries || [];
  const firstEntry = entries[0] || { title: "", content: "" };
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Entry Title</Label>
        <Input
          placeholder="My Knowledge Entry"
          value={firstEntry.title}
          onChange={(e) =>
            onChange({
              ...config,
              entries: [{ ...firstEntry, title: e.target.value, content: firstEntry.content }],
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Knowledge Content</Label>
        <Textarea
          placeholder="Enter facts, instructions, or context for this agent..."
          value={firstEntry.content}
          onChange={(e) =>
            onChange({
              ...config,
              entries: [{ ...firstEntry, content: e.target.value }],
            })
          }
          rows={6}
        />
      </div>
    </div>
  );
}

// =============================================================================
// CONFIG FORM ROUTER
// =============================================================================

function KnowledgeConfigForm({
  type,
  config,
  onChange,
}: {
  type: KnowledgeSourceType;
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}) {
  switch (type) {
    case "scraping_engine":
      return <ScrapingConfigForm config={config as Partial<ScrapingKnowledgeConfig>} onChange={onChange} />;
    case "ai_query":
      return <AIQueryConfigForm config={config as Partial<AIQueryKnowledgeConfig>} onChange={onChange} />;
    case "local_vault":
      return <LocalVaultConfigForm config={config as Partial<LocalVaultKnowledgeConfig>} onChange={onChange} />;
    case "local_file":
      return <LocalFileConfigForm config={config as Partial<LocalFileKnowledgeConfig>} onChange={onChange} />;
    case "api_endpoint":
      return <ApiEndpointConfigForm config={config as Partial<ApiEndpointKnowledgeConfig>} onChange={onChange} />;
    case "web_search":
      return <WebSearchConfigForm config={config as Partial<WebSearchKnowledgeConfig>} onChange={onChange} />;
    case "document_upload":
      return <DocumentUploadConfigForm config={config as Partial<DocumentUploadKnowledgeConfig>} onChange={onChange} />;
    case "rss_feed":
      return <RssFeedConfigForm config={config as Partial<RssFeedKnowledgeConfig>} onChange={onChange} />;
    case "manual":
      return <ManualConfigForm config={config as Partial<ManualKnowledgeConfig>} onChange={onChange} />;
    default:
      return <p className="text-sm text-muted-foreground">No configuration needed.</p>;
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

interface AgentKnowledgePanelProps {
  agentId: number;
}

export default function AgentKnowledgePanel({ agentId }: AgentKnowledgePanelProps) {
  const { data: sources, isLoading } = useKnowledgeSources(agentId);
  const addSource = useAddKnowledgeSource(agentId);
  const deleteSource = useDeleteKnowledgeSource(agentId);
  const syncSource = useSyncKnowledgeSource(agentId);
  const queryKnowledge = useQueryKnowledge(agentId);

  const [addOpen, setAddOpen] = useState(false);
  const [queryOpen, setQueryOpen] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<string | null>(null);

  // Add source form state
  const [newType, setNewType] = useState<KnowledgeSourceType>("scraping_engine");
  const [newName, setNewName] = useState("");
  const [newAutoSync, setNewAutoSync] = useState(false);
  const [newConfig, setNewConfig] = useState<Record<string, unknown>>({});

  function resetForm() {
    setNewType("scraping_engine");
    setNewName("");
    setNewAutoSync(false);
    setNewConfig({});
  }

  function handleTypeSelect(type: KnowledgeSourceType) {
    setNewType(type);
    const tmpl = KNOWLEDGE_SOURCE_TEMPLATES.find((t) => t.type === type);
    if (tmpl && !newName) setNewName(tmpl.name);
    setNewConfig({});
  }

  function handleAdd() {
    const request: AddKnowledgeSourceRequest = {
      agentId,
      name: newName || "Untitled Source",
      type: newType,
      config: { type: newType, ...newConfig } as KnowledgeSourceConfig,
      autoSync: newAutoSync,
    };
    addSource.mutate(request, {
      onSuccess: () => {
        setAddOpen(false);
        resetForm();
      },
    });
  }

  function handleQuery() {
    queryKnowledge.mutate(
      { agentId, query: queryText },
      {
        onSuccess: (results) => {
          const answer = results.map((r) => 
            r.results.map((item) => item.content).join("\n")
          ).join("\n\n") || "No results found.";
          setQueryResult(answer);
        },
      },
    );
  }

  const sourceList = sources || [];
  const totalDocs = sourceList.reduce(
    (sum: number, s: AgentKnowledgeSource) => sum + s.totalDocuments,
    0,
  );
  const totalBytes = sourceList.reduce(
    (sum: number, s: AgentKnowledgeSource) => sum + s.totalBytes,
    0,
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Knowledge Sources</h2>
          <p className="text-sm text-muted-foreground">
            Connect data sources to give this agent contextual knowledge.{" "}
            {sourceList.length > 0 && (
              <span>
                {sourceList.length} sources Â· {totalDocs} documents Â· {formatBytes(totalBytes)}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setQueryOpen(true)}>
            <Search className="h-4 w-4 mr-2" />
            Query Knowledge
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Source
          </Button>
        </div>
      </div>

      {/* Source List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sourceList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Database className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">No knowledge sources</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add web scrapers, AI queries, local files, or APIs to build this agent's knowledge
              base.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {KNOWLEDGE_SOURCE_TEMPLATES.slice(0, 4).map((tmpl) => (
                <Button
                  key={tmpl.type}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    handleTypeSelect(tmpl.type);
                    setAddOpen(true);
                  }}
                >
                  <span className="mr-1">{tmpl.icon}</span>
                  {tmpl.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sourceList.map((source: AgentKnowledgeSource) => {
            const tmpl = KNOWLEDGE_SOURCE_TEMPLATES.find((t) => t.type === source.type);
            return (
              <Card key={source.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{tmpl?.icon || "ðŸ“¦"}</span>
                      <div>
                        <CardTitle className="text-sm">{source.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {tmpl?.description || source.type}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant={statusColor(source.status)} className="text-xs">
                      {source.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                    <span>{source.totalDocuments} docs</span>
                    <span>{formatBytes(source.totalBytes)}</span>
                    {source.autoSync && (
                      <Badge variant="outline" className="text-xs">
                        auto-sync
                      </Badge>
                    )}
                  </div>
                  {source.lastSyncAt && (
                    <p className="text-xs text-muted-foreground mb-3">
                      Last synced: {new Date(source.lastSyncAt).toLocaleString()}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => syncSource.mutate(source.id)}
                      disabled={syncSource.isPending || source.status === "syncing"}
                    >
                      {source.status === "syncing" ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-3 w-3 mr-1" />
                      )}
                      Sync
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteSource.mutate(source.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ================================================================= */}
      {/* ADD SOURCE DIALOG                                                  */}
      {/* ================================================================= */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Knowledge Source</DialogTitle>
            <DialogDescription>
              Connect a data source for this agent to learn from.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Source Type Grid */}
            <div className="space-y-2">
              <Label>Source Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {KNOWLEDGE_SOURCE_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.type}
                    onClick={() => handleTypeSelect(tmpl.type)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors ${
                      newType === tmpl.type
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <span className="text-lg">{tmpl.icon}</span>
                    <span className="font-medium text-center leading-tight">{tmpl.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="Source name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>

            {/* Type-specific config */}
            <KnowledgeConfigForm type={newType} config={newConfig} onChange={setNewConfig} />

            {/* Auto sync */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto Sync</Label>
                <p className="text-xs text-muted-foreground">Periodically refresh this source</p>
              </div>
              <Switch checked={newAutoSync} onCheckedChange={setNewAutoSync} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={addSource.isPending}>
              {addSource.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* QUERY KNOWLEDGE DIALOG                                             */}
      {/* ================================================================= */}
      <Dialog open={queryOpen} onOpenChange={setQueryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Query Agent Knowledge</DialogTitle>
            <DialogDescription>
              Search across all {sourceList.length} connected knowledge sources.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Ask a question..."
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleQuery()}
                className="flex-1"
              />
              <Button onClick={handleQuery} disabled={queryKnowledge.isPending || !queryText}>
                {queryKnowledge.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
              </Button>
            </div>

            {queryResult && (
              <Card>
                <CardContent className="pt-4">
                  <pre className="whitespace-pre-wrap text-sm">{queryResult}</pre>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
