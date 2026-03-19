/**
 * Decentralized Model Registry — Page
 * Browse, publish, rate, and download AI models across the network.
 */

import React, { useState } from "react";
import {
  Search,
  Upload,
  Download,
  Star,
  Globe,
  Database,
  Users,
  TrendingUp,
  RefreshCw,
  Loader2,
  ExternalLink,
  Trash2,
  Eye,
  Filter,
  ChevronDown,
  Cpu,
  HardDrive,
  Shield,
  Tag,
  Clock,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useRegistryStats,
  useModelRegistrySearch,
  useRegistryPeers,
  usePublishModel,
  useDeleteModel,
  useDownloadModel,
  useRateModel,
  useActiveDownloads,
} from "@/hooks/use-model-registry";
import { useQueryClient } from "@tanstack/react-query";

// =============================================================================
// STATS DASHBOARD
// =============================================================================

function StatsDashboard() {
  const { data: stats, isLoading } = useRegistryStats();

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="pt-4 pb-3">
              <div className="h-8 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      label: "Total Models",
      value: stats.totalModels,
      icon: Database,
      color: "text-blue-500",
    },
    {
      label: "Published",
      value: stats.publishedModels,
      icon: Globe,
      color: "text-green-500",
    },
    {
      label: "Known Peers",
      value: `${stats.onlinePeers}/${stats.knownPeers}`,
      icon: Users,
      color: "text-purple-500",
    },
    {
      label: "Downloads",
      value: stats.totalDownloads,
      icon: Download,
      color: "text-orange-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {statCards.map((s) => (
        <Card key={s.label}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
              <s.icon className={`h-8 w-8 ${s.color} opacity-50`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// MODEL CARD
// =============================================================================

function ModelCard({
  model,
  onPublish,
  onDelete,
  onDownload,
}: {
  model: any;
  onPublish: (id: string) => void;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  const publishMutation = usePublishModel();
  const rateMutation = useRateModel();

  const stateColors: Record<string, string> = {
    local: "bg-gray-500",
    pinned: "bg-blue-500",
    attested: "bg-purple-500",
    published: "bg-green-500",
    delisted: "bg-red-500",
  };

  const typeLabels: Record<string, string> = {
    base: "Base Model",
    fine_tuned: "Fine-Tuned",
    merged: "Merged",
    quantized: "Quantized",
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatParams = (params: number | null) => {
    if (!params) return "—";
    if (params >= 1_000_000_000) return `${(params / 1_000_000_000).toFixed(1)}B`;
    if (params >= 1_000_000) return `${(params / 1_000_000).toFixed(0)}M`;
    return `${params}`;
  };

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{model.name}</CardTitle>
            <CardDescription className="text-xs mt-1">
              v{model.version} · by {model.author}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
            <Badge variant="outline" className="text-[10px]">
              {typeLabels[model.modelType] || model.modelType}
            </Badge>
            <div
              className={`w-2.5 h-2.5 rounded-full ${stateColors[model.publishState] || "bg-gray-400"}`}
              title={model.publishState}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {model.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {model.description}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Cpu className="h-3 w-3" />
            <span>{formatParams(model.parameters)}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <HardDrive className="h-3 w-3" />
            <span>{formatSize(model.fileSizeBytes)}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Shield className="h-3 w-3" />
            <span className="truncate">{model.license}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {model.avgRating != null && (
            <span className="flex items-center gap-0.5">
              <Star
                className={`h-3 w-3 ${model.avgRating >= 70 ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`}
              />
              {model.avgRating}/100
              <span className="text-muted-foreground">
                ({model.totalRatings})
              </span>
            </span>
          )}
          <span className="flex items-center gap-0.5">
            <Download className="h-3 w-3" />
            {model.downloadCount}
          </span>
          <span className="flex items-center gap-0.5">
            <BarChart3 className="h-3 w-3" />
            {model.usageCount} uses
          </span>
        </div>

        {model.tags && model.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {model.tags.slice(0, 4).map((tag: string) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {model.tags.length > 4 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                +{model.tags.length - 4}
              </Badge>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {model.source === "local" && model.publishState === "local" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs flex-1"
              onClick={() => onPublish(model.id)}
              disabled={publishMutation.isPending}
            >
              {publishMutation.isPending ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              Publish
            </Button>
          )}
          {model.source === "peer" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs flex-1"
              onClick={() => onDownload(model.id)}
            >
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          )}
          {model.source === "local" && model.publishState !== "published" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => onDelete(model.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          {model.source === "peer" ? "Discovered" : "Registered"}{" "}
          {formatDistanceToNow(new Date(model.createdAt), {
            addSuffix: true,
          })}
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// PEERS PANEL
// =============================================================================

function PeersPanel() {
  const { data: peers, isLoading } = useRegistryPeers();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!peers || peers.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No peers discovered yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Start the compute network to discover model publishers
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {peers.map((peer) => (
        <Card key={peer.id}>
          <CardContent className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-2.5 h-2.5 rounded-full ${peer.isOnline ? "bg-green-500" : "bg-gray-400"}`}
              />
              <div>
                <p className="text-sm font-medium">
                  {peer.displayName || peer.id.slice(0, 16) + "…"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {peer.modelsShared} models shared · Trust: {peer.trustScore}/100
                </p>
              </div>
            </div>
            <Badge variant={peer.isOnline ? "default" : "secondary"}>
              {peer.isOnline ? "Online" : "Offline"}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// DOWNLOADS PANEL
// =============================================================================

function DownloadsPanel() {
  const { data: downloads } = useActiveDownloads();

  if (!downloads || downloads.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No active downloads
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {downloads.map((dl) => (
        <Card key={dl.id}>
          <CardContent className="py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium truncate">{dl.modelEntryId.slice(0, 8)}…</p>
              <Badge variant="outline" className="text-xs">
                {dl.status}
              </Badge>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: `${dl.progress}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {dl.progress}%
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function ModelRegistryPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterFamily, setFilterFamily] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("created");

  const searchParams: any = {
    sortBy,
    sortOrder: "desc" as const,
    limit: 50,
  };
  if (searchQuery) searchParams.query = searchQuery;
  if (filterFamily !== "all") searchParams.family = filterFamily;
  if (filterType !== "all") searchParams.modelType = filterType;
  if (filterSource !== "all") searchParams.source = filterSource;

  const { data: searchResult, isLoading } = useModelRegistrySearch(searchParams);
  const publishMutation = usePublishModel();
  const deleteMutation = useDeleteModel();
  const downloadMutation = useDownloadModel();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["model-registry"] });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Decentralized Model Registry
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Publish, discover, and rate AI models across the network
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          {/* Stats */}
          <StatsDashboard />

          {/* Main Tabs */}
          <Tabs defaultValue="browse" className="space-y-4">
            <TabsList>
              <TabsTrigger value="browse">Browse Models</TabsTrigger>
              <TabsTrigger value="peers">Peers</TabsTrigger>
              <TabsTrigger value="downloads">Downloads</TabsTrigger>
            </TabsList>

            <TabsContent value="browse" className="space-y-4">
              {/* Search + Filters */}
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search models…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={filterFamily} onValueChange={setFilterFamily}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Family" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Families</SelectItem>
                    <SelectItem value="llama">Llama</SelectItem>
                    <SelectItem value="mistral">Mistral</SelectItem>
                    <SelectItem value="qwen">Qwen</SelectItem>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="phi">Phi</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="base">Base</SelectItem>
                    <SelectItem value="fine_tuned">Fine-Tuned</SelectItem>
                    <SelectItem value="merged">Merged</SelectItem>
                    <SelectItem value="quantized">Quantized</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterSource} onValueChange={setFilterSource}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                    <SelectItem value="peer">Peer</SelectItem>
                    <SelectItem value="marketplace">Marketplace</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created">Newest</SelectItem>
                    <SelectItem value="rating">Top Rated</SelectItem>
                    <SelectItem value="downloads">Most Downloads</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Results */}
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !searchResult || searchResult.entries.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                    <Database className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-medium">No models found</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md">
                      Models registered locally, discovered from peers, or
                      published to the marketplace will appear here.
                      The Data Flywheel automatically registers fine-tuned
                      adapters when training completes.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {searchResult.total} model{searchResult.total !== 1 ? "s" : ""} found
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {searchResult.entries.map((model) => (
                      <ModelCard
                        key={model.id}
                        model={model}
                        onPublish={(id) => publishMutation.mutate(id)}
                        onDelete={(id) => deleteMutation.mutate(id)}
                        onDownload={(id) => downloadMutation.mutate(id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="peers">
              <PeersPanel />
            </TabsContent>

            <TabsContent value="downloads">
              <DownloadsPanel />
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
