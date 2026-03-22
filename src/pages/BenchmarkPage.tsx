/**
 * Model Benchmark Page
 * UI for running and viewing model benchmarks
 */

import { useState, useMemo } from "react";
import {
  useBenchmarkSystem,
  useBenchmarkList,
  useBenchmark,
  useAvailableDatasets,
  useRunBenchmark,
  useCancelBenchmark,
  useDeleteBenchmark,
  type BenchmarkId,
  type BenchmarkResult,
  type BenchmarkConfig,
} from "@/hooks/useBenchmark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Gauge,
  Play,
  Square,
  Trash2,
  Trophy,
  Zap,
  Brain,
  HardDrive,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  ChevronRight,
  BarChart3,
  Cpu,
  MemoryStick,
  Target,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// =============================================================================
// STATUS CONFIG
// =============================================================================

const STATUS_CONFIG = {
  pending: { icon: <Clock className="h-4 w-4" />, label: "Pending", color: "bg-gray-500/20 text-gray-600" },
  running: { icon: <Loader2 className="h-4 w-4 animate-spin" />, label: "Running", color: "bg-blue-500/20 text-blue-600" },
  completed: { icon: <CheckCircle2 className="h-4 w-4" />, label: "Completed", color: "bg-green-500/20 text-green-600" },
  failed: { icon: <XCircle className="h-4 w-4" />, label: "Failed", color: "bg-red-500/20 text-red-600" },
  cancelled: { icon: <AlertCircle className="h-4 w-4" />, label: "Cancelled", color: "bg-yellow-500/20 text-yellow-600" },
} as const;

const CATEGORY_CONFIG = {
  speed: { icon: <Zap className="h-4 w-4" />, label: "Speed", color: "bg-yellow-500/20 text-yellow-600" },
  quality: { icon: <Target className="h-4 w-4" />, label: "Quality", color: "bg-purple-500/20 text-purple-600" },
  memory: { icon: <MemoryStick className="h-4 w-4" />, label: "Memory", color: "bg-blue-500/20 text-blue-600" },
  comprehensive: { icon: <BarChart3 className="h-4 w-4" />, label: "Comprehensive", color: "bg-green-500/20 text-green-600" },
} as const;

// =============================================================================
// BENCHMARK CARD
// =============================================================================

