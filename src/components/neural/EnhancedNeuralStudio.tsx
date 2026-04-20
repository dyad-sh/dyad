/**
 * Enhanced Neural Builder Studio
 *
 * The existing NeuralBuilderPage has 8 tabs. This adds 16 MORE:
 *
 * EXISTING: Overview, Designer, Training, Transfer Learning, A/B Tests,
 *           Analytics, Edge Deploy, Integrations
 *
 * NEW TABS:
 * 1. MODEL ZOO — Browse/download HuggingFace, Ollama, ONNX Hub, PyTorch Hub
 * 2. DATASET STUDIO — Upload, annotate, augment, version datasets
 * 3. EXPERIMENT TRACKER — MLflow-style run comparison
 * 4. HYPERPARAMETER TUNING — Grid, random, Bayesian, evolutionary search
 * 5. FINE-TUNING — LoRA, QLoRA, full fine-tune with custom data
 * 6. PROMPT ENGINEERING — Test, compare, and optimize prompts
 * 7. RAG BUILDER — Vector store + retrieval pipeline builder
 * 8. QUANTIZATION — INT8/INT4/GPTQ/AWQ for size reduction
 * 9. MODEL SERVING — Deploy as API, batch inference
 * 10. MODEL COMPARISON — Side-by-side evaluation
 * 11. ML PIPELINE — Drag-drop data→train→eval→deploy pipeline
 * 12. COST ESTIMATOR — Token/compute costs, ROI calculator
 * 13. SAFETY — Red-teaming, guardrails, bias detection
 * 14. FEDERATED LEARNING — Train across distributed nodes
 * 15. EVALUATION — Comprehensive metrics, confusion matrices
 * 16. CELESTIA ANCHORING — Model provenance on-chain
 */

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Brain, BrainCircuit, Database, Layers, Plus, Play, Pause, Download,
  Upload, Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Sparkles, Zap, BarChart3, TrendingUp, Settings, Trash2,
  ExternalLink, Star, Target, Activity, GitCompare, TestTube2,
  Shield, Lock, Gauge, Server, Workflow, Scale, Eye, Cpu,
  FileJson, Boxes, BookOpen, Wand2, DollarSign, Network,
  Satellite, Dna, Component, MessageSquare, Hash, ArrowRightLeft,
  SplitSquareVertical, FlaskConical,
} from "lucide-react";
import type {
  ModelZooEntry, ModelSource, ModelTask, ModelFramework,
  Dataset, DatasetType, DatasetColumn,
  Experiment, ExperimentRun, TrainingRunConfig,
  HyperparameterSearch, HyperparameterDef,
  FineTuneJob,
  PromptLab, PromptVariant, PromptTestCase,
  RagPipeline, RagSource,
  ModelServingConfig,
  SafetyConfig,
  CostEstimate,
  MLPipeline, PipelineNode,
} from "@/types/neural_builder_enhanced_types";

// ============================================================================
// 1. MODEL ZOO
// ============================================================================

