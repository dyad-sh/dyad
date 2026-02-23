/**
 * KnowledgeBasePage — RAG Knowledge Base Management
 *
 * Full-featured UI for:
 * - Creating / managing vector collections
 * - Ingesting documents (text, files, URLs)
 * - Searching & testing RAG queries
 * - Configuring embedding models
 * - Viewing collection stats
 */

import { useState } from "react";
import {
  Database,
  Plus,
  Upload,
  Search,
  Trash2,
  FileText,
  Globe,
  Settings2,
  BarChart3,
  Brain,
  Zap,
  ChevronRight,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  HardDrive,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import {
  useVectorCollections,
  useCreateVectorCollection,
  useDeleteVectorCollection,
  useVectorDocuments,
  useDeleteVectorDocument,
  useVectorStats,
  useVectorSearch,
} from "@/hooks/useVectorStore";
import {
  useEmbeddingInit,
  useEmbeddingStatus,
  useEmbeddingDetectModels,
  useEmbeddingSetModel,
  useIngestDocument,
  useIngestFile,
  useIngestUrl,
  useIngestBatch,
  useEmbeddingRetrieve,
} from "@/hooks/useEmbeddingPipeline";

// =============================================================================
// PAGE
// =============================================================================

export default function KnowledgeBasePage() {
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | null
  >(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("collections");

  const { data: collections, isLoading: loadingCollections } =
    useVectorCollections();
  const { data: status } = useEmbeddingStatus();
  const initPipeline = useEmbeddingInit();

  const selectedCollection = collections?.find(
    (c) => c.id === selectedCollectionId,
  );

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 p-2">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Knowledge Base</h1>
            <p className="text-sm text-muted-foreground">
              Local RAG — ingest documents, embed with Ollama, search with
              sqlite-vec
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <PipelineStatusBadge status={status} />
          {!status?.initialized && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => initPipeline.mutate()}
              disabled={initPipeline.isPending}
            >
              {initPipeline.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Zap className="mr-1 h-3 w-3" />
              )}
              Initialize
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — Collections List */}
        <div className="w-72 border-r flex flex-col">
          <div className="flex items-center justify-between p-3 border-b">
            <span className="text-sm font-medium">Collections</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            {loadingCollections ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : collections && collections.length > 0 ? (
              <div className="p-2 space-y-1">
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    className={cn(
                      "w-full text-left rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent",
                      selectedCollectionId === collection.id &&
                        "bg-accent text-accent-foreground",
                    )}
                    onClick={() => setSelectedCollectionId(collection.id)}
                  >
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">
                        {collection.name}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{collection.documentCount} docs</span>
                      <span>·</span>
                      <span>{collection.chunkCount} chunks</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <Database className="h-8 w-8 opacity-40" />
                <p>No collections yet</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowCreateDialog(true)}
                >
                  <Plus className="mr-1 h-3 w-3" /> Create Collection
                </Button>
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden">
          {selectedCollection ? (
            <CollectionDetail
              collection={selectedCollection}
              onDelete={() => setSelectedCollectionId(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-muted-foreground space-y-3">
                <BookOpen className="h-12 w-12 mx-auto opacity-30" />
                <p className="text-sm">
                  Select a collection or create a new one
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Collection Dialog */}
      <CreateCollectionDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={(id) => {
          setSelectedCollectionId(id);
          setShowCreateDialog(false);
        }}
      />
    </div>
  );
}

// =============================================================================
// COLLECTION DETAIL
// =============================================================================

function CollectionDetail({
  collection,
  onDelete,
}: {
  collection: any;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState("documents");
  const deleteCollection = useDeleteVectorCollection();

  return (
    <div className="flex h-full flex-col">
      {/* Collection Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h2 className="font-semibold">{collection.name}</h2>
          {collection.description && (
            <p className="text-sm text-muted-foreground">
              {collection.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {collection.backend ?? "sqlite-vec"}
          </Badge>
          <Badge variant="secondary">
            dim={collection.dimension}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm("Delete this collection and all its documents?")) {
                deleteCollection.mutate(collection.id, {
                  onSuccess: onDelete,
                });
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col">
        <TabsList className="mx-6 mt-3 w-fit">
          <TabsTrigger value="documents">
            <FileText className="mr-1 h-3 w-3" /> Documents
          </TabsTrigger>
          <TabsTrigger value="ingest">
            <Upload className="mr-1 h-3 w-3" /> Ingest
          </TabsTrigger>
          <TabsTrigger value="search">
            <Search className="mr-1 h-3 w-3" /> Search
          </TabsTrigger>
          <TabsTrigger value="stats">
            <BarChart3 className="mr-1 h-3 w-3" /> Stats
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 className="mr-1 h-3 w-3" /> Settings
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="documents" className="h-full mt-0 p-6">
            <DocumentsList collectionId={collection.id} />
          </TabsContent>
          <TabsContent value="ingest" className="h-full mt-0 p-6">
            <IngestPanel collectionId={collection.id} />
          </TabsContent>
          <TabsContent value="search" className="h-full mt-0 p-6">
            <SearchPanel collectionId={collection.id} />
          </TabsContent>
          <TabsContent value="stats" className="h-full mt-0 p-6">
            <StatsPanel collectionId={collection.id} />
          </TabsContent>
          <TabsContent value="settings" className="h-full mt-0 p-6">
            <SettingsPanel />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// =============================================================================
// DOCUMENTS LIST
// =============================================================================

function DocumentsList({ collectionId }: { collectionId: string }) {
  const { data: documents, isLoading } = useVectorDocuments(collectionId);
  const deleteDoc = useDeleteVectorDocument();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!documents || documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
        <FileText className="h-8 w-8 opacity-40" />
        <p>No documents in this collection</p>
        <p className="text-xs">Use the Ingest tab to add documents</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2">
        {documents.map((doc) => (
          <Card key={doc.id} className="group">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium truncate">
                    {doc.title || doc.id}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  {doc.chunkCount != null && (
                    <span>{doc.chunkCount} chunks</span>
                  )}
                  {doc.source && (
                    <span className="truncate max-w-[300px]">
                      {typeof doc.source === "string" ? doc.source : doc.source.path ?? doc.source.url}
                    </span>
                  )}
                  <span>
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {doc.content?.slice(0, 200)}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 text-destructive"
                onClick={() =>
                  deleteDoc.mutate({
                    collectionId,
                    documentId: doc.id,
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

// =============================================================================
// INGEST PANEL
// =============================================================================

function IngestPanel({ collectionId }: { collectionId: string }) {
  const [ingestMode, setIngestMode] = useState<"text" | "file" | "url">(
    "text",
  );
  const [textContent, setTextContent] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [filePath, setFilePath] = useState("");
  const [url, setUrl] = useState("");
  const [chunkStrategy, setChunkStrategy] = useState("paragraph");
  const [chunkSize, setChunkSize] = useState("512");
  const [chunkOverlap, setChunkOverlap] = useState("50");

  const ingestDocument = useIngestDocument();
  const ingestFile = useIngestFile();
  const ingestUrl = useIngestUrl();

  const chunkingConfig = {
    strategy: chunkStrategy as any,
    chunkSize: parseInt(chunkSize, 10),
    chunkOverlap: parseInt(chunkOverlap, 10),
  };

  const handleIngest = () => {
    switch (ingestMode) {
      case "text":
        if (!textContent.trim()) return;
        ingestDocument.mutate(
          {
            collectionId,
            content: textContent,
            title: textTitle || undefined,
            chunkingConfig,
          },
          {
            onSuccess: () => {
              setTextContent("");
              setTextTitle("");
            },
          },
        );
        break;
      case "file":
        if (!filePath.trim()) return;
        ingestFile.mutate({ collectionId, filePath, chunkingConfig });
        break;
      case "url":
        if (!url.trim()) return;
        ingestUrl.mutate(
          { collectionId, url, chunkingConfig },
          { onSuccess: () => setUrl("") },
        );
        break;
    }
  };

  const isPending =
    ingestDocument.isPending ||
    ingestFile.isPending ||
    ingestUrl.isPending;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 max-w-2xl">
        {/* Mode Selector */}
        <div className="flex gap-2">
          {(
            [
              { mode: "text", icon: FileText, label: "Text" },
              { mode: "file", icon: HardDrive, label: "File" },
              { mode: "url", icon: Globe, label: "URL" },
            ] as const
          ).map(({ mode, icon: Icon, label }) => (
            <Button
              key={mode}
              variant={ingestMode === mode ? "default" : "outline"}
              size="sm"
              onClick={() => setIngestMode(mode)}
            >
              <Icon className="mr-1 h-3 w-3" /> {label}
            </Button>
          ))}
        </div>

        {/* Input Area */}
        {ingestMode === "text" && (
          <div className="space-y-3">
            <div>
              <Label>Title (optional)</Label>
              <Input
                placeholder="Document title"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
              />
            </div>
            <div>
              <Label>Content</Label>
              <Textarea
                placeholder="Paste or type your document content here..."
                className="min-h-[200px] font-mono text-sm"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
              />
            </div>
          </div>
        )}

        {ingestMode === "file" && (
          <div className="space-y-3">
            <div>
              <Label>File Path</Label>
              <Input
                placeholder="C:\path\to\document.txt"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Supported: .txt, .md, .json, .csv, .js, .ts, .py, .html,
                .css, and more
              </p>
            </div>
          </div>
        )}

        {ingestMode === "url" && (
          <div className="space-y-3">
            <div>
              <Label>URL</Label>
              <Input
                placeholder="https://example.com/article"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                HTML will be automatically cleaned and converted to text
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* Chunking Config */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Chunking Settings</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Strategy</Label>
              <Select value={chunkStrategy} onValueChange={setChunkStrategy}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paragraph">Paragraph</SelectItem>
                  <SelectItem value="sentence">Sentence</SelectItem>
                  <SelectItem value="fixed">Fixed Size</SelectItem>
                  <SelectItem value="code">Code</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="semantic">Semantic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Chunk Size</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={chunkSize}
                onChange={(e) => setChunkSize(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Overlap</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Ingest Button */}
        <Button onClick={handleIngest} disabled={isPending} className="w-full">
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Ingest Document
        </Button>

        {/* Last Result */}
        {(ingestDocument.data || ingestFile.data || ingestUrl.data) && (
          <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
            <CardContent className="flex items-center gap-3 p-4 text-sm">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">
                  Document ingested successfully
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">
                  {(
                    ingestDocument.data ??
                    ingestFile.data ??
                    ingestUrl.data
                  )?.chunkCount}{" "}
                  chunks •{" "}
                  {(
                    ingestDocument.data ??
                    ingestFile.data ??
                    ingestUrl.data
                  )?.durationMs}
                  ms
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}

// =============================================================================
// SEARCH PANEL
// =============================================================================

function SearchPanel({ collectionId }: { collectionId: string }) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState("5");
  const searchMutation = useEmbeddingRetrieve();

  const handleSearch = () => {
    if (!query.trim()) return;
    searchMutation.mutate({
      collectionIds: [collectionId],
      query,
      topK: parseInt(topK, 10),
      minScore: 0.1,
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 max-w-2xl">
        <div className="flex gap-2">
          <Input
            placeholder="Search your knowledge base..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1"
          />
          <Input
            type="number"
            className="w-16"
            value={topK}
            onChange={(e) => setTopK(e.target.value)}
            min={1}
            max={50}
          />
          <Button
            onClick={handleSearch}
            disabled={searchMutation.isPending || !query.trim()}
          >
            {searchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {searchMutation.data && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {searchMutation.data.totalChunks} results in{" "}
                {searchMutation.data.queryDurationMs}ms
              </span>
            </div>

            {searchMutation.data.chunks.map((chunk, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        Score: {chunk.score.toFixed(3)}
                      </Badge>
                      {chunk.source && (
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {chunk.source}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      #{i + 1}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">
                    {chunk.content}
                  </p>
                </CardContent>
              </Card>
            ))}

            {searchMutation.data.chunks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No results found. Try adjusting your query.
              </p>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// =============================================================================
// STATS PANEL
// =============================================================================

function StatsPanel({ collectionId }: { collectionId: string }) {
  const { data: stats, isLoading } = useVectorStats(collectionId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No stats available
      </p>
    );
  }

  const statItems = [
    {
      label: "Documents",
      value: stats.documentCount,
      icon: FileText,
    },
    { label: "Chunks", value: stats.chunkCount, icon: Database },
    { label: "Vectors", value: stats.vectorCount, icon: Brain },
    {
      label: "Dimension",
      value: stats.dimension,
      icon: BarChart3,
    },
    {
      label: "Index Type",
      value: stats.indexType,
      icon: HardDrive,
    },
    {
      label: "Total Size",
      value: formatBytes(stats.totalSize),
      icon: HardDrive,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl">
      {statItems.map((item) => (
        <Card key={item.label}>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-muted p-2">
              <item.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-lg font-semibold">{item.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// SETTINGS PANEL
// =============================================================================

function SettingsPanel() {
  const { data: models, isLoading } = useEmbeddingDetectModels();
  const { data: status } = useEmbeddingStatus();
  const setModel = useEmbeddingSetModel();

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 max-w-2xl">
        {/* Embedding Model */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Embedding Model</CardTitle>
            <CardDescription>
              Select the model used for generating vector embeddings. Requires
              Ollama running locally.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {status?.embeddingModel && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">
                  Active: <strong>{status.embeddingModel.name}</strong> (
                  {status.embeddingModel.dimension}d)
                </span>
              </div>
            )}

            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <div className="space-y-2">
                {models?.map((model) => (
                  <div
                    key={model.id}
                    className={cn(
                      "flex items-center justify-between rounded-lg border p-3",
                      model.available
                        ? "border-border"
                        : "border-dashed border-muted-foreground/30 opacity-60",
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium">{model.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {model.dimension}d • max {model.maxTokens} tokens •{" "}
                        {model.provider}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {model.available ? (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                        >
                          Available
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Not pulled
                        </Badge>
                      )}
                      {model.available && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setModel.mutate(model.id)}
                          disabled={
                            setModel.isPending ||
                            status?.embeddingModel?.id === model.id
                          }
                        >
                          {status?.embeddingModel?.id === model.id
                            ? "Active"
                            : "Use"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Pull models via:{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                ollama pull nomic-embed-text
              </code>
            </p>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

// =============================================================================
// CREATE COLLECTION DIALOG
// =============================================================================

function CreateCollectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dimension, setDimension] = useState("768");
  const [metric, setMetric] = useState("cosine");
  const createCollection = useCreateVectorCollection();

  const handleCreate = () => {
    if (!name.trim()) return;
    createCollection.mutate(
      {
        name,
        description: description || undefined,
        dimension: parseInt(dimension, 10),
        distanceMetric: metric as any,
      },
      {
        onSuccess: (collection) => {
          onCreated(collection.id);
          setName("");
          setDescription("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Collection</DialogTitle>
          <DialogDescription>
            A collection stores documents with their vector embeddings for
            similarity search.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              placeholder="My Knowledge Base"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input
              placeholder="What is this collection for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Embedding Dimension</Label>
              <Select value={dimension} onValueChange={setDimension}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="384">384 (all-minilm)</SelectItem>
                  <SelectItem value="768">
                    768 (nomic-embed-text)
                  </SelectItem>
                  <SelectItem value="1024">
                    1024 (mxbai-embed-large)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Distance Metric</Label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cosine">Cosine</SelectItem>
                  <SelectItem value="euclidean">Euclidean</SelectItem>
                  <SelectItem value="dot">Dot Product</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || createCollection.isPending}
          >
            {createCollection.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3 w-3" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function PipelineStatusBadge({
  status,
}: {
  status:
    | {
        initialized: boolean;
        ollamaAvailable: boolean;
        embeddingModel?: { name: string } | null;
        activeIngestions: number;
      }
    | undefined;
}) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-xs">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Loading...
      </Badge>
    );
  }

  if (!status.initialized) {
    return (
      <Badge variant="outline" className="text-xs text-yellow-600">
        <AlertCircle className="mr-1 h-3 w-3" />
        Not initialized
      </Badge>
    );
  }

  if (status.activeIngestions > 0) {
    return (
      <Badge variant="secondary" className="text-xs">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Ingesting ({status.activeIngestions})
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-xs",
        status.ollamaAvailable
          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
      )}
    >
      <CheckCircle2 className="mr-1 h-3 w-3" />
      {status.ollamaAvailable
        ? status.embeddingModel?.name ?? "Ready"
        : "Fallback mode"}
    </Badge>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