function BenchmarkCard({
  benchmark,
  progress,
  isRunning,
  onView,
  onCancel,
  onDelete,
}: {
  benchmark: BenchmarkResult;
  progress?: number;
  isRunning: boolean;
  onView: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const statusConfig = STATUS_CONFIG[benchmark.status];
  const categoryConfig = CATEGORY_CONFIG[benchmark.config.category];

  return (
    <Card className="group">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {categoryConfig.icon}
              {categoryConfig.label} Benchmark
            </CardTitle>
            <CardDescription className="text-xs">
              {benchmark.config.models.length} models • {new Date(benchmark.startedAt).toLocaleString()}
            </CardDescription>
          </div>
          <Badge variant="outline" className={statusConfig.color}>
            {statusConfig.icon}
            <span className="ml-1">{statusConfig.label}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isRunning && progress !== undefined && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span>Progress</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <Progress value={progress * 100} />
          </div>
        )}

        {benchmark.summary && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Zap className="h-3 w-3 text-yellow-500" />
              <span className="text-muted-foreground">Fastest:</span>
              <span className="font-medium truncate">{benchmark.summary.fastestModel}</span>
            </div>
            <div className="flex items-center gap-2">
              <Target className="h-3 w-3 text-purple-500" />
              <span className="text-muted-foreground">Best Quality:</span>
              <span className="font-medium truncate">{benchmark.summary.highestQuality}</span>
            </div>
          </div>
        )}

        {benchmark.error && (
          <p className="text-xs text-destructive mt-2">{benchmark.error}</p>
        )}
      </CardContent>
      <CardFooter className="pt-0 gap-2">
        {isRunning ? (
          <Button variant="destructive" size="sm" onClick={onCancel}>
            <Square className="mr-2 h-3 w-3" />
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onView}>
              View Results
              <ChevronRight className="ml-2 h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

// =============================================================================
// NEW BENCHMARK DIALOG
// =============================================================================

function NewBenchmarkDialog({ onClose }: { onClose: () => void }) {
  const runBenchmark = useRunBenchmark();
  const { data: datasets = [] } = useAvailableDatasets();
  
  const [config, setConfig] = useState<Partial<BenchmarkConfig>>({
    category: "comprehensive",
    models: [],
    speedTests: {
      promptLengths: [100, 500],
      outputLengths: [50, 100],
      iterations: 3,
    },
    qualityTests: {
      datasets: ["mmlu_lite", "reasoning_lite"],
      maxSamples: 50,
    },
    memoryTests: {
      contextLengths: [1024, 2048, 4096],
      batchSizes: [1],
      measurePeakUsage: true,
    },
  });

  // Mock available models - would come from actual providers
  const availableModels = [
    { id: "llama3:8b", name: "Llama 3 8B" },
    { id: "mistral:7b", name: "Mistral 7B" },
    { id: "codellama:7b", name: "Code Llama 7B" },
    { id: "phi3:mini", name: "Phi-3 Mini" },
    { id: "gemma:7b", name: "Gemma 7B" },
  ];

  const handleModelToggle = (modelId: string) => {
    setConfig((prev) => ({
      ...prev,
      models: prev.models?.includes(modelId)
        ? prev.models.filter((m) => m !== modelId)
        : [...(prev.models || []), modelId],
    }));
  };

  const handleDatasetToggle = (datasetId: string) => {
    setConfig((prev) => ({
      ...prev,
      qualityTests: {
        ...prev.qualityTests!,
        datasets: prev.qualityTests?.datasets?.includes(datasetId)
          ? prev.qualityTests.datasets.filter((d) => d !== datasetId)
          : [...(prev.qualityTests?.datasets || []), datasetId],
      },
    }));
  };

  const handleSubmit = async () => {
    if (!config.models?.length) return;
    await runBenchmark.mutateAsync(config as BenchmarkConfig);
    onClose();
  };

  return (
    <DialogContent className="sm:max-w-[600px]">
      <DialogHeader>
        <DialogTitle>New Benchmark</DialogTitle>
        <DialogDescription>
          Configure and run a benchmark to compare local AI models
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6 py-4">
        {/* Category Selection */}
        <div className="space-y-2">
          <Label>Benchmark Type</Label>
          <Select
            value={config.category}
            onValueChange={(v) => setConfig((prev) => ({ ...prev, category: v as any }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  <div className="flex items-center gap-2">
                    {cfg.icon}
                    {cfg.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <Label>Models to Benchmark</Label>
          <div className="grid grid-cols-2 gap-2">
            {availableModels.map((model) => (
              <div
                key={model.id}
                className="flex items-center space-x-2 p-2 border rounded-lg"
              >
                <Checkbox
                  id={model.id}
                  checked={config.models?.includes(model.id)}
                  onCheckedChange={() => handleModelToggle(model.id)}
                />
                <Label htmlFor={model.id} className="text-sm cursor-pointer">
                  {model.name}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Quality Datasets */}
        {(config.category === "quality" || config.category === "comprehensive") && (
          <div className="space-y-2">
            <Label>Quality Test Datasets</Label>
            <div className="grid grid-cols-2 gap-2">
              {datasets.map((dataset) => (
                <div
                  key={dataset.id}
                  className="flex items-center space-x-2 p-2 border rounded-lg"
                >
                  <Checkbox
                    id={dataset.id}
                    checked={config.qualityTests?.datasets?.includes(dataset.id)}
                    onCheckedChange={() => handleDatasetToggle(dataset.id)}
                  />
                  <div>
                    <Label htmlFor={dataset.id} className="text-sm cursor-pointer">
                      {dataset.name}
                    </Label>
                    <p className="text-xs text-muted-foreground">{dataset.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!config.models?.length || runBenchmark.isPending}
        >
          {runBenchmark.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          <Play className="mr-2 h-4 w-4" />
          Start Benchmark
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// =============================================================================
// BENCHMARK RESULTS VIEW
// =============================================================================

function BenchmarkResultsView({
  benchmark,
  onBack,
}: {
  benchmark: BenchmarkResult;
  onBack: () => void;
}) {
  const categoryConfig = CATEGORY_CONFIG[benchmark.config.category];
  const statusConfig = STATUS_CONFIG[benchmark.status];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ChevronRight className="h-4 w-4 rotate-180" />
          </Button>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              {categoryConfig.icon}
              {categoryConfig.label} Benchmark Results
            </h2>
            <p className="text-sm text-muted-foreground">
              {benchmark.config.models.length} models • {new Date(benchmark.startedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <Badge variant="outline" className={statusConfig.color}>
          {statusConfig.icon}
          <span className="ml-1">{statusConfig.label}</span>
        </Badge>
      </div>

      {/* System Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            System Information
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Platform</p>
            <p className="font-medium">{benchmark.systemInfo.platform}</p>
          </div>
          <div>
            <p className="text-muted-foreground">CPU</p>
            <p className="font-medium truncate">{benchmark.systemInfo.cpuModel}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Cores</p>
            <p className="font-medium">{benchmark.systemInfo.cpuCores}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Memory</p>
            <p className="font-medium">{benchmark.systemInfo.totalMemory} GB</p>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {benchmark.summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-500" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-3 bg-yellow-500/10 rounded-lg">
                <Zap className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Fastest</p>
                <p className="font-medium text-sm">{benchmark.summary.fastestModel}</p>
              </div>
              <div className="text-center p-3 bg-purple-500/10 rounded-lg">
                <Target className="h-5 w-5 text-purple-500 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Best Quality</p>
                <p className="font-medium text-sm">{benchmark.summary.highestQuality}</p>
              </div>
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <BarChart3 className="h-5 w-5 text-green-500 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Most Efficient</p>
                <p className="font-medium text-sm">{benchmark.summary.mostEfficient}</p>
              </div>
              <div className="text-center p-3 bg-blue-500/10 rounded-lg">
                <MemoryStick className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Lowest Memory</p>
                <p className="font-medium text-sm">{benchmark.summary.lowestMemory}</p>
              </div>
            </div>

            {benchmark.summary.recommendations.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="font-medium mb-2">Recommendations</h4>
                  <div className="space-y-2">
                    {benchmark.summary.recommendations.map((rec, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                        <div>
                          <span className="font-medium">{rec.useCase}:</span>{" "}
                          <span className="text-muted-foreground">{rec.recommendedModel}</span>
                          <p className="text-xs text-muted-foreground">{rec.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Model Results</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Speed (tok/s)</TableHead>
                <TableHead>Quality (%)</TableHead>
                <TableHead>Memory (MB)</TableHead>
                <TableHead>Overall Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {benchmark.results.map((result) => (
                <TableRow key={result.modelId}>
                  <TableCell>
                    {result.rank === 1 ? (
                      <Badge className="bg-yellow-500">🥇 1st</Badge>
                    ) : result.rank === 2 ? (
                      <Badge className="bg-gray-400">🥈 2nd</Badge>
                    ) : result.rank === 3 ? (
                      <Badge className="bg-orange-400">🥉 3rd</Badge>
                    ) : (
                      <span className="text-muted-foreground">#{result.rank}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{result.modelInfo.name}</TableCell>
                  <TableCell>
                    {result.speedMetrics?.tokensPerSecond.toFixed(1) || "N/A"}
                  </TableCell>
                  <TableCell>
                    {result.qualityMetrics
                      ? `${(result.qualityMetrics.overallAccuracy * 100).toFixed(1)}%`
                      : "N/A"}
                  </TableCell>
                  <TableCell>
                    {result.memoryMetrics?.avgMemoryUsage.toFixed(0) || "N/A"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={(result.overallScore || 0) * 100}
                        className="w-16 h-2"
                      />
                      <span>{((result.overallScore || 0) * 100).toFixed(0)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function BenchmarkPage() {
  const { isReady, isInitializing, initialize, runningBenchmarks, progress } = useBenchmarkSystem();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [selectedBenchmark, setSelectedBenchmark] = useState<BenchmarkId | null>(null);

  const { data: benchmarks = [], isLoading } = useBenchmarkList(isReady);
  const { data: selectedResult } = useBenchmark(selectedBenchmark);
  const cancelBenchmark = useCancelBenchmark();
  const deleteBenchmark = useDeleteBenchmark();

  if (!isReady) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] gap-4">
        <Gauge className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Model Benchmark Suite</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Compare local AI models on speed, quality, and memory usage
          to find the best fit for your needs.
        </p>
        <Button onClick={initialize} disabled={isInitializing} size="lg">
          {isInitializing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Initialize Benchmark System
        </Button>
      </div>
    );
  }

  if (selectedBenchmark && selectedResult) {
    return (
      <div className="py-6 px-6">
        <BenchmarkResultsView
          benchmark={selectedResult}
          onBack={() => setSelectedBenchmark(null)}
        />
      </div>
    );
  }

  return (
    <div className="py-6 px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gauge className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Model Benchmarks</h1>
            <p className="text-sm text-muted-foreground">
              Compare local AI model performance
            </p>
          </div>
        </div>
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogTrigger asChild>
            <Button>
              <Play className="mr-2 h-4 w-4" />
              New Benchmark
            </Button>
          </DialogTrigger>
          {showNewDialog && (
            <NewBenchmarkDialog onClose={() => setShowNewDialog(false)} />
          )}
        </Dialog>
      </div>

      {/* Benchmark List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : benchmarks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No benchmarks yet</h3>
            <p className="text-muted-foreground text-center max-w-md mt-2">
              Run your first benchmark to compare local AI models on speed,
              quality, and memory usage.
            </p>
            <Button className="mt-4" onClick={() => setShowNewDialog(true)}>
              <Play className="mr-2 h-4 w-4" />
              Start First Benchmark
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {benchmarks.map((benchmark) => (
            <BenchmarkCard
              key={benchmark.id}
              benchmark={benchmark}
              progress={progress[benchmark.id]}
              isRunning={runningBenchmarks.has(benchmark.id)}
              onView={() => setSelectedBenchmark(benchmark.id)}
              onCancel={() => cancelBenchmark.mutate(benchmark.id)}
              onDelete={() => deleteBenchmark.mutate(benchmark.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
