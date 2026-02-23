/**
 * ModelDownloadPage — GPU-Aware Model Download Manager
 *
 * Features:
 * - Cross-platform GPU detection with recommendations
 * - Curated Ollama model catalog filtered by hardware
 * - One-click download with real-time progress
 * - Installed model management (view, delete)
 * - Hardware info dashboard
 */

import React, { useMemo, useState } from "react";
import {
  useSystemHardware,
  useFilteredModelCatalog,
  useInstalledModels,
  usePullModel,
  useDeleteModel,
  useModelPullProgress,
} from "../hooks/useModelDownload";
import {
  Download,
  Trash2,
  Cpu,
  HardDrive,
  Zap,
  RefreshCw,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Monitor,
  Search,
  MemoryStick,
  Server,
  Box,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const CATEGORY_LABELS: Record<string, string> = {
  chat: "Chat & General",
  code: "Code & Development",
  embedding: "Embedding Models",
  vision: "Vision & Multimodal",
  small: "Lightweight / Edge",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  chat: <Zap className="h-4 w-4" />,
  code: <Server className="h-4 w-4" />,
  embedding: <Box className="h-4 w-4" />,
  vision: <Monitor className="h-4 w-4" />,
  small: <Cpu className="h-4 w-4" />,
};

// ── Hardware Dashboard ──

function HardwareDashboard({
  hardware,
  isLoading,
  refetch,
}: {
  hardware: any;
  isLoading: boolean;
  refetch: () => void;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span className="text-muted-foreground">Detecting hardware...</span>
        </CardContent>
      </Card>
    );
  }

  if (!hardware) return null;

  const gpus = hardware.gpus || [];
  const hasGpu = gpus.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              System Hardware
            </CardTitle>
            <CardDescription>
              Detected capabilities for model recommendations
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* CPU */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              CPU
            </p>
            <p className="text-sm font-medium truncate">
              {hardware.cpu || "Unknown"}
            </p>
            <p className="text-xs text-muted-foreground">
              {hardware.cpuCores || "?"} cores
            </p>
          </div>

          {/* RAM */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              System RAM
            </p>
            <p className="text-sm font-medium">
              {hardware.totalMemoryGB
                ? `${hardware.totalMemoryGB} GB`
                : "Unknown"}
            </p>
            <p className="text-xs text-muted-foreground">
              {hardware.availableMemoryGB
                ? `${hardware.availableMemoryGB} GB available`
                : ""}
            </p>
          </div>

          {/* GPU */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              GPU
            </p>
            {hasGpu ? (
              gpus.map((gpu: any, i: number) => (
                <div key={i}>
                  <p className="text-sm font-medium truncate">{gpu.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {gpu.vramGB ? `${gpu.vramGB} GB VRAM` : ""}
                    {gpu.vendor ? ` · ${gpu.vendor}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No discrete GPU</p>
            )}
          </div>

          {/* Recommendation */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Max Model Size
            </p>
            <p className="text-sm font-bold text-green-600 dark:text-green-400">
              {hardware.maxModelSizeGB
                ? `${hardware.maxModelSizeGB} GB`
                : "Unknown"}
            </p>
            <p className="text-xs text-muted-foreground">
              Recommended: {hardware.recommendedQuantization || "Q4_K_M"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Model Card ──

function ModelCard({
  model,
  isInstalled,
  isPulling,
  pullProgress,
  onPull,
  onDelete,
}: {
  model: any;
  isInstalled: boolean;
  isPulling: boolean;
  pullProgress: { progress: number; status: string } | null;
  onPull: () => void;
  onDelete: () => void;
}) {
  const fitsHardware = model.fitsHardware !== false;

  return (
    <Card
      className={`transition-colors ${!fitsHardware ? "opacity-60 border-dashed" : ""}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base flex items-center gap-2">
              {model.name}
              {isInstalled && (
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Installed
                </Badge>
              )}
              {!fitsHardware && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Too large
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {model.description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-xs">
            {model.category}
          </Badge>
          {model.sizes?.map((s: any) => (
            <Badge key={s.label} variant="outline" className="text-xs">
              {s.label} · {s.sizeGB}GB
            </Badge>
          ))}
        </div>

        {/* Pull Progress */}
        {isPulling && pullProgress && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {pullProgress.status}
              </span>
              <span className="font-mono">{pullProgress.progress}%</span>
            </div>
            <Progress value={pullProgress.progress} className="h-2" />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {!isInstalled && !isPulling && (
            <Button
              size="sm"
              onClick={onPull}
              disabled={!fitsHardware}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          )}
          {isPulling && (
            <Button size="sm" disabled variant="secondary" className="gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Downloading...
            </Button>
          )}
          {isInstalled && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{model.ollamaId}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the model from your local Ollama storage.
                    You can re-download it later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Hardware warning */}
        {model.hardwareWarning && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {model.hardwareWarning}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Installed Models Table ──

function InstalledModelsPanel({
  models,
  isLoading,
}: {
  models: any[];
  isLoading: boolean;
}) {
  const deleteModel = useDeleteModel();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-muted-foreground">Loading models...</span>
      </div>
    );
  }

  if (!models || models.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <HardDrive className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No models installed yet.</p>
        <p className="text-sm mt-1">
          Switch to the Catalog tab to download models.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {models.map((model: any) => (
        <Card key={model.id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{model.name}</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span>{formatBytes(model.sizeBytes)}</span>
                {model.family && <span>{model.family}</span>}
                {model.quantization && <span>{model.quantization}</span>}
                {model.parameterSize && <span>{model.parameterSize}</span>}
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{model.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the model from Ollama. You can re-download
                    it later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteModel.mutate(model.id)}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Main Page ──

export default function ModelDownloadPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["chat", "embedding"]),
  );

  const hardware = useSystemHardware();
  const catalog = useFilteredModelCatalog();
  const installed = useInstalledModels();
  const pullModel = usePullModel();
  const deleteModel = useDeleteModel();
  const { progressMap, isDownloading, getProgress } = useModelPullProgress();

  // Build set of installed model IDs for quick lookup
  const installedIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of installed.data || []) {
      set.add(m.id);
      // Also add without :latest suffix
      set.add(m.id.replace(/:latest$/, ""));
    }
    return set;
  }, [installed.data]);

  // Filter catalog by search query
  const filteredCatalog = useMemo(() => {
    const models = catalog.data || [];
    if (!searchQuery.trim()) return models;
    const q = searchQuery.toLowerCase();
    return models.filter(
      (m: any) =>
        m.name.toLowerCase().includes(q) ||
        m.ollamaId.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q),
    );
  }, [catalog.data, searchQuery]);

  // Group by category
  const groupedCatalog = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const m of filteredCatalog) {
      const cat = m.category || "other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    }
    return groups;
  }, [filteredCatalog]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const isModelInstalled = (model: any) =>
    installedIds.has(model.ollamaId) ||
    installedIds.has(`${model.ollamaId}:latest`);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Download className="h-6 w-6" />
          Model Download Manager
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Detect your hardware, browse recommended models, and download with one
          click
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {/* Hardware Dashboard */}
        <HardwareDashboard
          hardware={hardware.data}
          isLoading={hardware.isLoading}
          refetch={() => hardware.refetch()}
        />

        {/* Active Downloads Banner */}
        {Object.keys(progressMap).length > 0 && (
          <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="py-3">
              <p className="text-sm font-medium mb-2 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {Object.keys(progressMap).length} download(s) in progress
              </p>
              {Object.entries(progressMap).map(([modelId, prog]) => (
                <div key={modelId} className="space-y-1 mb-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{modelId}</span>
                    <span className="text-muted-foreground">
                      {prog.status} · {prog.progress}%
                    </span>
                  </div>
                  <Progress value={prog.progress} className="h-1.5" />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="catalog">
          <TabsList>
            <TabsTrigger value="catalog" className="gap-1.5">
              <Search className="h-3.5 w-3.5" />
              Model Catalog
            </TabsTrigger>
            <TabsTrigger value="installed" className="gap-1.5">
              <HardDrive className="h-3.5 w-3.5" />
              Installed ({installed.data?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          {/* Catalog Tab */}
          <TabsContent value="catalog" className="space-y-4 mt-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search models... (e.g., llama, code, embedding)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {catalog.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-muted-foreground">
                  Loading catalog...
                </span>
              </div>
            ) : (
              Object.entries(groupedCatalog).map(([category, models]) => (
                <Collapsible
                  key={category}
                  open={expandedCategories.has(category)}
                  onOpenChange={() => toggleCategory(category)}
                >
                  <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-left hover:text-foreground transition-colors group">
                    {expandedCategories.has(category) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    {CATEGORY_ICONS[category] || <Box className="h-4 w-4" />}
                    <span className="font-semibold">
                      {CATEGORY_LABELS[category] || category}
                    </span>
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {(models as any[]).length}
                    </Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pt-2 pb-4">
                      {(models as any[]).map((model: any) => (
                        <ModelCard
                          key={model.ollamaId}
                          model={model}
                          isInstalled={isModelInstalled(model)}
                          isPulling={isDownloading(model.ollamaId)}
                          pullProgress={getProgress(model.ollamaId)}
                          onPull={() => pullModel.mutate(model.ollamaId)}
                          onDelete={() => deleteModel.mutate(model.ollamaId)}
                        />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))
            )}

            {!catalog.isLoading &&
              filteredCatalog.length === 0 &&
              searchQuery && (
                <div className="text-center py-8 text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>No models match "{searchQuery}"</p>
                </div>
              )}
          </TabsContent>

          {/* Installed Tab */}
          <TabsContent value="installed" className="mt-4">
            <InstalledModelsPanel
              models={installed.data || []}
              isLoading={installed.isLoading}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
