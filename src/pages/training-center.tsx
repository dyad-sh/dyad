import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { getDatasetStudioClient } from "@/ipc/dataset_studio_client";
import type { StudioDataset } from "@/ipc/dataset_studio_client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  GraduationCap,
  Play,
  Square,
  Cpu,
  Cloud,
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  RefreshCw,
  Info,
  Zap,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import type {
  DatasetTrainingParams,
  DatasetTrainingStatus,
  TrainedModelInfo,
  ListBaseModelsResult,
  TrainingSystemInfo,
} from "@/ipc/ipc_types";

const ipc = IpcClient.getInstance();
const datasetClient = getDatasetStudioClient();

// ============================================================================
// TRAINING CENTER PAGE
// ============================================================================

export default function TrainingCenterPage() {
  const router = useRouter();

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b">
        <Button variant="ghost" size="icon" onClick={() => router.history.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <GraduationCap className="h-6 w-6 text-emerald-500" />
        <div>
          <h1 className="text-xl font-semibold">Training Center</h1>
          <p className="text-sm text-muted-foreground">
            Train AI models on your datasets — local or OpenAI
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="train" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-3">
          <TabsList>
            <TabsTrigger value="train" className="gap-1.5">
              <Play className="h-3.5 w-3.5" /> Train
            </TabsTrigger>
            <TabsTrigger value="progress" className="gap-1.5">
              <Loader2 className="h-3.5 w-3.5" /> Progress
            </TabsTrigger>
            <TabsTrigger value="models" className="gap-1.5">
              <Cpu className="h-3.5 w-3.5" /> Models
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          <TabsContent value="train" className="mt-0">
            <TrainTab />
          </TabsContent>
          <TabsContent value="progress" className="mt-0">
            <ProgressTab />
          </TabsContent>
          <TabsContent value="models" className="mt-0">
            <ModelsTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ============================================================================
// TRAIN TAB
// ============================================================================

function TrainTab() {
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [provider, setProvider] = useState<"local" | "openai">("local");
  const [baseModelId, setBaseModelId] = useState("");
  const [method, setMethod] = useState<"lora" | "qlora" | "full">("qlora");
  const [format, setFormat] = useState<"alpaca" | "sharegpt" | "oasst" | "raw">("alpaca");
  const [epochs, setEpochs] = useState(3);
  const [batchSize, setBatchSize] = useState(2);
  const [learningRate, setLearningRate] = useState(0.0002);
  const [loraRank, setLoraRank] = useState(8);
  const [loraAlpha, setLoraAlpha] = useState(16);
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiModel, setOpenAiModel] = useState("gpt-5-mini");

  // Queries
  const { data: datasets = [] } = useQuery<StudioDataset[]>({
    queryKey: ["training-datasets"],
    queryFn: () => datasetClient.listDatasets(),
  });

  const { data: baseModels } = useQuery<ListBaseModelsResult>({
    queryKey: ["training-base-models"],
    queryFn: () => ipc.listBaseModelsForTraining(),
  });

  const { data: systemInfo } = useQuery<TrainingSystemInfo>({
    queryKey: ["training-system-info"],
    queryFn: () => ipc.getTrainingSystemInfo(),
  });

  // Set default base model when models load
  useEffect(() => {
    if (baseModels && !baseModelId) {
      if (provider === "local" && baseModels.local.length > 0) {
        setBaseModelId(baseModels.local[0].id);
      } else if (provider === "openai" && baseModels.openai.length > 0) {
        setBaseModelId(baseModels.openai[0].id);
      }
    }
  }, [baseModels, provider, baseModelId]);

  const trainMutation = useMutation({
    mutationFn: (params: DatasetTrainingParams) => ipc.trainOnDataset(params),
    onSuccess: (result) => {
      toast.success(`Training started: ${result.name}`);
      queryClient.invalidateQueries({ queryKey: ["training-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["trained-models"] });
    },
    onError: (err: Error) => {
      toast.error(`Training failed: ${err.message}`);
    },
  });

  const selectedDataset = datasets.find((d) => d.id === datasetId);

  function handleStartTraining() {
    if (!datasetId || !baseModelId || !name) {
      toast.error("Please fill in all required fields");
      return;
    }

    const params: DatasetTrainingParams = {
      name,
      datasetId,
      baseModelSource: provider === "openai" ? "huggingface" : "ollama",
      baseModelId,
      method,
      datasetFormat: format,
      hyperparameters: {
        epochs,
        batchSize,
        learningRate,
        loraRank,
        loraAlpha,
        gradientCheckpointing: true,
      },
    };

    if (provider === "openai") {
      if (!openAiKey && !systemInfo?.hasOpenAiKey) {
        toast.error("OpenAI API key is required");
        return;
      }
      params.openAiConfig = {
        apiKey: openAiKey || process.env.OPENAI_API_KEY || "",
        model: openAiModel,
        nEpochs: epochs,
        batchSize,
      };
    }

    trainMutation.mutate(params);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Configuration */}
      <div className="lg:col-span-2 space-y-6">
        {/* Job Name */}
        <div className="space-y-2">
          <Label>Training Job Name *</Label>
          <Input
            placeholder="My fine-tuned model..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Dataset Selection */}
        <div className="space-y-2">
          <Label>Dataset *</Label>
          <Select value={datasetId} onValueChange={setDatasetId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a dataset..." />
            </SelectTrigger>
            <SelectContent>
              {datasets.map((ds) => (
                <SelectItem key={ds.id} value={ds.id}>
                  <span className="flex items-center gap-2">
                    <Database className="h-3.5 w-3.5 text-muted-foreground" />
                    {ds.name}
                    <Badge variant="outline" className="text-xs ml-1">
                      {ds.itemCount} items
                    </Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedDataset && (
            <div className="text-xs text-muted-foreground flex gap-3">
              <span>Type: {selectedDataset.datasetType}</span>
              <span>Items: {selectedDataset.itemCount}</span>
              <span>
                Size: {((selectedDataset.totalBytes || 0) / (1024 * 1024)).toFixed(1)} MB
              </span>
            </div>
          )}
        </div>

        {/* Provider Selection */}
        <div className="space-y-2">
          <Label>Training Provider</Label>
          <div className="flex gap-2">
            <Button
              variant={provider === "local" ? "default" : "outline"}
              onClick={() => setProvider("local")}
              className="flex-1 gap-2"
            >
              <Cpu className="h-4 w-4" /> Local (GPU)
            </Button>
            <Button
              variant={provider === "openai" ? "default" : "outline"}
              onClick={() => setProvider("openai")}
              className="flex-1 gap-2"
            >
              <Cloud className="h-4 w-4" /> OpenAI API
            </Button>
          </div>
        </div>

        {/* Base Model Selection */}
        <div className="space-y-2">
          <Label>Base Model *</Label>
          <Select value={baseModelId} onValueChange={setBaseModelId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a base model..." />
            </SelectTrigger>
            <SelectContent>
              {provider === "local" &&
                baseModels?.local.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} {m.size && <span className="text-xs text-muted-foreground">({m.size})</span>}
                  </SelectItem>
                ))}
              {provider === "openai" &&
                baseModels?.openai.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    <span className="text-xs text-muted-foreground ml-1">— {m.description}</span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Local-specific Settings */}
        {provider === "local" && (
          <>
            {/* Method */}
            <div className="space-y-2">
              <Label>Training Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qlora">QLoRA (4-bit, recommended)</SelectItem>
                  <SelectItem value="lora">LoRA (float16)</SelectItem>
                  <SelectItem value="full">Full Fine-tune</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Dataset Format */}
            <div className="space-y-2">
              <Label>Dataset Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alpaca">Alpaca (instruction/input/output)</SelectItem>
                  <SelectItem value="sharegpt">ShareGPT (conversations)</SelectItem>
                  <SelectItem value="oasst">OASST (INSTRUCTION/RESPONSE)</SelectItem>
                  <SelectItem value="raw">Raw (auto-detect)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* OpenAI-specific Settings */}
        {provider === "openai" && (
          <div className="space-y-2">
            <Label>OpenAI API Key {systemInfo?.hasOpenAiKey && "(from environment)"}</Label>
            <Input
              type="password"
              placeholder={systemInfo?.hasOpenAiKey ? "Using environment variable..." : "sk-..."}
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
            />
          </div>
        )}

        {/* Hyperparameters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Hyperparameters</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Epochs</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={epochs}
                onChange={(e) => setEpochs(parseInt(e.target.value) || 3)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Batch Size</Label>
              <Input
                type="number"
                min={1}
                max={64}
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value) || 2)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Learning Rate</Label>
              <Input
                type="number"
                step={0.00001}
                min={0.000001}
                value={learningRate}
                onChange={(e) => setLearningRate(parseFloat(e.target.value) || 0.0002)}
              />
            </div>
            {provider === "local" && method !== "full" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">LoRA Rank</Label>
                  <Input
                    type="number"
                    min={1}
                    max={256}
                    value={loraRank}
                    onChange={(e) => setLoraRank(parseInt(e.target.value) || 8)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">LoRA Alpha</Label>
                  <Input
                    type="number"
                    min={1}
                    max={512}
                    value={loraAlpha}
                    onChange={(e) => setLoraAlpha(parseInt(e.target.value) || 16)}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Start Button */}
        <Button
          onClick={handleStartTraining}
          disabled={trainMutation.isPending || !datasetId || !baseModelId || !name}
          className="w-full gap-2"
          size="lg"
        >
          {trainMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Start Training
        </Button>
      </div>

      {/* Right: System Info */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Info className="h-4 w-4" /> System Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {systemInfo ? (
              <>
                <InfoRow
                  label="GPU"
                  value={systemInfo.hasGPU ? `${systemInfo.gpuName} (${systemInfo.gpuVRAM} MB)` : "Not detected"}
                  ok={systemInfo.hasGPU}
                />
                <InfoRow label="Python" value={systemInfo.pythonVersion || "Not found"} ok={systemInfo.hasPython} />
                <InfoRow label="Transformers" value={systemInfo.hasTransformers ? "Installed" : "Missing"} ok={systemInfo.hasTransformers} />
                <InfoRow label="BitsAndBytes" value={systemInfo.hasBitsAndBytes ? "Installed" : "Missing"} ok={systemInfo.hasBitsAndBytes} />
                <InfoRow label="OpenAI Key" value={systemInfo.hasOpenAiKey ? "Available" : "Not set"} ok={systemInfo.hasOpenAiKey} />
                <div className="pt-2 border-t">
                  <Badge variant="secondary" className="text-xs">
                    Recommended: {systemInfo.recommendedMethod.toUpperCase()}
                  </Badge>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Detecting...
              </div>
            )}
          </CardContent>
        </Card>

        {selectedDataset && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Database className="h-4 w-4" /> Dataset Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium">{selectedDataset.name}</p>
              {selectedDataset.description && (
                <p className="text-xs text-muted-foreground">{selectedDataset.description}</p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Items:</span> {selectedDataset.itemCount}
                </div>
                <div>
                  <span className="text-muted-foreground">Type:</span> {selectedDataset.datasetType}
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span> {selectedDataset.publishStatus}
                </div>
                <div>
                  <span className="text-muted-foreground">Size:</span>{" "}
                  {((selectedDataset.totalBytes || 0) / (1024 * 1024)).toFixed(1)} MB
                </div>
              </div>
              {selectedDataset.tags && selectedDataset.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {(selectedDataset.tags as string[]).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-400" />
        )}
        <span className="text-xs">{value}</span>
      </span>
    </div>
  );
}

// ============================================================================
// PROGRESS TAB
// ============================================================================

function ProgressTab() {
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading } = useQuery<DatasetTrainingStatus[]>({
    queryKey: ["training-jobs"],
    queryFn: () => ipc.listDatasetTrainingJobs(),
    refetchInterval: 5000,
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => ipc.cancelDatasetTraining(jobId),
    onSuccess: () => {
      toast.success("Training cancelled");
      queryClient.invalidateQueries({ queryKey: ["training-jobs"] });
    },
    onError: (err: Error) => {
      toast.error(`Cancel failed: ${err.message}`);
    },
  });

  const activeJobs = jobs.filter(
    (j) => j.status === "preparing" || j.status === "uploading" || j.status === "queued" || j.status === "training",
  );
  const completedJobs = jobs.filter(
    (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled",
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading jobs...
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Clock className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">No training jobs yet</p>
        <p className="text-xs mt-1">Start a training job from the Train tab</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {activeJobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" /> Active ({activeJobs.length})
          </h3>
          {activeJobs.map((job) => (
            <TrainingJobCard key={job.jobId} job={job} onCancel={() => cancelMutation.mutate(job.jobId)} />
          ))}
        </div>
      )}

      {completedJobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">History ({completedJobs.length})</h3>
          {completedJobs.map((job) => (
            <TrainingJobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrainingJobCard({
  job,
  onCancel,
}: {
  job: DatasetTrainingStatus;
  onCancel?: () => void;
}) {
  const isActive = ["preparing", "uploading", "queued", "training"].includes(job.status);

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-medium text-sm">{job.name}</p>
            <p className="text-xs text-muted-foreground">
              {job.datasetName} → {job.baseModelId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(job.status)} className="text-xs">
              {job.provider === "openai" && <Cloud className="h-3 w-3 mr-1" />}
              {job.status}
            </Badge>
            {isActive && onCancel && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}>
                <Square className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {isActive && (
          <div className="space-y-1">
            <Progress value={job.progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {job.currentEpoch !== undefined && job.totalEpochs
                  ? `Epoch ${job.currentEpoch}/${job.totalEpochs}`
                  : `${Math.round(job.progress)}%`}
              </span>
              <span>
                {job.currentLoss !== undefined && `Loss: ${job.currentLoss.toFixed(4)}`}
              </span>
              <span>{job.itemsProcessed} items</span>
            </div>
          </div>
        )}

        {job.status === "failed" && job.error && (
          <p className="text-xs text-destructive mt-1">{job.error}</p>
        )}

        {job.status === "completed" && job.openAiModelId && (
          <p className="text-xs text-green-600 mt-1">Model: {job.openAiModelId}</p>
        )}
      </CardContent>
    </Card>
  );
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "training":
    case "uploading":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

// ============================================================================
// MODELS TAB
// ============================================================================

function ModelsTab() {
  const queryClient = useQueryClient();

  const { data: models = [], isLoading } = useQuery<TrainedModelInfo[]>({
    queryKey: ["trained-models"],
    queryFn: () => ipc.listTrainedModels(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading models...
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Cpu className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">No trained models yet</p>
        <p className="text-xs mt-1">Train a model to see it here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Trained Models ({models.length})</h3>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["trained-models"] })}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {models.map((model) => (
          <Card key={model.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-sm">{model.name}</CardTitle>
                  <CardDescription className="text-xs">
                    Base: {model.baseModelId}
                  </CardDescription>
                </div>
                <Badge variant={model.status === "completed" ? "secondary" : "outline"} className="text-xs">
                  {model.provider === "openai" && <Cloud className="h-3 w-3 mr-1" />}
                  {model.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">Method:</span>
                <Badge variant="outline" className="text-xs">{model.method}</Badge>
              </div>
              {model.datasetName && (
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">Dataset:</span>
                  <span>{model.datasetName}</span>
                </div>
              )}
              {model.openAiModelId && (
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">OpenAI Model:</span>
                  <span className="font-mono text-xs">{model.openAiModelId}</span>
                </div>
              )}
              {model.adapterPath && (
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">Adapter:</span>
                  <span className="truncate max-w-[200px] font-mono text-xs">{model.adapterPath}</span>
                </div>
              )}
              <div className="text-muted-foreground pt-1">
                {new Date(model.createdAt).toLocaleDateString()}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
