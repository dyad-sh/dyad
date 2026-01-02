/**
 * Asset Studio Page
 * Unified asset creation, management, and marketplace publishing
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AssetStudioClient } from "@/ipc/asset_studio_client";
import { MarketplaceClient } from "@/ipc/marketplace_client";
import type { Asset, AssetType, ASSET_CATEGORIES } from "@/types/asset_types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Package,
  Plus,
  Download,
  Upload,
  Trash2,
  MoreVertical,
  FolderOpen,
  Eye,
  Rocket,
  Search,
  Database,
  Brain,
  Code,
  FileJson,
  Bot,
  Layout,
  FileCode,
  GitBranch,
  MessageSquare,
  Globe,
  Puzzle,
  GraduationCap,
  Boxes,
  Star,
  TrendingUp,
  Layers,
  Sparkles,
  ChevronRight,
  Filter,
  Grid3X3,
  List,
} from "lucide-react";

// Asset type icons mapping
const assetTypeIcons: Record<AssetType, React.ReactNode> = {
  "dataset": <Database className="w-5 h-5" />,
  "model": <Brain className="w-5 h-5" />,
  "algorithm": <Code className="w-5 h-5" />,
  "schema": <FileJson className="w-5 h-5" />,
  "agent": <Bot className="w-5 h-5" />,
  "ui-component": <Layout className="w-5 h-5" />,
  "template": <FileCode className="w-5 h-5" />,
  "workflow": <GitBranch className="w-5 h-5" />,
  "prompt": <MessageSquare className="w-5 h-5" />,
  "api": <Globe className="w-5 h-5" />,
  "plugin": <Puzzle className="w-5 h-5" />,
  "training-data": <GraduationCap className="w-5 h-5" />,
  "embedding": <Boxes className="w-5 h-5" />,
};

// Asset type colors
const assetTypeColors: Record<AssetType, string> = {
  "dataset": "from-emerald-500 to-teal-500",
  "model": "from-violet-500 to-purple-500",
  "algorithm": "from-blue-500 to-indigo-500",
  "schema": "from-amber-500 to-yellow-500",
  "agent": "from-pink-500 to-rose-500",
  "ui-component": "from-cyan-500 to-sky-500",
  "template": "from-orange-500 to-red-500",
  "workflow": "from-indigo-500 to-blue-500",
  "prompt": "from-rose-500 to-pink-500",
  "api": "from-teal-500 to-cyan-500",
  "plugin": "from-purple-500 to-violet-500",
  "training-data": "from-lime-500 to-green-500",
  "embedding": "from-sky-500 to-blue-500",
};

// Asset type labels
const assetTypeLabels: Record<AssetType, string> = {
  "dataset": "Dataset",
  "model": "Model",
  "algorithm": "Algorithm",
  "schema": "Schema",
  "agent": "Agent",
  "ui-component": "UI Component",
  "template": "Template",
  "workflow": "Workflow",
  "prompt": "Prompt",
  "api": "API",
  "plugin": "Plugin",
  "training-data": "Training Data",
  "embedding": "Embedding",
};

export default function AssetStudioPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<AssetType | "all">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<AssetType>("algorithm");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");

  // Form states for different asset types
  const [algorithmForm, setAlgorithmForm] = useState({
    name: "",
    description: "",
    language: "python" as const,
    algorithmType: "data-processing" as const,
    code: "",
  });

  const [schemaForm, setSchemaForm] = useState({
    name: "",
    description: "",
    schemaType: "json-schema" as const,
    content: "",
  });

  const [promptForm, setPromptForm] = useState({
    name: "",
    description: "",
    promptType: "system" as const,
    content: "",
  });

  const [uiComponentForm, setUIComponentForm] = useState({
    name: "",
    description: "",
    componentType: "widget" as const,
    framework: "react" as const,
    styling: "tailwind" as const,
    code: "",
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ["asset-stats"],
    queryFn: () => AssetStudioClient.getStats(),
    refetchInterval: 30000,
  });

  // Fetch all assets
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets", filterType],
    queryFn: () =>
      filterType === "all"
        ? AssetStudioClient.listAll()
        : AssetStudioClient.listByType(filterType),
  });

  // Create algorithm mutation
  const createAlgorithmMutation = useMutation({
    mutationFn: () =>
      AssetStudioClient.createAlgorithm({
        ...algorithmForm,
        inputs: [],
        outputs: [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
      toast.success("Algorithm created successfully");
      setIsCreateOpen(false);
      setAlgorithmForm({ name: "", description: "", language: "python", algorithmType: "data-processing", code: "" });
    },
    onError: (error) => toast.error(`Failed to create algorithm: ${error.message}`),
  });

  // Create schema mutation
  const createSchemaMutation = useMutation({
    mutationFn: () => AssetStudioClient.createSchema(schemaForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
      toast.success("Schema created successfully");
      setIsCreateOpen(false);
      setSchemaForm({ name: "", description: "", schemaType: "json-schema", content: "" });
    },
    onError: (error) => toast.error(`Failed to create schema: ${error.message}`),
  });

  // Create prompt mutation
  const createPromptMutation = useMutation({
    mutationFn: () =>
      AssetStudioClient.createPrompt({
        ...promptForm,
        variables: [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
      toast.success("Prompt created successfully");
      setIsCreateOpen(false);
      setPromptForm({ name: "", description: "", promptType: "system", content: "" });
    },
    onError: (error) => toast.error(`Failed to create prompt: ${error.message}`),
  });

  // Create UI component mutation
  const createUIComponentMutation = useMutation({
    mutationFn: () =>
      AssetStudioClient.createUIComponent({
        ...uiComponentForm,
        props: [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
      toast.success("UI Component created successfully");
      setIsCreateOpen(false);
      setUIComponentForm({ name: "", description: "", componentType: "widget", framework: "react", styling: "tailwind", code: "" });
    },
    onError: (error) => toast.error(`Failed to create component: ${error.message}`),
  });

  // Delete asset mutation
  const deleteAssetMutation = useMutation({
    mutationFn: ({ type, id }: { type: AssetType; id: string }) =>
      AssetStudioClient.delete(type, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
      toast.success("Asset deleted");
    },
  });

  // Export asset mutation
  const exportAssetMutation = useMutation({
    mutationFn: ({ type, id }: { type: AssetType; id: string }) =>
      AssetStudioClient.export(type, id),
    onSuccess: (path) => {
      toast.success(`Exported to ${path}`);
    },
  });

  // Preview asset
  const handlePreview = async (asset: Asset) => {
    setPreviewAsset(asset);
    try {
      const content = await AssetStudioClient.readFile(asset.type, asset.id);
      setPreviewContent(content);
      setIsPreviewOpen(true);
    } catch (error) {
      toast.error("Failed to load preview");
    }
  };

  // Filter assets by search
  const filteredAssets = assets.filter(
    (asset) =>
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  // Handle create based on type
  const handleCreate = () => {
    switch (createType) {
      case "algorithm":
        createAlgorithmMutation.mutate();
        break;
      case "schema":
        createSchemaMutation.mutate();
        break;
      case "prompt":
        createPromptMutation.mutate();
        break;
      case "ui-component":
        createUIComponentMutation.mutate();
        break;
      default:
        toast.error("Asset type not yet supported");
    }
  };

  // Render create form based on type
  const renderCreateForm = () => {
    switch (createType) {
      case "algorithm":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="my-algorithm"
                  value={algorithmForm.name}
                  onChange={(e) => setAlgorithmForm({ ...algorithmForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select
                  value={algorithmForm.language}
                  onValueChange={(v) => setAlgorithmForm({ ...algorithmForm, language: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="python">Python</SelectItem>
                    <SelectItem value="javascript">JavaScript</SelectItem>
                    <SelectItem value="typescript">TypeScript</SelectItem>
                    <SelectItem value="rust">Rust</SelectItem>
                    <SelectItem value="go">Go</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={algorithmForm.algorithmType}
                onValueChange={(v) => setAlgorithmForm({ ...algorithmForm, algorithmType: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="data-processing">Data Processing</SelectItem>
                  <SelectItem value="ml-training">ML Training</SelectItem>
                  <SelectItem value="inference">Inference</SelectItem>
                  <SelectItem value="optimization">Optimization</SelectItem>
                  <SelectItem value="analytics">Analytics</SelectItem>
                  <SelectItem value="automation">Automation</SelectItem>
                  <SelectItem value="utility">Utility</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="What does this algorithm do?"
                value={algorithmForm.description}
                onChange={(e) => setAlgorithmForm({ ...algorithmForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Textarea
                placeholder="# Your algorithm code here..."
                className="font-mono text-sm min-h-[200px]"
                value={algorithmForm.code}
                onChange={(e) => setAlgorithmForm({ ...algorithmForm, code: e.target.value })}
              />
            </div>
          </div>
        );

      case "schema":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="my-schema"
                  value={schemaForm.name}
                  onChange={(e) => setSchemaForm({ ...schemaForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={schemaForm.schemaType}
                  onValueChange={(v) => setSchemaForm({ ...schemaForm, schemaType: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json-schema">JSON Schema</SelectItem>
                    <SelectItem value="openapi">OpenAPI</SelectItem>
                    <SelectItem value="graphql">GraphQL</SelectItem>
                    <SelectItem value="protobuf">Protobuf</SelectItem>
                    <SelectItem value="sql">SQL</SelectItem>
                    <SelectItem value="drizzle">Drizzle</SelectItem>
                    <SelectItem value="prisma">Prisma</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="What does this schema define?"
                value={schemaForm.description}
                onChange={(e) => setSchemaForm({ ...schemaForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Schema Content</Label>
              <Textarea
                placeholder="// Your schema definition..."
                className="font-mono text-sm min-h-[200px]"
                value={schemaForm.content}
                onChange={(e) => setSchemaForm({ ...schemaForm, content: e.target.value })}
              />
            </div>
          </div>
        );

      case "prompt":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="my-prompt"
                  value={promptForm.name}
                  onChange={(e) => setPromptForm({ ...promptForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={promptForm.promptType}
                  onValueChange={(v) => setPromptForm({ ...promptForm, promptType: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System Prompt</SelectItem>
                    <SelectItem value="user">User Prompt</SelectItem>
                    <SelectItem value="chain">Prompt Chain</SelectItem>
                    <SelectItem value="few-shot">Few-Shot</SelectItem>
                    <SelectItem value="cot">Chain of Thought</SelectItem>
                    <SelectItem value="rag">RAG Prompt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="What is this prompt for?"
                value={promptForm.description}
                onChange={(e) => setPromptForm({ ...promptForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Prompt Content</Label>
              <Textarea
                placeholder="You are a helpful assistant..."
                className="min-h-[200px]"
                value={promptForm.content}
                onChange={(e) => setPromptForm({ ...promptForm, content: e.target.value })}
              />
            </div>
          </div>
        );

      case "ui-component":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="MyComponent"
                  value={uiComponentForm.name}
                  onChange={(e) => setUIComponentForm({ ...uiComponentForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={uiComponentForm.componentType}
                  onValueChange={(v) => setUIComponentForm({ ...uiComponentForm, componentType: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="widget">Widget</SelectItem>
                    <SelectItem value="page">Page</SelectItem>
                    <SelectItem value="layout">Layout</SelectItem>
                    <SelectItem value="form">Form</SelectItem>
                    <SelectItem value="chart">Chart</SelectItem>
                    <SelectItem value="table">Table</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="modal">Modal</SelectItem>
                    <SelectItem value="navigation">Navigation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Framework</Label>
                <Select
                  value={uiComponentForm.framework}
                  onValueChange={(v) => setUIComponentForm({ ...uiComponentForm, framework: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="react">React</SelectItem>
                    <SelectItem value="vue">Vue</SelectItem>
                    <SelectItem value="svelte">Svelte</SelectItem>
                    <SelectItem value="html">HTML</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Styling</Label>
                <Select
                  value={uiComponentForm.styling}
                  onValueChange={(v) => setUIComponentForm({ ...uiComponentForm, styling: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tailwind">Tailwind CSS</SelectItem>
                    <SelectItem value="css">CSS</SelectItem>
                    <SelectItem value="styled-components">Styled Components</SelectItem>
                    <SelectItem value="css-modules">CSS Modules</SelectItem>
                    <SelectItem value="shadcn">shadcn/ui</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="What does this component do?"
                value={uiComponentForm.description}
                onChange={(e) => setUIComponentForm({ ...uiComponentForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Component Code</Label>
              <Textarea
                placeholder="export function MyComponent() { ... }"
                className="font-mono text-sm min-h-[200px]"
                value={uiComponentForm.code}
                onChange={(e) => setUIComponentForm({ ...uiComponentForm, code: e.target.value })}
              />
            </div>
          </div>
        );

      default:
        return (
          <div className="text-center py-8 text-muted-foreground">
            <p>Creation form for {assetTypeLabels[createType]} coming soon!</p>
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-background via-background to-violet-950/5">
      {/* Header */}
      <div className="flex-none border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg">
                <Package className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
                  Asset Studio
                </h1>
                <p className="text-sm text-muted-foreground">
                  Create, manage & monetize AI assets • Local-first
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Stats badges */}
              {stats && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <Layers className="w-3 h-3" />
                    {stats.total} assets
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Star className="w-3 h-3" />
                    {stats.published} published
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Database className="w-3 h-3" />
                    {formatSize(stats.totalSize)}
                  </Badge>
                </div>
              )}
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white shadow-lg">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Asset
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Create New Asset</DialogTitle>
                    <DialogDescription>
                      Build assets locally and publish to JoyMarketplace
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Asset Type</Label>
                      <Select
                        value={createType}
                        onValueChange={(v) => setCreateType(v as AssetType)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="algorithm">
                            <div className="flex items-center gap-2">
                              <Code className="w-4 h-4 text-blue-500" />
                              Algorithm
                            </div>
                          </SelectItem>
                          <SelectItem value="schema">
                            <div className="flex items-center gap-2">
                              <FileJson className="w-4 h-4 text-amber-500" />
                              Schema
                            </div>
                          </SelectItem>
                          <SelectItem value="prompt">
                            <div className="flex items-center gap-2">
                              <MessageSquare className="w-4 h-4 text-rose-500" />
                              Prompt
                            </div>
                          </SelectItem>
                          <SelectItem value="ui-component">
                            <div className="flex items-center gap-2">
                              <Layout className="w-4 h-4 text-cyan-500" />
                              UI Component
                            </div>
                          </SelectItem>
                          <SelectItem value="api">
                            <div className="flex items-center gap-2">
                              <Globe className="w-4 h-4 text-teal-500" />
                              API
                            </div>
                          </SelectItem>
                          <SelectItem value="training-data">
                            <div className="flex items-center gap-2">
                              <GraduationCap className="w-4 h-4 text-lime-500" />
                              Training Data
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {renderCreateForm()}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreate}>Create Asset</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Search and filters */}
        <div className="px-6 pb-4 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select
            value={filterType}
            onValueChange={(v) => setFilterType(v as AssetType | "all")}
          >
            <SelectTrigger className="w-[180px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(assetTypeLabels).map(([type, label]) => (
                <SelectItem key={type} value={type}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center border rounded-md">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-r-none"
              onClick={() => setViewMode("grid")}
            >
              <Grid3X3 className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-l-none"
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Category tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="px-6">
          <TabsList className="bg-muted/50 flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="all" className="data-[state=active]:bg-background">
              <Layers className="w-4 h-4 mr-2" />
              All ({stats?.total || 0})
            </TabsTrigger>
            <TabsTrigger value="ai" className="data-[state=active]:bg-background">
              <Sparkles className="w-4 h-4 mr-2" />
              AI Assets
            </TabsTrigger>
            <TabsTrigger value="data" className="data-[state=active]:bg-background">
              <Database className="w-4 h-4 mr-2" />
              Data
            </TabsTrigger>
            <TabsTrigger value="code" className="data-[state=active]:bg-background">
              <Code className="w-4 h-4 mr-2" />
              Code
            </TabsTrigger>
            <TabsTrigger value="ui" className="data-[state=active]:bg-background">
              <Layout className="w-4 h-4 mr-2" />
              UI
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
              </div>
            ) : filteredAssets.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No assets yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first asset to get started
                  </p>
                  <Button onClick={() => setIsCreateOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Asset
                  </Button>
                </CardContent>
              </Card>
            ) : viewMode === "grid" ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredAssets.map((asset) => (
                  <Card
                    key={asset.id}
                    className="group hover:border-violet-500/50 transition-all duration-200"
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-10 w-10 rounded-lg bg-gradient-to-br ${assetTypeColors[asset.type]} flex items-center justify-center text-white`}
                          >
                            {assetTypeIcons[asset.type]}
                          </div>
                          <div>
                            <CardTitle className="text-base truncate max-w-[150px]">
                              {asset.name}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {assetTypeLabels[asset.type]}
                            </CardDescription>
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handlePreview(asset)}>
                              <Eye className="w-4 h-4 mr-2" />
                              Preview
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => AssetStudioClient.openFolder(asset.type, asset.id)}
                            >
                              <FolderOpen className="w-4 h-4 mr-2" />
                              Open Folder
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                exportAssetMutation.mutate({ type: asset.type, id: asset.id })
                              }
                            >
                              <Download className="w-4 h-4 mr-2" />
                              Export ZIP
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Rocket className="w-4 h-4 mr-2" />
                              Publish to Marketplace
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-500"
                              onClick={() =>
                                deleteAssetMutation.mutate({ type: asset.type, id: asset.id })
                              }
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                        {asset.description || "No description"}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-3">
                        {asset.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between mt-4 pt-3 border-t">
                        <span className="text-xs text-muted-foreground">
                          v{asset.version}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePreview(asset)}
                        >
                          View
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAssets.map((asset) => (
                  <Card
                    key={asset.id}
                    className="hover:border-violet-500/50 transition-colors"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div
                            className={`h-10 w-10 rounded-lg bg-gradient-to-br ${assetTypeColors[asset.type]} flex items-center justify-center text-white`}
                          >
                            {assetTypeIcons[asset.type]}
                          </div>
                          <div>
                            <h4 className="font-medium">{asset.name}</h4>
                            <p className="text-sm text-muted-foreground truncate max-w-md">
                              {asset.description || "No description"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="outline">{assetTypeLabels[asset.type]}</Badge>
                          <Badge variant="outline">v{asset.version}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePreview(asset)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  exportAssetMutation.mutate({ type: asset.type, id: asset.id })
                                }
                              >
                                <Download className="w-4 h-4 mr-2" />
                                Export
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-500"
                                onClick={() =>
                                  deleteAssetMutation.mutate({ type: asset.type, id: asset.id })
                                }
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewAsset && assetTypeIcons[previewAsset.type]}
              {previewAsset?.name}
            </DialogTitle>
            <DialogDescription>
              {previewAsset?.description || "No description"}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            <pre className="p-4 rounded-lg bg-muted text-sm font-mono overflow-x-auto">
              {previewContent}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
