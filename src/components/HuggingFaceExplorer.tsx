/**
 * HuggingFace Explorer Component
 * Search, browse, and download models/datasets from HuggingFace Hub
 */

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useHfSearchModels,
  useHfSearchDatasets,
  useHfDownloadModel,
  useHfDownloadDataset,
  useHfDownloadProgress,
  useHfAuthStatus,
} from "@/hooks/useHuggingFace";
import type { HfModelInfo, HfDatasetInfo } from "@/ipc/handlers/huggingface_handlers";
import { Search, Download, ExternalLink, Cpu, Database, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function ModelCard({
  model,
  onDownload,
  isDownloading,
}: {
  model: HfModelInfo;
  onDownload: (modelId: string) => void;
  isDownloading: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{model.id}</span>
          {model.pipeline_tag && (
            <Badge variant="secondary" className="text-xs shrink-0">
              {model.pipeline_tag}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            {formatNumber(model.downloads)}
          </span>
          <span>♥ {formatNumber(model.likes)}</span>
          {model.library_name && <span>{model.library_name}</span>}
        </div>
        {model.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {model.tags.slice(0, 5).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() =>
            window.open(`https://huggingface.co/${model.id}`, "_blank")
          }
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1 text-xs"
          disabled={isDownloading}
          onClick={() => onDownload(model.id)}
        >
          {isDownloading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          Download
        </Button>
      </div>
    </div>
  );
}

function DatasetCard({
  dataset,
  onDownload,
  isDownloading,
}: {
  dataset: HfDatasetInfo;
  onDownload: (datasetId: string) => void;
  isDownloading: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm truncate block">{dataset.id}</span>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            {formatNumber(dataset.downloads)}
          </span>
          <span>♥ {formatNumber(dataset.likes)}</span>
        </div>
        {dataset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {dataset.tags.slice(0, 5).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="default"
        className="h-7 gap-1 text-xs shrink-0"
        disabled={isDownloading}
        onClick={() => onDownload(dataset.id)}
      >
        {isDownloading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        Download
      </Button>
    </div>
  );
}

export function HuggingFaceExplorer({
  className,
  onModelSelected,
  onDatasetSelected,
}: {
  className?: string;
  onModelSelected?: (modelId: string, localPath: string) => void;
  onDatasetSelected?: (datasetId: string, localPath: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"models" | "datasets">("models");
  const [modelFilter, setModelFilter] = useState<string>("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: authStatus } = useHfAuthStatus();
  const downloadProgress = useHfDownloadProgress();

  const {
    data: models,
    isLoading: modelsLoading,
  } = useHfSearchModels(searchQuery, {
    filter: modelFilter || undefined,
    enabled: activeTab === "models",
  });

  const {
    data: datasets,
    isLoading: datasetsLoading,
  } = useHfSearchDatasets(searchQuery, {
    enabled: activeTab === "datasets",
  });

  const downloadModel = useHfDownloadModel();
  const downloadDataset = useHfDownloadDataset();

  const handleDownloadModel = useCallback(
    async (modelId: string) => {
      setDownloadingId(modelId);
      try {
        const result = await downloadModel.mutateAsync({ modelId });
        onModelSelected?.(modelId, result.path);
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadModel, onModelSelected],
  );

  const handleDownloadDataset = useCallback(
    async (datasetId: string) => {
      setDownloadingId(datasetId);
      try {
        const result = await downloadDataset.mutateAsync({ datasetId });
        onDatasetSelected?.(datasetId, result.path);
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadDataset, onDatasetSelected],
  );

  const MODEL_FILTERS = [
    { label: "All", value: "" },
    { label: "Text Generation", value: "text-generation" },
    { label: "Text2Text", value: "text2text-generation" },
    { label: "Token Classification", value: "token-classification" },
    { label: "Sequence Classification", value: "text-classification" },
    { label: "Question Answering", value: "question-answering" },
    { label: "Summarization", value: "summarization" },
    { label: "Translation", value: "translation" },
  ];

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg"
            alt="HF"
            className="h-5 w-5"
          />
          <h3 className="font-semibold text-sm">HuggingFace Hub</h3>
        </div>
        {authStatus?.authenticated && (
          <Badge variant="secondary" className="text-xs">
            {authStatus.username}
          </Badge>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder={
            activeTab === "models" ? "Search models..." : "Search datasets..."
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Download Progress */}
      {downloadProgress && downloadingId && (
        <div className="rounded border border-border bg-muted/50 p-2 text-xs">
          <div className="flex justify-between mb-1">
            <span className="truncate">{downloadProgress.file}</span>
            <span>{downloadProgress.percent}%</span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${downloadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "models" | "datasets")}
      >
        <TabsList className="w-full">
          <TabsTrigger value="models" className="flex-1 gap-1 text-xs">
            <Cpu className="h-3 w-3" /> Models
          </TabsTrigger>
          <TabsTrigger value="datasets" className="flex-1 gap-1 text-xs">
            <Database className="h-3 w-3" /> Datasets
          </TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="mt-2">
          {/* Model Filters */}
          <div className="flex flex-wrap gap-1 mb-2">
            {MODEL_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={modelFilter === f.value ? "default" : "outline"}
                className="h-6 text-[10px] px-2"
                onClick={() => setModelFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          {/* Results */}
          {modelsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Searching models...
            </div>
          ) : !searchQuery ? (
            <p className="text-center text-muted-foreground text-sm py-8">
              Type a query to search HuggingFace models
            </p>
          ) : models && models.length > 0 ? (
            <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
              {models.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  onDownload={handleDownloadModel}
                  isDownloading={downloadingId === model.id}
                />
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-sm py-8">
              No models found
            </p>
          )}
        </TabsContent>

        <TabsContent value="datasets" className="mt-2">
          {datasetsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Searching datasets...
            </div>
          ) : !searchQuery ? (
            <p className="text-center text-muted-foreground text-sm py-8">
              Type a query to search HuggingFace datasets
            </p>
          ) : datasets && datasets.length > 0 ? (
            <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
              {datasets.map((dataset) => (
                <DatasetCard
                  key={dataset.id}
                  dataset={dataset}
                  onDownload={handleDownloadDataset}
                  isDownloading={downloadingId === dataset.id}
                />
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-sm py-8">
              No datasets found
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