function ModelZooPanel() {
  const [source, setSource] = useState<ModelSource | "all">("all");
  const [task, setTask] = useState<ModelTask | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const SAMPLE_MODELS = [
    { name: "Llama 3.1 70B", source: "huggingface" as ModelSource, task: "text-generation" as ModelTask, params: 70, size: "140GB", downloads: 2400000, rating: 4.9 },
    { name: "Mistral 7B", source: "huggingface" as ModelSource, task: "text-generation" as ModelTask, params: 7, size: "14GB", downloads: 5200000, rating: 4.8 },
    { name: "nomic-embed-text", source: "ollama" as ModelSource, task: "embedding" as ModelTask, params: 0.137, size: "274MB", downloads: 890000, rating: 4.7 },
    { name: "YOLO v8", source: "pytorch-hub" as ModelSource, task: "object-detection" as ModelTask, params: 0.011, size: "22MB", downloads: 3100000, rating: 4.8 },
    { name: "Whisper Large v3", source: "huggingface" as ModelSource, task: "speech-recognition" as ModelTask, params: 1.5, size: "3.1GB", downloads: 1800000, rating: 4.9 },
    { name: "Stable Diffusion XL", source: "huggingface" as ModelSource, task: "image-generation" as ModelTask, params: 6.6, size: "13GB", downloads: 4500000, rating: 4.7 },
    { name: "CodeLlama 34B", source: "ollama" as ModelSource, task: "code-generation" as ModelTask, params: 34, size: "68GB", downloads: 920000, rating: 4.6 },
    { name: "BGE Reranker v2", source: "huggingface" as ModelSource, task: "reranking" as ModelTask, params: 0.56, size: "1.1GB", downloads: 450000, rating: 4.5 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input placeholder="Search models..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
        </div>
        <Select value={source} onValueChange={(v) => setSource(v as any)}>
          <SelectTrigger className="w-[150px] h-9 text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="huggingface">🤗 HuggingFace</SelectItem>
            <SelectItem value="ollama">🦙 Ollama</SelectItem>
            <SelectItem value="onnx-hub">ONNX Hub</SelectItem>
            <SelectItem value="pytorch-hub">PyTorch Hub</SelectItem>
          </SelectContent>
        </Select>
        <Select value={task} onValueChange={(v) => setTask(v as any)}>
          <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue placeholder="Task" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            <SelectItem value="text-generation">Text Generation</SelectItem>
            <SelectItem value="embedding">Embedding</SelectItem>
            <SelectItem value="code-generation">Code Generation</SelectItem>
            <SelectItem value="image-generation">Image Generation</SelectItem>
            <SelectItem value="object-detection">Object Detection</SelectItem>
            <SelectItem value="speech-recognition">Speech Recognition</SelectItem>
            <SelectItem value="reranking">Reranking</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SAMPLE_MODELS
          .filter((m) => source === "all" || m.source === source)
          .filter((m) => task === "all" || m.task === task)
          .filter((m) => !searchQuery || m.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((model) => (
            <Card key={model.name} className="bg-muted/20 border-border/40 hover:border-primary/30 transition-colors cursor-pointer group">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="text-sm font-semibold">{model.name}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[9px] px-1 py-0">{model.source}</Badge>
                      <Badge variant="outline" className="text-[9px] px-1 py-0">{model.task}</Badge>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                    <Download className="w-3 h-3 mr-0.5" /> Download
                  </Button>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
                  <span>{model.params}B params</span>
                  <span>{model.size}</span>
                  <span><Star className="w-3 h-3 text-amber-400 inline" /> {model.rating}</span>
                  <span>{(model.downloads / 1000000).toFixed(1)}M downloads</span>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}

// ============================================================================
// 2. DATASET STUDIO
// ============================================================================

function DatasetStudioPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-400" /> Dataset Studio
        </h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline"><Upload className="w-3.5 h-3.5 mr-1" /> Upload</Button>
          <Button size="sm"><Plus className="w-3.5 h-3.5 mr-1" /> Create</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { name: "chat-instructions-10k", type: "instruction", rows: 10240, size: "45MB", quality: 92 },
          { name: "product-reviews", type: "classification", rows: 52000, size: "128MB", quality: 87 },
          { name: "code-completions", type: "code", rows: 25600, size: "340MB", quality: 95 },
        ].map((ds) => (
          <Card key={ds.name} className="bg-muted/20 border-border/40 hover:border-primary/30 transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold font-mono">{ds.name}</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-[10px]">{ds.type}</Badge>
                <span className="text-[10px] text-muted-foreground/50">{ds.rows.toLocaleString()} rows • {ds.size}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/50">Quality:</span>
                <Progress value={ds.quality} className="flex-1 h-1.5" />
                <span className={`text-[10px] font-bold ${ds.quality >= 90 ? "text-green-400" : "text-amber-400"}`}>{ds.quality}%</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 3. EXPERIMENT TRACKER
// ============================================================================

function ExperimentTrackerPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-violet-400" /> Experiment Tracker
        </h3>
        <Button size="sm"><Plus className="w-3.5 h-3.5 mr-1" /> New Experiment</Button>
      </div>

      <Card className="bg-muted/10 border-border/30">
        <CardContent className="p-8 text-center">
          <FlaskConical className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <h4 className="text-sm font-semibold mb-1">MLflow-Style Experiment Tracking</h4>
          <p className="text-xs text-muted-foreground/60">
            Track parameters, metrics, artifacts, and code versions across training runs.
            Compare runs side-by-side with interactive charts.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// 4. FINE-TUNING
// ============================================================================

function FineTuningPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-amber-400" /> Fine-Tuning
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { method: "LoRA", desc: "Low-rank adaptation. Fast, low memory, great for most cases", recommended: true },
          { method: "QLoRA", desc: "Quantized LoRA. 4-bit base model + LoRA. Fits on consumer GPUs" },
          { method: "Full Fine-Tune", desc: "Update all parameters. Best quality, requires significant compute" },
          { method: "Prefix Tuning", desc: "Add trainable prefix tokens. Efficient for specific tasks" },
          { method: "Prompt Tuning", desc: "Soft prompts. Lightweight but less powerful" },
          { method: "Adapter", desc: "Add small adapter layers. Good balance of quality and efficiency" },
        ].map((ft) => (
          <Card key={ft.method} className={`border-border/40 cursor-pointer hover:border-primary/30 transition-colors ${ft.recommended ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/20"}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-semibold">{ft.method}</h4>
                {ft.recommended && <Badge className="bg-amber-500 text-[9px]">Recommended</Badge>}
              </div>
              <p className="text-[11px] text-muted-foreground/60">{ft.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 5. PROMPT ENGINEERING
// ============================================================================

function PromptEngineeringPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-green-400" /> Prompt Engineering Lab
      </h3>
      <p className="text-xs text-muted-foreground/60">
        Test different prompts against the same inputs across multiple models. A/B test prompts.
        Build prompt pipelines with chaining and routing.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-muted/20 border-border/40">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs">Prompt A</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <Textarea placeholder="Enter system prompt..." rows={4} className="text-xs" />
          </CardContent>
        </Card>
        <Card className="bg-muted/20 border-border/40">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs">Prompt B</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <Textarea placeholder="Enter system prompt..." rows={4} className="text-xs" />
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Textarea placeholder="Test input..." rows={2} className="flex-1 text-xs" />
        <Button className="gap-1.5"><Play className="w-3.5 h-3.5" /> Run A/B Test</Button>
      </div>
    </div>
  );
}

// ============================================================================
// 6. RAG BUILDER
// ============================================================================

function RagBuilderPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-cyan-400" /> RAG Pipeline Builder
        </h3>
        <Button size="sm"><Plus className="w-3.5 h-3.5 mr-1" /> New Pipeline</Button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { step: "1. Sources", icon: <Upload className="w-5 h-5" />, desc: "Add documents" },
          { step: "2. Embed", icon: <Hash className="w-5 h-5" />, desc: "Chunk & embed" },
          { step: "3. Store", icon: <Database className="w-5 h-5" />, desc: "Vector store" },
          { step: "4. Retrieve", icon: <Search className="w-5 h-5" />, desc: "Query & answer" },
        ].map((s) => (
          <Card key={s.step} className="bg-muted/20 border-border/40 text-center">
            <CardContent className="p-4">
              <div className="w-10 h-10 mx-auto rounded-xl bg-cyan-500/10 flex items-center justify-center mb-2 text-cyan-400">{s.icon}</div>
              <span className="text-xs font-semibold block">{s.step}</span>
              <span className="text-[10px] text-muted-foreground/50">{s.desc}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-muted/10 border-border/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="text-xs">Vector Store:</Label>
            <Select defaultValue="chroma">
              <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chroma">Chroma</SelectItem>
                <SelectItem value="pinecone">Pinecone</SelectItem>
                <SelectItem value="qdrant">Qdrant</SelectItem>
                <SelectItem value="pgvector">pgvector</SelectItem>
                <SelectItem value="faiss">FAISS</SelectItem>
                <SelectItem value="in-memory">In-Memory</SelectItem>
              </SelectContent>
            </Select>
            <Label className="text-xs">Chunk Size:</Label>
            <Input type="number" defaultValue={512} className="w-[80px] h-7 text-xs" />
            <Label className="text-xs">Top K:</Label>
            <Input type="number" defaultValue={5} className="w-[60px] h-7 text-xs" />
            <Label className="text-xs">Strategy:</Label>
            <Select defaultValue="hybrid">
              <SelectTrigger className="w-[120px] h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="similarity">Similarity</SelectItem>
                <SelectItem value="mmr">MMR</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="reranking">Reranking</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// 7. SAFETY & ALIGNMENT
// ============================================================================

function SafetyPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Shield className="w-4 h-4 text-red-400" /> Safety & Alignment
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { name: "Red-Teaming", desc: "Automated adversarial testing for jailbreaks, prompt injection, data extraction", icon: <TestTube2 className="w-5 h-5 text-red-400" />, color: "from-red-500/10 to-orange-500/10" },
          { name: "Guardrails", desc: "Input/output filters: regex, classifiers, semantic rules, length checks", icon: <Shield className="w-5 h-5 text-amber-400" />, color: "from-amber-500/10 to-yellow-500/10" },
          { name: "Bias Detection", desc: "Analyze outputs for demographic, cultural, and ideological biases", icon: <Scale className="w-5 h-5 text-blue-400" />, color: "from-blue-500/10 to-cyan-500/10" },
          { name: "Toxicity Monitor", desc: "Real-time toxicity scoring with thresholds and auto-blocking", icon: <AlertTriangle className="w-5 h-5 text-orange-400" />, color: "from-orange-500/10 to-red-500/10" },
        ].map((feature) => (
          <Card key={feature.name} className={`bg-gradient-to-br ${feature.color} border-border/30`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center shrink-0">{feature.icon}</div>
                <div>
                  <h4 className="text-sm font-semibold">{feature.name}</h4>
                  <p className="text-[11px] text-muted-foreground/60 mt-0.5">{feature.desc}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 8. COST ESTIMATOR
// ============================================================================

function CostEstimatorPanel() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-green-400" /> Cost Estimator
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="bg-muted/20 border-border/40">
          <CardHeader className="py-3 px-4"><CardTitle className="text-xs">Training</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="flex justify-between text-[11px]"><span>Tokens</span><Input type="number" defaultValue={10000000} className="w-[100px] h-6 text-[10px]" /></div>
            <div className="flex justify-between text-[11px]"><span>GPU Hours</span><Input type="number" defaultValue={4} className="w-[100px] h-6 text-[10px]" /></div>
            <div className="flex justify-between text-[11px] font-bold"><span>Est. Cost</span><span className="text-green-400">$12.50</span></div>
          </CardContent>
        </Card>
        <Card className="bg-muted/20 border-border/40">
          <CardHeader className="py-3 px-4"><CardTitle className="text-xs">Inference (Monthly)</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="flex justify-between text-[11px]"><span>Requests/Day</span><Input type="number" defaultValue={1000} className="w-[100px] h-6 text-[10px]" /></div>
            <div className="flex justify-between text-[11px]"><span>Avg Tokens/Req</span><Input type="number" defaultValue={500} className="w-[100px] h-6 text-[10px]" /></div>
            <div className="flex justify-between text-[11px] font-bold"><span>Monthly Cost</span><span className="text-green-400">$45.00</span></div>
          </CardContent>
        </Card>
        <Card className="bg-green-500/5 border-green-500/20">
          <CardHeader className="py-3 px-4"><CardTitle className="text-xs">ROI</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="flex justify-between text-[11px]"><span>Time Saved/Month</span><span>160 hours</span></div>
            <div className="flex justify-between text-[11px]"><span>Value Saved</span><span className="text-green-400">$8,000</span></div>
            <div className="flex justify-between text-[11px] font-bold"><span>Break-Even</span><span className="text-green-400">2 days</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN: ENHANCED NEURAL STUDIO
// ============================================================================

export function EnhancedNeuralStudio() {
  const [activeTab, setActiveTab] = useState("model-zoo");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Neural Builder Studio</h1>
            <p className="text-[11px] text-muted-foreground/70">
              Complete ML/AI model development — train, fine-tune, evaluate, deploy, and evolve
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0 border-b border-border/50">
          <ScrollArea>
            <TabsList className="bg-transparent px-4 py-2 w-max">
              <TabsTrigger value="model-zoo" className="text-xs gap-1.5"><Download className="w-3.5 h-3.5" /> Model Zoo</TabsTrigger>
              <TabsTrigger value="datasets" className="text-xs gap-1.5"><Database className="w-3.5 h-3.5" /> Datasets</TabsTrigger>
              <TabsTrigger value="experiments" className="text-xs gap-1.5"><FlaskConical className="w-3.5 h-3.5" /> Experiments</TabsTrigger>
              <TabsTrigger value="fine-tune" className="text-xs gap-1.5"><Wand2 className="w-3.5 h-3.5" /> Fine-Tune</TabsTrigger>
              <TabsTrigger value="prompts" className="text-xs gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Prompts</TabsTrigger>
              <TabsTrigger value="rag" className="text-xs gap-1.5"><BookOpen className="w-3.5 h-3.5" /> RAG</TabsTrigger>
              <TabsTrigger value="safety" className="text-xs gap-1.5"><Shield className="w-3.5 h-3.5" /> Safety</TabsTrigger>
              <TabsTrigger value="costs" className="text-xs gap-1.5"><DollarSign className="w-3.5 h-3.5" /> Costs</TabsTrigger>
              <TabsTrigger value="comparison" className="text-xs gap-1.5"><SplitSquareVertical className="w-3.5 h-3.5" /> Compare</TabsTrigger>
              <TabsTrigger value="serving" className="text-xs gap-1.5"><Server className="w-3.5 h-3.5" /> Serving</TabsTrigger>
              <TabsTrigger value="pipeline" className="text-xs gap-1.5"><Workflow className="w-3.5 h-3.5" /> Pipeline</TabsTrigger>
              <TabsTrigger value="quantize" className="text-xs gap-1.5"><Boxes className="w-3.5 h-3.5" /> Quantize</TabsTrigger>
              <TabsTrigger value="tuning" className="text-xs gap-1.5"><Settings className="w-3.5 h-3.5" /> Hyperparams</TabsTrigger>
              <TabsTrigger value="evaluation" className="text-xs gap-1.5"><Scale className="w-3.5 h-3.5" /> Evaluation</TabsTrigger>
              <TabsTrigger value="federated" className="text-xs gap-1.5"><Network className="w-3.5 h-3.5" /> Federated</TabsTrigger>
              <TabsTrigger value="celestia" className="text-xs gap-1.5"><Satellite className="w-3.5 h-3.5" /> Celestia</TabsTrigger>
            </TabsList>
          </ScrollArea>
        </div>

        <TabsContent value="model-zoo" className="flex-1 m-0 overflow-auto p-4"><ModelZooPanel /></TabsContent>
        <TabsContent value="datasets" className="flex-1 m-0 overflow-auto p-4"><DatasetStudioPanel /></TabsContent>
        <TabsContent value="experiments" className="flex-1 m-0 overflow-auto p-4"><ExperimentTrackerPanel /></TabsContent>
        <TabsContent value="fine-tune" className="flex-1 m-0 overflow-auto p-4"><FineTuningPanel /></TabsContent>
        <TabsContent value="prompts" className="flex-1 m-0 overflow-auto p-4"><PromptEngineeringPanel /></TabsContent>
        <TabsContent value="rag" className="flex-1 m-0 overflow-auto p-4"><RagBuilderPanel /></TabsContent>
        <TabsContent value="safety" className="flex-1 m-0 overflow-auto p-4"><SafetyPanel /></TabsContent>
        <TabsContent value="costs" className="flex-1 m-0 overflow-auto p-4"><CostEstimatorPanel /></TabsContent>

        {/* Remaining tabs with placeholder content */}
        {["comparison", "serving", "pipeline", "quantize", "tuning", "evaluation", "federated", "celestia"].map((tab) => (
          <TabsContent key={tab} value={tab} className="flex-1 m-0 overflow-auto p-4">
            <Card className="bg-muted/10 border-border/30">
              <CardContent className="p-8 text-center">
                <Sparkles className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <h3 className="text-sm font-semibold mb-1 capitalize">{tab.replace("-", " ")}</h3>
                <p className="text-xs text-muted-foreground/60">
                  Full types and data models defined. Ready for wiring.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
