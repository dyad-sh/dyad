import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Brain,
  Plus,
  Trash2,
  Play,
  Square,
  ChevronUp,
  ChevronDown,
  BarChart3,
  Layers,
  Cpu,
  Zap,
  GitCompare,
  Download,
  Settings2,
  RefreshCw,
  Check,
  AlertTriangle,
  Loader2,
  Sparkles,
  Upload,
  Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

// ── Types (mirrored from handler) ─────────────────────────────────────────────

type NNLayerType =
  | "dense" | "conv2d" | "maxpool2d" | "dropout" | "flatten"
  | "lstm" | "gru" | "attention" | "embedding" | "batch-norm"
  | "activation" | "reshape" | "concat";

interface NNLayer {
  id: string;
  type: NNLayerType;
  name: string;
  params: Record<string, number | string | boolean>;
  position: number;
}

interface TrainingConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  optimizer: "adam" | "sgd" | "rmsprop" | "adamw" | "adagrad";
  lossFunction: string;
  metrics: string[];
  validationSplit: number;
  earlyStoppingPatience: number;
  enableMixedPrecision: boolean;
  warmupSteps: number;
  weightDecay: number;
}

interface NeuralNetwork {
  id: string;
  name: string;
  description: string;
  taskType: string;
  inputShape: number[];
  outputShape: number[];
  layers: NNLayer[];
  trainingConfig: TrainingConfig;
  transferLearning?: { baseModel: string; baseModelName: string; frozenLayers: number };
  edgeDeployment?: { enabled: boolean; targetDevice: string; quantization: string };
  status: "draft" | "training" | "trained" | "deploying" | "deployed" | "failed";
  accuracy?: number;
  loss?: number;
  valAccuracy?: number;
  valLoss?: number;
  totalParams?: number;
  trainedAt?: number;
  deployedAt?: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

interface PretrainedModel {
  id: string;
  name: string;
  task: string;
  params: string;
  size: string;
  source: string;
  description: string;
  license: string;
  inputShape?: number[];
}

interface ModelVersion {
  id: string;
  networkId: string;
  version: string;
  accuracy: number;
  loss: number;
  valAccuracy: number;
  valLoss: number;
  notes: string;
  createdAt: number;
}

interface ABTest {
  id: string;
  name: string;
  modelAId: string;
  modelAName: string;
  modelBId: string;
  modelBName: string;
  metric: string;
  status: string;
  results?: {
    modelA: number;
    modelB: number;
    winner: string;
    winnerModelId: string;
    improvement: number;
  };
  notes: string;
  createdAt: number;
}

interface TrainingProgress {
  id: string;
  epoch: number;
  totalEpochs: number;
  accuracy: number;
  loss: number;
  valAccuracy: number;
  valLoss: number;
  percentage: number;
  eta: number;
}

// ── IPC helpers ───────────────────────────────────────────────────────────────

const ipc = (channel: string, ...args: unknown[]) =>
  window.electron.ipcRenderer.invoke(channel as never, ...args);

const LAYER_TYPES: { value: NNLayerType; label: string }[] = [
  { value: "dense", label: "Dense (Fully Connected)" },
  { value: "conv2d", label: "Conv2D" },
  { value: "maxpool2d", label: "MaxPooling2D" },
  { value: "lstm", label: "LSTM" },
  { value: "gru", label: "GRU" },
  { value: "attention", label: "Attention" },
  { value: "embedding", label: "Embedding" },
  { value: "dropout", label: "Dropout" },
  { value: "batch-norm", label: "Batch Normalization" },
  { value: "flatten", label: "Flatten" },
  { value: "activation", label: "Activation" },
  { value: "reshape", label: "Reshape" },
  { value: "concat", label: "Concatenate" },
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/15 text-zinc-400",
  training: "bg-blue-500/15 text-blue-400",
  trained: "bg-emerald-500/15 text-emerald-400",
  deploying: "bg-amber-500/15 text-amber-400",
  deployed: "bg-purple-500/15 text-purple-400",
  failed: "bg-red-500/15 text-red-400",
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function NeuralBuilderPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState<Record<string, TrainingProgress>>({});
  const [automlProgress, setAutomlProgress] = useState<{ step: string; percentage: number } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  // Integration state
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedAppId, setSelectedAppId] = useState<string>("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [exportFormat, setExportFormat] = useState<string>("onnx");

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: networks = [], isLoading } = useQuery<NeuralNetwork[]>({
    queryKey: ["neural:networks"],
    queryFn: () => ipc("neural:list-networks"),
  });

  const { data: pretrained = [] } = useQuery<PretrainedModel[]>({
    queryKey: ["neural:pretrained"],
    queryFn: () => ipc("neural:list-pretrained-models"),
  });

  const selectedNetwork = networks.find((n) => n.id === selectedNetworkId) ?? null;

  const { data: versions = [] } = useQuery<ModelVersion[]>({
    queryKey: ["neural:versions", selectedNetworkId],
    queryFn: () => ipc("neural:list-versions", selectedNetworkId),
    enabled: !!selectedNetworkId,
  });

  const { data: abTests = [] } = useQuery<ABTest[]>({
    queryKey: ["neural:ab-tests"],
    queryFn: () => ipc("neural:list-ab-tests"),
  });

  const { data: analytics } = useQuery({
    queryKey: ["neural:analytics", selectedNetworkId],
    queryFn: () => ipc("neural:get-analytics", selectedNetworkId),
    enabled: !!selectedNetworkId && selectedNetwork?.status === "trained",
  });

  // Integration data queries
  const { data: agents = [] } = useQuery({
    queryKey: ["agent:list"],
    queryFn: () => ipc("agent:list"),
  });

  const { data: apps = [] } = useQuery({
    queryKey: ["app:list"],
    queryFn: () => ipc("app:list"),
  });

  const { data: datasets = [] } = useQuery({
    queryKey: ["dataset-studio:list-datasets"],
    queryFn: () => ipc("dataset-studio:list-datasets"),
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidateNetworks = () => qc.invalidateQueries({ queryKey: ["neural:networks"] });

  const createNetwork = useMutation({
    mutationFn: (params: { name: string; description: string; taskType: string }) =>
      ipc("neural:create-network", params),
    onSuccess: (net: NeuralNetwork) => {
      invalidateNetworks();
      setSelectedNetworkId(net.id);
      toast.success(`Network "${net.name}" created`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteNetwork = useMutation({
    mutationFn: (id: string) => ipc("neural:delete-network", id),
    onSuccess: () => { invalidateNetworks(); setSelectedNetworkId(null); toast.success("Network deleted"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateNetwork = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<NeuralNetwork> }) =>
      ipc("neural:update-network", id, updates),
    onSuccess: () => invalidateNetworks(),
    onError: (err: Error) => toast.error(err.message),
  });

  const startTraining = useMutation({
    mutationFn: (id: string) => ipc("neural:start-training", id),
    onSuccess: (_, id) => {
      invalidateNetworks();
      setLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] Training started for ${id}`]);
      toast.success("Training started");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stopTraining = useMutation({
    mutationFn: (id: string) => ipc("neural:stop-training", id),
    onSuccess: () => { invalidateNetworks(); toast.info("Training stopped"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const addLayer = useMutation({
    mutationFn: ({ networkId, type }: { networkId: string; type: NNLayerType }) =>
      ipc("neural:add-layer", networkId, type),
    onSuccess: () => invalidateNetworks(),
    onError: (err: Error) => toast.error(err.message),
  });

  const removeLayer = useMutation({
    mutationFn: ({ networkId, layerId }: { networkId: string; layerId: string }) =>
      ipc("neural:remove-layer", networkId, layerId),
    onSuccess: () => invalidateNetworks(),
    onError: (err: Error) => toast.error(err.message),
  });

  const reorderLayer = useMutation({
    mutationFn: ({ networkId, layerIds }: { networkId: string; layerIds: string[] }) =>
      ipc("neural:reorder-layers", networkId, layerIds),
    onSuccess: () => invalidateNetworks(),
  });

  const createVersion = useMutation({
    mutationFn: ({ networkId, notes }: { networkId: string; notes: string }) =>
      ipc("neural:create-version", networkId, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["neural:versions", selectedNetworkId] });
      toast.success("Version checkpoint saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rollbackVersion = useMutation({
    mutationFn: ({ networkId, versionId }: { networkId: string; versionId: string }) =>
      ipc("neural:rollback-version", networkId, versionId),
    onSuccess: (res: { rolledBackTo: string }) => {
      invalidateNetworks();
      qc.invalidateQueries({ queryKey: ["neural:versions", selectedNetworkId] });
      toast.success(`Rolled back to ${res.rolledBackTo}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createABTest = useMutation({
    mutationFn: (params: { name: string; modelAId: string; modelBId: string; metric: string; notes: string }) =>
      ipc("neural:create-ab-test", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["neural:ab-tests"] });
      toast.success("A/B test created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteABTest = useMutation({
    mutationFn: (id: string) => ipc("neural:delete-ab-test", id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["neural:ab-tests"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const applyTransferLearning = useMutation({
    mutationFn: ({ networkId, baseModelId, frozenLayers }: { networkId: string; baseModelId: string; frozenLayers: number }) =>
      ipc("neural:apply-transfer-learning", networkId, baseModelId, frozenLayers),
    onSuccess: () => { invalidateNetworks(); toast.success("Transfer learning applied"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const runAutoml = useMutation({
    mutationFn: (networkId: string) => ipc("neural:automl-optimize", networkId),
    onSuccess: () => toast.info("AutoML optimization running…"),
    onError: (err: Error) => toast.error(err.message),
  });

  const configureEdgeDeploy = useMutation({
    mutationFn: ({ networkId, config }: { networkId: string; config: { targetDevice: string; quantization: string; enabled: boolean } }) =>
      ipc("neural:configure-edge-deployment", networkId, config),
    onSuccess: () => { invalidateNetworks(); toast.success("Edge deployment configured"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deployToEdge = useMutation({
    mutationFn: (networkId: string) => ipc("neural:deploy-to-edge", networkId),
    onSuccess: () => { invalidateNetworks(); toast.success("Deployed to edge device"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const exportModel = useMutation({
    mutationFn: ({ networkId, format }: { networkId: string; format: string }) =>
      ipc("neural:export-model", networkId, format),
    onSuccess: (res: { path: string; format: string }) =>
      toast.success(`Exported as ${res.format.toUpperCase()} to ${res.path}`),
    onError: (err: Error) => toast.error(err.message),
  });

  // Integration mutations
  const attachToAgent = useMutation({
    mutationFn: ({ networkId, agentId }: { networkId: string; agentId: string }) =>
      ipc("neural:attach-to-agent", networkId, agentId),
    onSuccess: () => { invalidateNetworks(); toast.success("Model attached to agent"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const integrateWithApp = useMutation({
    mutationFn: ({ networkId, appId }: { networkId: string; appId: string }) =>
      ipc("neural:integrate-with-app", networkId, appId),
    onSuccess: () => { invalidateNetworks(); toast.success("Model integrated with app"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const linkDataset = useMutation({
    mutationFn: ({ networkId, datasetId }: { networkId: string; datasetId: string }) =>
      ipc("neural:link-dataset", networkId, datasetId),
    onSuccess: () => { invalidateNetworks(); toast.success("Dataset linked to network"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deployToCelestia = useMutation({
    mutationFn: async (networkId: string) => {
      // Export model as JSON, then import to library, then store on Celestia
      const exported = await ipc("neural:export-model", networkId, exportFormat) as { path: string; format: string; sizeMB: number };
      // Read exported file and import to library
      const fs = window.electron?.ipcRenderer;
      const name = `${selectedNetwork?.name || "model"}_${exportFormat}.${exportFormat}`;
      // Use the export path to submit to Celestia via file path
      const blobResult = await ipc("celestia:blob:submit-file", {
        filePath: exported.path,
        label: name,
        dataType: `neural-model/${exportFormat}`,
      });
      return blobResult;
    },
    onSuccess: (result: any) => {
      invalidateNetworks();
      toast.success(`Model deployed to Celestia DA — block ${result?.height || "pending"}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const publishToMarketplace = useMutation({
    mutationFn: (networkId: string) =>
      ipc("neural:publish-to-marketplace", networkId),
    onSuccess: () => { invalidateNetworks(); toast.success("Model published to marketplace"); },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── IPC event listeners ────────────────────────────────────────────────────

  useEffect(() => {
    const onProgress = (_: unknown, data: TrainingProgress) => {
      setTrainingProgress((prev) => ({ ...prev, [data.id]: data }));
      setLogs((l) => [
        ...l.slice(-199),
        `[${new Date().toLocaleTimeString()}] Epoch ${data.epoch}/${data.totalEpochs} — acc: ${(data.accuracy * 100).toFixed(2)}% — loss: ${data.loss.toFixed(4)} — ETA: ${data.eta}s`,
      ]);
    };
    const onComplete = (_: unknown, data: { id: string }) => {
      setTrainingProgress((prev) => { const n = { ...prev }; delete n[data.id]; return n; });
      invalidateNetworks();
      qc.invalidateQueries({ queryKey: ["neural:analytics", data.id] });
      toast.success("Training complete!");
    };
    const onAutomlProgress = (_: unknown, data: { step: string; percentage: number }) => {
      setAutomlProgress(data);
    };
    const onAutomlComplete = (_: unknown, data: { config: Record<string, unknown> }) => {
      setAutomlProgress(null);
      invalidateNetworks();
      toast.success("AutoML optimization complete");
      console.log("AutoML config:", data.config);
    };

    window.electron.ipcRenderer.on("neural:training-progress" as never, onProgress);
    window.electron.ipcRenderer.on("neural:training-complete" as never, onComplete);
    window.electron.ipcRenderer.on("neural:automl-progress" as never, onAutomlProgress);
    window.electron.ipcRenderer.on("neural:automl-complete" as never, onAutomlComplete);

    return () => {
      window.electron.ipcRenderer.removeListener("neural:training-progress" as never, onProgress);
      window.electron.ipcRenderer.removeListener("neural:training-complete" as never, onComplete);
      window.electron.ipcRenderer.removeListener("neural:automl-progress" as never, onAutomlProgress);
      window.electron.ipcRenderer.removeListener("neural:automl-complete" as never, onAutomlComplete);
    };
  }, []);

  // Auto-select first network
  useEffect(() => {
    if (!selectedNetworkId && networks.length > 0) setSelectedNetworkId(networks[0].id);
  }, [networks, selectedNetworkId]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const prog = selectedNetworkId ? trainingProgress[selectedNetworkId] : undefined;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-background/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 shadow-sm">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">Neural Builder</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Design, train, and deploy neural networks</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowNewDialog(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> New Network
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-6 mt-4 mb-0 shrink-0 w-fit">
          <TabsTrigger value="overview"><Layers className="w-3.5 h-3.5 mr-1.5" />Overview</TabsTrigger>
          <TabsTrigger value="designer"><Settings2 className="w-3.5 h-3.5 mr-1.5" />Designer</TabsTrigger>
          <TabsTrigger value="training"><Play className="w-3.5 h-3.5 mr-1.5" />Training</TabsTrigger>
          <TabsTrigger value="transfer"><Upload className="w-3.5 h-3.5 mr-1.5" />Transfer Learning</TabsTrigger>
          <TabsTrigger value="abtests"><GitCompare className="w-3.5 h-3.5 mr-1.5" />A/B Tests</TabsTrigger>
          <TabsTrigger value="analytics"><BarChart3 className="w-3.5 h-3.5 mr-1.5" />Analytics</TabsTrigger>
          <TabsTrigger value="edge"><Cpu className="w-3.5 h-3.5 mr-1.5" />Edge Deploy</TabsTrigger>
          <TabsTrigger value="integrations"><Plug className="w-3.5 h-3.5 mr-1.5" />Integrations</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 px-6 py-4">

          {/* ── Overview ─────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-0 space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : networks.length === 0 ? (
              <EmptyState icon={Brain} title="No neural networks yet"
                description="Create your first network to get started"
                action={<Button onClick={() => setShowNewDialog(true)}><Plus className="w-3.5 h-3.5 mr-1.5" />New Network</Button>} />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {networks.map((net) => (
                  <NetworkCard
                    key={net.id}
                    network={net}
                    progress={trainingProgress[net.id]}
                    selected={net.id === selectedNetworkId}
                    onSelect={() => { setSelectedNetworkId(net.id); setActiveTab("designer"); }}
                    onTrain={() => { setSelectedNetworkId(net.id); setActiveTab("training"); }}
                    onDelete={() => deleteNetwork.mutate(net.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Designer ─────────────────────────────────────────────────── */}
          <TabsContent value="designer" className="mt-0 space-y-4">
            <NetworkSelector networks={networks} selectedId={selectedNetworkId} onSelect={setSelectedNetworkId} />
            {selectedNetwork ? (
              <DesignerPanel
                network={selectedNetwork}
                onAddLayer={(type) => addLayer.mutate({ networkId: selectedNetwork.id, type })}
                onRemoveLayer={(layerId) => removeLayer.mutate({ networkId: selectedNetwork.id, layerId })}
                onMoveLayer={(layerIds) => reorderLayer.mutate({ networkId: selectedNetwork.id, layerIds })}
              />
            ) : (
              <EmptyState icon={Layers} title="Select a network" description="Choose a network above to edit its architecture" />
            )}
          </TabsContent>

          {/* ── Training ─────────────────────────────────────────────────── */}
          <TabsContent value="training" className="mt-0 space-y-4">
            <NetworkSelector networks={networks} selectedId={selectedNetworkId} onSelect={setSelectedNetworkId} />
            {selectedNetwork ? (
              <TrainingPanel
                network={selectedNetwork}
                progress={prog}
                automlProgress={automlProgress}
                logs={logs}
                onStart={() => startTraining.mutate(selectedNetwork.id)}
                onStop={() => stopTraining.mutate(selectedNetwork.id)}
                onAutoml={() => runAutoml.mutate(selectedNetwork.id)}
                onUpdateConfig={(cfg) => updateNetwork.mutate({ id: selectedNetwork.id, updates: { trainingConfig: cfg } })}
                onCreateVersion={(notes) => createVersion.mutate({ networkId: selectedNetwork.id, notes })}
                isStarting={startTraining.isPending}
                isStopping={stopTraining.isPending}
              />
            ) : (
              <EmptyState icon={Play} title="Select a network" description="Choose a network above to configure training" />
            )}
          </TabsContent>

          {/* ── Transfer Learning ─────────────────────────────────────────── */}
          <TabsContent value="transfer" className="mt-0 space-y-4">
            <NetworkSelector networks={networks} selectedId={selectedNetworkId} onSelect={setSelectedNetworkId} />
            {selectedNetwork && (
              <>
                {selectedNetwork.transferLearning && (
                  <Card className="border-purple-500/30 bg-purple-500/5">
                    <CardContent className="pt-4 flex items-center gap-3">
                      <Check className="w-4 h-4 text-purple-400" />
                      <span className="text-sm">Using <strong>{selectedNetwork.transferLearning.baseModelName}</strong> — {selectedNetwork.transferLearning.frozenLayers} layers frozen</span>
                    </CardContent>
                  </Card>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {pretrained.map((model) => (
                    <PretrainedModelCard
                      key={model.id}
                      model={model}
                      applied={selectedNetwork.transferLearning?.baseModel === model.id}
                      onApply={() => applyTransferLearning.mutate({
                        networkId: selectedNetwork.id,
                        baseModelId: model.id,
                        frozenLayers: 10,
                      })}
                    />
                  ))}
                </div>
              </>
            )}
            {!selectedNetwork && <EmptyState icon={Upload} title="Select a network" description="Choose a network to apply transfer learning" />}
          </TabsContent>

          {/* ── A/B Tests ─────────────────────────────────────────────────── */}
          <TabsContent value="abtests" className="mt-0 space-y-4">
            <ABTestsPanel
              networks={networks}
              tests={abTests}
              onCreate={(params) => createABTest.mutate(params)}
              onDelete={(id) => deleteABTest.mutate(id)}
            />
          </TabsContent>

          {/* ── Analytics ───────────────────────────────────────────────── */}
          <TabsContent value="analytics" className="mt-0 space-y-4">
            <NetworkSelector networks={networks} selectedId={selectedNetworkId} onSelect={setSelectedNetworkId} />
            {analytics ? (
              <AnalyticsPanel analytics={analytics} versions={versions} />
            ) : selectedNetwork?.status !== "trained" ? (
              <EmptyState icon={BarChart3} title="Train the network first" description="Analytics are available after training completes" />
            ) : (
              <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            )}
          </TabsContent>

          {/* ── Edge Deploy ───────────────────────────────────────────────── */}
          <TabsContent value="edge" className="mt-0 space-y-4">
            <NetworkSelector networks={networks} selectedId={selectedNetworkId} onSelect={setSelectedNetworkId} />
            {selectedNetwork ? (
              <EdgeDeployPanel
                network={selectedNetwork}
                onConfigure={(config) => configureEdgeDeploy.mutate({ networkId: selectedNetwork.id, config })}
                onDeploy={() => deployToEdge.mutate(selectedNetwork.id)}
                onExport={(format) => exportModel.mutate({ networkId: selectedNetwork.id, format })}
                isDeploying={deployToEdge.isPending}
              />
            ) : (
              <EmptyState icon={Cpu} title="Select a network" description="Choose a trained network to deploy to edge" />
            )}
          </TabsContent>

          {/* ── Integrations ─────────────────────────────────────────────────────────────────────────────────── */}
          <TabsContent value="integrations" className="mt-0 space-y-4">
            <NetworkSelector networks={networks} selectedId={selectedNetworkId} onSelect={setSelectedNetworkId} />
            {selectedNetwork ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Connect to Agent Card */}
                <Card className="border-blue-500/30 bg-blue-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Connect to Agent</CardTitle>
                    <CardDescription className="text-xs">Deploy this model as the AI backbone for a JoyCreate agent</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Select Agent</Label>
                      <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Choose agent..." />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.length === 0 ? (
                            <SelectItem value="none" className="text-xs" disabled>No agents found</SelectItem>
                          ) : (
                            agents.map((agent: any) => (
                              <SelectItem key={agent.id} value={agent.id} className="text-xs">
                                {agent.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      size="sm" 
                      className="h-7 text-xs w-full" 
                      disabled={!selectedAgentId || !selectedNetwork || attachToAgent.isPending}
                      onClick={() => selectedNetwork && selectedAgentId && attachToAgent.mutate({ networkId: selectedNetwork.id, agentId: selectedAgentId })}
                    >
                      {attachToAgent.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plug className="w-3.5 h-3.5 mr-1.5" />}
                      Attach Model
                    </Button>
                  </CardContent>
                </Card>

                {/* Connect to App Card */}
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Connect to App</CardTitle>
                    <CardDescription className="text-xs">Add this model's inference endpoint to a JoyCreate application</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Select App</Label>
                      <Select value={selectedAppId} onValueChange={setSelectedAppId}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Choose app..." />
                        </SelectTrigger>
                        <SelectContent>
                          {apps.length === 0 ? (
                            <SelectItem value="none" className="text-xs" disabled>No apps found</SelectItem>
                          ) : (
                            apps.map((app: any) => (
                              <SelectItem key={app.id} value={app.id} className="text-xs">
                                {app.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      size="sm" 
                      className="h-7 text-xs w-full" 
                      disabled={!selectedAppId || !selectedNetwork || integrateWithApp.isPending}
                      onClick={() => selectedNetwork && selectedAppId && integrateWithApp.mutate({ networkId: selectedNetwork.id, appId: selectedAppId })}
                    >
                      {integrateWithApp.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
                      Integrate with App
                    </Button>
                  </CardContent>
                </Card>

                {/* Link Dataset Card */}
                <Card className="border-purple-500/30 bg-purple-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Link Dataset</CardTitle>
                    <CardDescription className="text-xs">Use a dataset from Dataset Studio for training data</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Select Dataset</Label>
                      <Select value={selectedDatasetId} onValueChange={setSelectedDatasetId}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Choose dataset..." />
                        </SelectTrigger>
                        <SelectContent>
                          {datasets.length === 0 ? (
                            <SelectItem value="none" className="text-xs" disabled>No datasets found</SelectItem>
                          ) : (
                            datasets.map((dataset: any) => (
                              <SelectItem key={dataset.id} value={dataset.id} className="text-xs">
                                {dataset.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      size="sm" 
                      className="h-7 text-xs w-full" 
                      disabled={!selectedDatasetId || !selectedNetwork || linkDataset.isPending}
                      onClick={() => selectedNetwork && selectedDatasetId && linkDataset.mutate({ networkId: selectedNetwork.id, datasetId: selectedDatasetId })}
                    >
                      {linkDataset.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                      Link Dataset
                    </Button>
                  </CardContent>
                </Card>

                {/* Export & Deploy Card */}
                <Card className="border-orange-500/30 bg-orange-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Export & Deploy</CardTitle>
                    <CardDescription className="text-xs">Export your model or publish it to the marketplace</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Export Format</Label>
                      <Select value={exportFormat} onValueChange={setExportFormat}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="onnx" className="text-xs">ONNX</SelectItem>
                          <SelectItem value="tflite" className="text-xs">TensorFlow Lite</SelectItem>
                          <SelectItem value="torchscript" className="text-xs">TorchScript</SelectItem>
                          <SelectItem value="savedmodel" className="text-xs">SavedModel</SelectItem>
                          <SelectItem value="json" className="text-xs">JSON</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        className="h-7 text-xs flex-1" 
                        disabled={!selectedNetwork || deployToCelestia.isPending}
                        onClick={() => selectedNetwork && deployToCelestia.mutate(selectedNetwork.id)}
                      >
                        {deployToCelestia.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                        Deploy to Celestia
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="h-7 text-xs flex-1" 
                        disabled={!selectedNetwork || publishToMarketplace.isPending}
                        onClick={() => selectedNetwork && publishToMarketplace.mutate(selectedNetwork.id)}
                      >
                        {publishToMarketplace.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
                        Publish to Marketplace
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <EmptyState icon={Plug} title="Select a network" description="Choose a network to configure integrations" />
            )}
          </TabsContent>

        </ScrollArea>
      </Tabs>

      {/* New Network Dialog */}
      <NewNetworkDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onCreate={(params) => { createNetwork.mutate(params); setShowNewDialog(false); }}
        isPending={createNetwork.isPending}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ElementType; title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      {action}
    </div>
  );
}

function NetworkSelector({ networks, selectedId, onSelect }: {
  networks: NeuralNetwork[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground shrink-0">Network:</Label>
      <Select value={selectedId ?? ""} onValueChange={onSelect}>
        <SelectTrigger className="h-8 text-xs max-w-xs">
          <SelectValue placeholder="Select a network…" />
        </SelectTrigger>
        <SelectContent>
          {networks.map((n) => (
            <SelectItem key={n.id} value={n.id} className="text-xs">{n.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NetworkCard({ network, progress, selected, onSelect, onTrain, onDelete }: {
  network: NeuralNetwork;
  progress?: TrainingProgress;
  selected: boolean;
  onSelect: () => void;
  onTrain: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={`transition-all cursor-pointer ${selected ? "border-purple-500/50 ring-1 ring-purple-500/30" : "hover:border-border"}`}
      onClick={onSelect}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{network.name}</CardTitle>
            {network.description && <CardDescription className="text-xs mt-0.5 line-clamp-2">{network.description}</CardDescription>}
          </div>
          <Badge className={`text-[10px] shrink-0 ${STATUS_COLORS[network.status] ?? ""}`} variant="outline">
            {network.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div><span className="font-medium text-foreground">{network.layers.length}</span> layers</div>
          <div><span className="font-medium text-foreground">{network.taskType}</span></div>
          {network.accuracy !== undefined && (
            <div><span className="font-medium text-emerald-400">{(network.accuracy * 100).toFixed(1)}%</span> accuracy</div>
          )}
          {network.totalParams !== undefined && (
            <div><span className="font-medium text-foreground">{(network.totalParams / 1000).toFixed(1)}K</span> params</div>
          )}
        </div>
        {progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Epoch {progress.epoch}/{progress.totalEpochs}</span>
              <span>{progress.percentage}%</span>
            </div>
            <Progress value={progress.percentage} className="h-1" />
          </div>
        )}
        <div className="flex gap-1.5 pt-1">
          <Button size="sm" variant="outline" className="h-6 text-[10px] flex-1" onClick={(e) => { e.stopPropagation(); onTrain(); }}>
            <Play className="w-3 h-3 mr-1" />Train
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DesignerPanel({ network, onAddLayer, onRemoveLayer, onMoveLayer }: {
  network: NeuralNetwork;
  onAddLayer: (type: NNLayerType) => void;
  onRemoveLayer: (id: string) => void;
  onMoveLayer: (ids: string[]) => void;
}) {
  const [newLayerType, setNewLayerType] = useState<NNLayerType>("dense");

  const move = (idx: number, dir: -1 | 1) => {
    const ids = [...network.layers].sort((a, b) => a.position - b.position).map((l) => l.id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    onMoveLayer(ids);
  };

  const sorted = [...network.layers].sort((a, b) => a.position - b.position);
  const totalParams = sorted.reduce((acc, l) => {
    const u = (l.params.units as number) || (l.params.filters as number) || 64;
    if (l.type === "dense") return acc + u * 128 + u;
    if (l.type === "conv2d") return acc + u * 9 + u;
    return acc + Math.max(u, 1);
  }, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{sorted.length}</span> layers · <span className="font-medium text-foreground">~{(totalParams / 1000).toFixed(1)}K</span> parameters
        </div>
        <div className="flex items-center gap-2">
          <Select value={newLayerType} onValueChange={(v) => setNewLayerType(v as NNLayerType)}>
            <SelectTrigger className="h-7 text-xs w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAYER_TYPES.map((lt) => (
                <SelectItem key={lt.value} value={lt.value} className="text-xs">{lt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 text-xs" onClick={() => onAddLayer(newLayerType)}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Layer
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {sorted.map((layer, idx) => (
          <div key={layer.id} className="flex items-center gap-2 p-3 rounded-lg border border-border/60 bg-card hover:border-border transition-colors">
            <div className="flex flex-col gap-0.5">
              <Button variant="ghost" size="sm" className="h-4 w-4 p-0" disabled={idx === 0} onClick={() => move(idx, -1)}>
                <ChevronUp className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-4 w-4 p-0" disabled={idx === sorted.length - 1} onClick={() => move(idx, 1)}>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </div>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">{idx}</Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{layer.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{layer.type}</p>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono hidden md:block truncate max-w-[200px]">
              {Object.entries(layer.params).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(", ")}
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive shrink-0" onClick={() => onRemoveLayer(layer.id)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrainingPanel({ network, progress, automlProgress, logs, onStart, onStop, onAutoml, onUpdateConfig, onCreateVersion, isStarting, isStopping }: {
  network: NeuralNetwork;
  progress?: TrainingProgress;
  automlProgress: { step: string; percentage: number } | null;
  logs: string[];
  onStart: () => void;
  onStop: () => void;
  onAutoml: () => void;
  onUpdateConfig: (cfg: TrainingConfig) => void;
  onCreateVersion: (notes: string) => void;
  isStarting: boolean;
  isStopping: boolean;
}) {
  const cfg = network.trainingConfig;
  const isTraining = network.status === "training";
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* Config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Training Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Epochs</Label>
              <Input type="number" className="h-7 text-xs" value={cfg.epochs}
                onChange={(e) => onUpdateConfig({ ...cfg, epochs: +e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Batch Size</Label>
              <Input type="number" className="h-7 text-xs" value={cfg.batchSize}
                onChange={(e) => onUpdateConfig({ ...cfg, batchSize: +e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Learning Rate</Label>
              <Input type="number" step="0.0001" className="h-7 text-xs" value={cfg.learningRate}
                onChange={(e) => onUpdateConfig({ ...cfg, learningRate: +e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Optimizer</Label>
              <Select value={cfg.optimizer} onValueChange={(v) => onUpdateConfig({ ...cfg, optimizer: v as TrainingConfig["optimizer"] })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["adam", "sgd", "rmsprop", "adamw", "adagrad"].map((o) => (
                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Validation Split</Label>
              <Input type="number" step="0.05" min="0" max="0.5" className="h-7 text-xs" value={cfg.validationSplit}
                onChange={(e) => onUpdateConfig({ ...cfg, validationSplit: +e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Early Stop Patience</Label>
              <Input type="number" className="h-7 text-xs" value={cfg.earlyStoppingPatience}
                onChange={(e) => onUpdateConfig({ ...cfg, earlyStoppingPatience: +e.target.value })} />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <Label className="text-xs">Mixed Precision (FP16)</Label>
            <Switch checked={cfg.enableMixedPrecision}
              onCheckedChange={(v) => onUpdateConfig({ ...cfg, enableMixedPrecision: v })} />
          </div>
          <Separator />
          <div className="flex gap-2 flex-wrap">
            {isTraining ? (
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={onStop} disabled={isStopping}>
                {isStopping ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Square className="w-3 h-3 mr-1.5" />}Stop Training
              </Button>
            ) : (
              <Button size="sm" className="h-7 text-xs bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90" onClick={onStart} disabled={isStarting}>
                {isStarting ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Play className="w-3 h-3 mr-1.5" />}Start Training
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAutoml} disabled={isTraining}>
              <Sparkles className="w-3 h-3 mr-1.5" />AutoML
            </Button>
            {network.status === "trained" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onCreateVersion("")}>
                <RefreshCw className="w-3 h-3 mr-1.5" />Save Version
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Progress + logs */}
      <div className="space-y-4">
        {progress && (
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="pt-4 space-y-3">
              <div className="flex justify-between text-xs">
                <span className="font-medium">Epoch {progress.epoch} / {progress.totalEpochs}</span>
                <span className="text-muted-foreground">ETA: {progress.eta}s</span>
              </div>
              <Progress value={progress.percentage} className="h-2" />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-card rounded p-2">
                  <p className="text-muted-foreground">Train Accuracy</p>
                  <p className="font-mono font-medium text-emerald-400">{(progress.accuracy * 100).toFixed(2)}%</p>
                </div>
                <div className="bg-card rounded p-2">
                  <p className="text-muted-foreground">Val Accuracy</p>
                  <p className="font-mono font-medium text-blue-400">{(progress.valAccuracy * 100).toFixed(2)}%</p>
                </div>
                <div className="bg-card rounded p-2">
                  <p className="text-muted-foreground">Train Loss</p>
                  <p className="font-mono font-medium">{progress.loss.toFixed(4)}</p>
                </div>
                <div className="bg-card rounded p-2">
                  <p className="text-muted-foreground">Val Loss</p>
                  <p className="font-mono font-medium">{progress.valLoss.toFixed(4)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {automlProgress && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>{automlProgress.step}</span>
              </div>
              <Progress value={automlProgress.percentage} className="h-1.5" />
            </CardContent>
          </Card>
        )}
        {network.accuracy !== undefined && !progress && (
          <Card>
            <CardContent className="pt-4 grid grid-cols-2 gap-2 text-xs">
              <Metric label="Accuracy" value={`${(network.accuracy * 100).toFixed(2)}%`} color="text-emerald-400" />
              <Metric label="Loss" value={network.loss?.toFixed(4) ?? "—"} />
              <Metric label="Val Accuracy" value={network.valAccuracy ? `${(network.valAccuracy * 100).toFixed(2)}%` : "—"} color="text-blue-400" />
              <Metric label="Val Loss" value={network.valLoss?.toFixed(4) ?? "—"} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Training Log</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-48 font-mono p-3">
              {logs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No log entries yet</p>
              ) : (
                logs.map((l, i) => <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">{l}</p>)
              )}
              <div ref={logsEndRef} />
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, color = "" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-muted/50 rounded p-2">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className={`font-mono font-medium text-sm ${color}`}>{value}</p>
    </div>
  );
}

function PretrainedModelCard({ model, applied, onApply }: {
  model: PretrainedModel; applied: boolean; onApply: () => void;
}) {
  const TASK_COLORS: Record<string, string> = {
    "image-classification": "text-blue-400",
    "nlp": "text-purple-400",
    "text-generation": "text-pink-400",
    "audio": "text-amber-400",
    "multi-modal": "text-emerald-400",
    "object-detection": "text-orange-400",
  };

  return (
    <Card className={applied ? "border-purple-500/50 bg-purple-500/5" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{model.name}</CardTitle>
          {applied && <Badge className="text-[10px] bg-purple-500/15 text-purple-400" variant="outline">Applied</Badge>}
        </div>
        <p className={`text-[10px] font-medium ${TASK_COLORS[model.task] ?? "text-muted-foreground"}`}>{model.task}</p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <p className="text-xs text-muted-foreground line-clamp-2">{model.description}</p>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span><span className="font-medium text-foreground">{model.params}</span> params</span>
          <span><span className="font-medium text-foreground">{model.size}</span></span>
          <span className="text-muted-foreground/60">{model.license}</span>
        </div>
        <Button size="sm" className="h-6 text-[10px] w-full" variant={applied ? "outline" : "default"} onClick={onApply} disabled={applied}>
          {applied ? "Currently applied" : "Apply to Network"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ABTestsPanel({ networks, tests, onCreate, onDelete }: {
  networks: NeuralNetwork[];
  tests: ABTest[];
  onCreate: (params: { name: string; modelAId: string; modelBId: string; metric: string; notes: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState({ name: "", modelAId: "", modelBId: "", metric: "accuracy", notes: "" });
  const trained = networks.filter((n) => n.status === "trained" || n.status === "deployed");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">New A/B Test</CardTitle>
          <CardDescription className="text-xs">Compare two trained networks on a specific metric</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Test Name</Label>
              <Input className="h-7 text-xs" placeholder="e.g. ResNet vs MobileNet accuracy" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Model A</Label>
              <Select value={form.modelAId} onValueChange={(v) => setForm((f) => ({ ...f, modelAId: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select model…" /></SelectTrigger>
                <SelectContent>{trained.map((n) => <SelectItem key={n.id} value={n.id} className="text-xs">{n.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Model B</Label>
              <Select value={form.modelBId} onValueChange={(v) => setForm((f) => ({ ...f, modelBId: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select model…" /></SelectTrigger>
                <SelectContent>{trained.map((n) => <SelectItem key={n.id} value={n.id} className="text-xs">{n.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Metric</Label>
              <Select value={form.metric} onValueChange={(v) => setForm((f) => ({ ...f, metric: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="accuracy" className="text-xs">Accuracy (higher = better)</SelectItem>
                  <SelectItem value="f1" className="text-xs">F1 Score</SelectItem>
                  <SelectItem value="latency" className="text-xs">Inference Latency (lower = better)</SelectItem>
                  <SelectItem value="size" className="text-xs">Model Size (lower = better)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input className="h-7 text-xs" placeholder="Dataset, conditions…" value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <Button size="sm" className="h-7 text-xs"
            disabled={!form.name || !form.modelAId || !form.modelBId || form.modelAId === form.modelBId}
            onClick={() => { onCreate(form); setForm({ name: "", modelAId: "", modelBId: "", metric: "accuracy", notes: "" }); }}>
            <GitCompare className="w-3.5 h-3.5 mr-1.5" />Run A/B Test
          </Button>
        </CardContent>
      </Card>

      {tests.length > 0 && (
        <div className="space-y-2">
          {tests.map((test) => (
            <Card key={test.id}>
              <CardContent className="pt-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{test.name}</p>
                  <p className="text-xs text-muted-foreground">{test.modelAName} vs {test.modelBName} · {test.metric}</p>
                </div>
                {test.results && (
                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-center">
                      <p className="text-muted-foreground">Model A</p>
                      <p className="font-mono font-medium">{test.results.modelA}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">Model B</p>
                      <p className="font-mono font-medium">{test.results.modelB}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">Winner</p>
                      <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400" variant="outline">{test.results.winner}</Badge>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">Δ</p>
                      <p className="font-mono font-medium text-emerald-400">+{test.results.improvement.toFixed(4)}</p>
                    </div>
                  </div>
                )}
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => onDelete(test.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tests.length === 0 && trained.length < 2 && (
        <EmptyState icon={GitCompare} title="Train at least two networks" description="A/B tests compare trained models against each other" />
      )}
    </div>
  );
}

function AnalyticsPanel({ analytics, versions }: { analytics: {
  network: NeuralNetwork;
  totalParams: number;
  modelSizeMB: number;
  inferenceTimeMs: number;
  accuracyHistory: { epoch: number; accuracy: number; valAccuracy: number }[];
  layerBreakdown: { name: string; type: string; params: number }[];
}; versions: ModelVersion[]; }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Parameters" value={analytics.totalParams.toLocaleString()} />
        <StatCard label="Model Size" value={`${analytics.modelSizeMB} MB`} />
        <StatCard label="Inference Time" value={`${analytics.inferenceTimeMs} ms`} />
        <StatCard label="Versions" value={String(versions.length)} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Training History</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-left p-2 text-muted-foreground font-medium">Epoch</th>
                  <th className="text-right p-2 text-muted-foreground font-medium">Train Acc</th>
                  <th className="text-right p-2 text-muted-foreground font-medium">Val Acc</th>
                </tr>
              </thead>
              <tbody>
                {analytics.accuracyHistory.slice(-10).map((row) => (
                  <tr key={row.epoch} className="border-b border-border/20">
                    <td className="p-2 font-mono">{row.epoch}</td>
                    <td className="p-2 text-right font-mono text-emerald-400">{(row.accuracy * 100).toFixed(2)}%</td>
                    <td className="p-2 text-right font-mono text-blue-400">{(row.valAccuracy * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Layer Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1">
            {analytics.layerBreakdown.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-border/20 last:border-0">
                <Badge variant="outline" className="text-[10px] font-mono shrink-0">{l.type}</Badge>
                <span className="flex-1 truncate">{l.name}</span>
                <span className="font-mono text-muted-foreground">{l.params.toLocaleString()} params</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {versions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Version History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-border/20 last:border-0">
                  <Badge variant="outline" className="font-mono text-[10px]">{v.version}</Badge>
                  <span className="text-emerald-400 font-mono">{(v.accuracy * 100).toFixed(2)}%</span>
                  <span className="text-muted-foreground flex-1 truncate">{v.notes || "No notes"}</span>
                  <span className="text-muted-foreground shrink-0">{new Date(v.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold font-mono mt-0.5">{value}</p>
    </div>
  );
}

function EdgeDeployPanel({ network, onConfigure, onDeploy, onExport, isDeploying }: {
  network: NeuralNetwork;
  onConfigure: (config: { targetDevice: string; quantization: string; enabled: boolean }) => void;
  onDeploy: () => void;
  onExport: (format: string) => void;
  isDeploying: boolean;
}) {
  const edge = network.edgeDeployment ?? { enabled: false, targetDevice: "wasm", quantization: "none" };
  const [device, setDevice] = useState(edge.targetDevice);
  const [quant, setQuant] = useState(edge.quantization);
  const [enabled, setEnabled] = useState(edge.enabled);

  const canDeploy = network.status === "trained" || network.status === "deployed";
  const estimatedSizeMB = network.totalParams ? (network.totalParams * (quant === "int8" ? 1 : quant === "fp16" ? 2 : 4) / 1e6).toFixed(1) : "—";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Edge Deployment Configuration</CardTitle>
          <CardDescription className="text-xs">Optimize and deploy to resource-constrained devices</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Target Device / Runtime</Label>
            <Select value={device} onValueChange={setDevice}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="wasm" className="text-xs">WebAssembly (Browser)</SelectItem>
                <SelectItem value="tensorflow-js" className="text-xs">TensorFlow.js</SelectItem>
                <SelectItem value="onnx-runtime" className="text-xs">ONNX Runtime</SelectItem>
                <SelectItem value="raspberry-pi-5" className="text-xs">Raspberry Pi 5</SelectItem>
                <SelectItem value="jetson-nano" className="text-xs">NVIDIA Jetson Nano</SelectItem>
                <SelectItem value="mobile-android" className="text-xs">Android (TensorFlow Lite)</SelectItem>
                <SelectItem value="mobile-ios" className="text-xs">iOS (Core ML)</SelectItem>
                <SelectItem value="coral-edge-tpu" className="text-xs">Google Coral Edge TPU</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Quantization</Label>
            <Select value={quant} onValueChange={setQuant}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">None (FP32 — full precision)</SelectItem>
                <SelectItem value="fp16" className="text-xs">FP16 — 2× smaller, minimal accuracy loss</SelectItem>
                <SelectItem value="int8" className="text-xs">INT8 — 4× smaller, ~1–2% accuracy loss</SelectItem>
                <SelectItem value="int4" className="text-xs">INT4 — 8× smaller, moderate accuracy loss</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Enable Edge Deployment</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="bg-muted/50 rounded p-2 text-xs space-y-1">
            <p className="text-muted-foreground">Estimated model size: <span className="font-mono font-medium text-foreground">{estimatedSizeMB} MB</span></p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onConfigure({ targetDevice: device, quantization: quant, enabled })}>
              <Settings2 className="w-3.5 h-3.5 mr-1.5" />Save Config
            </Button>
            <Button size="sm" className="h-7 text-xs bg-gradient-to-r from-purple-500 to-pink-500" onClick={onDeploy}
              disabled={!canDeploy || isDeploying}>
              {isDeploying ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
              {network.status === "deployed" ? "Re-deploy" : "Deploy to Edge"}
            </Button>
          </div>
          {network.deployedAt && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-400" />
              Deployed {new Date(network.deployedAt).toLocaleString()}
            </p>
          )}
          {!canDeploy && (
            <p className="text-[10px] text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Train the network before deploying
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Export Model</CardTitle>
          <CardDescription className="text-xs">Export trained weights in various formats</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            { format: "onnx", label: "ONNX", desc: "Open Neural Network Exchange — universal format" },
            { format: "tflite", label: "TensorFlow Lite", desc: "Optimized for mobile and embedded devices" },
            { format: "torchscript", label: "TorchScript", desc: "PyTorch serialized model for production" },
            { format: "savedmodel", label: "SavedModel", desc: "TensorFlow SavedModel format" },
            { format: "json", label: "JSON", desc: "Portable architecture + weights (JoyCreate format)" },
          ].map(({ format, label, desc }) => (
            <div key={format} className="flex items-center justify-between p-2 rounded border border-border/40 hover:border-border transition-colors">
              <div>
                <p className="text-xs font-medium">{label}</p>
                <p className="text-[10px] text-muted-foreground">{desc}</p>
              </div>
              <Button size="sm" variant="outline" className="h-6 text-[10px]"
                disabled={!canDeploy} onClick={() => onExport(format)}>
                <Download className="w-3 h-3 mr-1" />Export
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function NewNetworkDialog({ open, onOpenChange, onCreate, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (params: { name: string; description: string; taskType: string }) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({ name: "", description: "", taskType: "classification" });

  const handleCreate = () => {
    if (!form.name.trim()) return;
    onCreate(form);
    setForm({ name: "", description: "", taskType: "classification" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Neural Network</DialogTitle>
          <DialogDescription>Create a new network — you can customize the architecture in the Designer tab.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Network Name</Label>
            <Input className="h-8" placeholder="e.g. Image Classifier v1" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Task Type</Label>
            <Select value={form.taskType} onValueChange={(v) => setForm((f) => ({ ...f, taskType: v }))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="classification" className="text-xs">Classification</SelectItem>
                <SelectItem value="regression" className="text-xs">Regression</SelectItem>
                <SelectItem value="generation" className="text-xs">Generation</SelectItem>
                <SelectItem value="detection" className="text-xs">Object Detection</SelectItem>
                <SelectItem value="segmentation" className="text-xs">Segmentation</SelectItem>
                <SelectItem value="nlp" className="text-xs">NLP</SelectItem>
                <SelectItem value="multi-modal" className="text-xs">Multi-Modal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea className="text-xs min-h-[60px] resize-none" placeholder="What will this network do?" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!form.name.trim() || isPending} onClick={handleCreate}>
            {isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Brain className="w-3.5 h-3.5 mr-1.5" />}
            Create Network
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
