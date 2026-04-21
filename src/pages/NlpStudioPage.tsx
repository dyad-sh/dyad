/**
 * NLP & AI Model Development Studio — JoyCreate
 *
 * The unified platform that replaces UIMA, GATE, Stanford CoreNLP,
 * OpenNLP, DKPro Core, ClearTK, and IBM Watson NLU — all in one.
 *
 * Tabs:
 *  1. Pipeline Builder — visual drag-style pipeline construction
 *  2. Analysis Workbench — interactive text analysis with all engines
 *  3. Corpus Manager — manage text corpora and datasets
 *  4. Annotation Studio — human-in-the-loop labeling
 *  5. Model Training — fine-tune and train NLP models
 *  6. Evaluation — benchmark pipelines, compare engines, metrics
 *  7. Embeddings — vector space explorer
 *  8. Export & Deploy — package models/pipelines for production
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  // Layout & Nav
  Layers,
  FlaskConical,
  Database,
  Tags,
  GraduationCap,
  BarChart3,
  Box,
  Rocket,
  // Actions
  Play,
  Plus,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  Loader2,
  Settings,
  Eye,
  EyeOff,
  Zap,
  Save,
  // Domain
  FileText,
  Brain,
  MessageSquare,
  Search,
  Target,
  Sparkles,
  ListTree,
  BookOpen,
  Network,
  Hash,
  Type,
  AlignLeft,
  BarChart2,
  PieChart,
  TrendingUp,
  GitBranch,
  Cpu,
  Wand2,
  Code,
  Table,
  Timer,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Star,
  Filter,
  Grip,
  ArrowDown,
  ArrowUp,
  Terminal,
  Globe,
  Lock,
  Paintbrush,
  Mic,
  Video,
  Image,
} from "lucide-react";

// ── Constants ────────────────────────────────────────────────────────────────

const invoke = window.electron?.ipcRenderer?.invoke;

const TABS = [
  { id: "pipeline", label: "Pipeline Builder", icon: Layers },
  { id: "analysis", label: "Analysis Workbench", icon: FlaskConical },
  { id: "corpus", label: "Corpus Manager", icon: Database },
  { id: "annotation", label: "Annotation Studio", icon: Tags },
  { id: "training", label: "Model Training", icon: GraduationCap },
  { id: "evaluation", label: "Evaluation", icon: BarChart3 },
  { id: "embeddings", label: "Embeddings", icon: Box },
  { id: "deploy", label: "Export & Deploy", icon: Rocket },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ── Analysis engine categories (surpassing every competitor) ─────────────────

const ENGINE_CATEGORIES = [
  {
    id: "text-analysis",
    label: "Text Analysis",
    icon: Type,
    engines: [
      { id: "tokenizer", name: "Tokenizer", desc: "Word, sentence, paragraph tokenization" },
      { id: "pos-tagger", name: "POS Tagger", desc: "Part-of-speech tagging (Penn Treebank, Universal)" },
      { id: "lemmatizer", name: "Lemmatizer", desc: "Morphological analysis & lemmatization" },
      { id: "dependency-parser", name: "Dependency Parser", desc: "Syntactic dependency trees" },
      { id: "constituency-parser", name: "Constituency Parser", desc: "Phrase structure trees" },
      { id: "chunker", name: "Chunker", desc: "NP/VP/PP chunk extraction" },
    ],
  },
  {
    id: "information-extraction",
    label: "Information Extraction",
    icon: Target,
    engines: [
      { id: "ner", name: "Named Entity Recognition", desc: "Person, org, location, date, money, custom entities" },
      { id: "relation-extraction", name: "Relation Extraction", desc: "Subject-predicate-object triples" },
      { id: "event-extraction", name: "Event Extraction", desc: "Event triggers, arguments, temporal ordering" },
      { id: "coreference", name: "Coreference Resolution", desc: "Pronoun and entity mention chains" },
      { id: "keyphrase", name: "Keyphrase Extraction", desc: "Salient phrases and keywords" },
      { id: "regex-annotator", name: "Regex Annotator", desc: "Pattern-based annotation rules" },
    ],
  },
  {
    id: "understanding",
    label: "Deep Understanding",
    icon: Brain,
    engines: [
      { id: "sentiment", name: "Sentiment Analysis", desc: "Document, sentence, aspect-level sentiment" },
      { id: "emotion", name: "Emotion Detection", desc: "Joy, anger, fear, sadness, surprise, disgust" },
      { id: "intent", name: "Intent Classification", desc: "User intent detection for conversational AI" },
      { id: "topic", name: "Topic Modeling", desc: "LDA, BERTopic, dynamic topic models" },
      { id: "summarization", name: "Summarization", desc: "Extractive & abstractive summarization" },
      { id: "qa", name: "Question Answering", desc: "Extractive & generative QA" },
      { id: "nli", name: "Natural Language Inference", desc: "Entailment, contradiction, neutral" },
      { id: "srl", name: "Semantic Role Labeling", desc: "Who did what to whom, where, when" },
    ],
  },
  {
    id: "generation",
    label: "Text Generation",
    icon: Wand2,
    engines: [
      { id: "text-generation", name: "Text Generation", desc: "Constrained and free-form generation" },
      { id: "paraphrase", name: "Paraphrase Generator", desc: "Meaning-preserving rewrites" },
      { id: "translation", name: "Machine Translation", desc: "100+ language pairs via local models" },
      { id: "data-augmentation", name: "Data Augmentation", desc: "Synthetic training data generation" },
      { id: "style-transfer", name: "Style Transfer", desc: "Tone, formality, domain adaptation" },
    ],
  },
  {
    id: "multimodal",
    label: "Multimodal",
    icon: Image,
    engines: [
      { id: "ocr", name: "OCR / Document AI", desc: "Extract text from images and PDFs" },
      { id: "asr", name: "Speech-to-Text", desc: "Whisper-based transcription" },
      { id: "tts", name: "Text-to-Speech", desc: "Neural voice synthesis" },
      { id: "image-caption", name: "Image Captioning", desc: "Describe images in natural language" },
      { id: "video-analysis", name: "Video Analysis", desc: "Scene, activity, and speech extraction" },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge & Retrieval",
    icon: Globe,
    engines: [
      { id: "kg-extraction", name: "Knowledge Graph Builder", desc: "Extract entities & relations into graph" },
      { id: "entity-linking", name: "Entity Linking", desc: "Link mentions to Wikidata/custom KB" },
      { id: "fact-checking", name: "Fact Verification", desc: "Claim verification against knowledge bases" },
      { id: "rag", name: "RAG Pipeline", desc: "Retrieval-augmented generation" },
      { id: "semantic-search", name: "Semantic Search", desc: "Dense vector retrieval over corpora" },
    ],
  },
];

const ALL_ENGINES = ENGINE_CATEGORIES.flatMap((c) => c.engines.map((e) => ({ ...e, category: c.id })));

// ── Shared components ────────────────────────────────────────────────────────

function LoadingState() {
  return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
}
function EmptyState({ msg, icon: Icon = FlaskConical }: { msg: string; icon?: React.ElementType }) {
  return (
    <div className="text-center py-16">
      <Icon className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-muted-foreground">{msg}</p>
    </div>
  );
}
function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string; icon: React.ElementType; color: string; sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── 1. Pipeline Builder ──────────────────────────────────────────────────────

function PipelineBuilderTab() {
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]);
  const [showEngines, setShowEngines] = useState(false);

  useEffect(() => { loadPipelines(); }, []);

  const loadPipelines = async () => {
    setLoading(true);
    try { setPipelines(await invoke("nlp:list-pipelines") ?? []); } catch { setPipelines([]); }
    setLoading(false);
  };

  const addStep = (engineId: string) => {
    if (!selectedSteps.includes(engineId)) setSelectedSteps([...selectedSteps, engineId]);
  };

  const removeStep = (engineId: string) => {
    setSelectedSteps(selectedSteps.filter((s) => s !== engineId));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= selectedSteps.length) return;
    const copy = [...selectedSteps];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setSelectedSteps(copy);
  };

  const savePipeline = async () => {
    if (!newName || selectedSteps.length === 0) return;
    try {
      await invoke("nlp:save-pipeline", {
        name: newName,
        steps: selectedSteps.map((engineId) => {
          const eng = ALL_ENGINES.find((e) => e.id === engineId);
          return { engineId, name: eng?.name ?? engineId, config: {} };
        }),
      });
      setCreating(false);
      setNewName("");
      setSelectedSteps([]);
      loadPipelines();
    } catch (err) { console.error(err); }
  };

  const deletePipeline = async (id: string) => {
    try { await invoke("nlp:delete-pipeline", id); loadPipelines(); } catch {}
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">NLP Pipelines</h3>
          <p className="text-sm text-muted-foreground">Build processing chains from 35+ analysis engines</p>
        </div>
        <Button onClick={() => setCreating(!creating)}>
          <Plus className="h-4 w-4 mr-1" /> New Pipeline
        </Button>
      </div>

      {/* Create pipeline */}
      {creating && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="p-4 border-b bg-gradient-to-r from-blue-500/5 to-purple-500/5">
            <h4 className="font-semibold">Build Pipeline</h4>
            <input
              type="text"
              placeholder="Pipeline name (e.g., 'Customer Feedback Analyzer')"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full mt-2 px-3 py-2 rounded-lg border bg-background text-sm"
            />
          </div>

          {/* Selected steps */}
          <div className="p-4 border-b min-h-[80px]">
            <div className="text-xs text-muted-foreground mb-2 font-medium">Pipeline Steps ({selectedSteps.length})</div>
            {selectedSteps.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Click engines below to add steps...</p>
            ) : (
              <div className="space-y-1">
                {selectedSteps.map((stepId, idx) => {
                  const eng = ALL_ENGINES.find((e) => e.id === stepId);
                  return (
                    <div key={stepId} className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveStep(idx, -1)} className="p-0.5 hover:bg-muted rounded" disabled={idx === 0}>
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button onClick={() => moveStep(idx, 1)} className="p-0.5 hover:bg-muted rounded" disabled={idx === selectedSteps.length - 1}>
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                      <Badge variant="outline" className="text-xs">{idx + 1}</Badge>
                      <span className="text-sm font-medium flex-1">{eng?.name ?? stepId}</span>
                      <span className="text-xs text-muted-foreground">{eng?.desc}</span>
                      <button onClick={() => removeStep(stepId)} className="p-1 hover:bg-red-500/10 rounded text-red-500">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Engine picker */}
          <div className="p-4 max-h-[400px] overflow-y-auto">
            <div className="text-xs text-muted-foreground mb-3 font-medium flex items-center justify-between">
              <span>Available Engines ({ALL_ENGINES.length})</span>
              <Button size="sm" variant="ghost" onClick={() => setShowEngines(!showEngines)}>
                {showEngines ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                {showEngines ? "Collapse" : "Expand All"}
              </Button>
            </div>
            {ENGINE_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <div key={cat.id} className="mb-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">{cat.label}</span>
                    <Badge variant="outline" className="text-xs">{cat.engines.length}</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 ml-6">
                    {cat.engines.map((eng) => {
                      const selected = selectedSteps.includes(eng.id);
                      return (
                        <button
                          key={eng.id}
                          onClick={() => selected ? removeStep(eng.id) : addStep(eng.id)}
                          className={cn(
                            "text-left p-2 rounded-lg border text-xs transition-all",
                            selected ? "border-primary bg-primary/10 text-primary" : "border-muted hover:border-primary/50",
                          )}
                        >
                          <div className="font-medium">{eng.name}</div>
                          {showEngines && <div className="text-muted-foreground mt-0.5">{eng.desc}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Save */}
          <div className="p-4 border-t bg-muted/30 flex gap-2">
            <Button onClick={savePipeline} disabled={!newName || selectedSteps.length === 0}>
              <Save className="h-4 w-4 mr-1" /> Save Pipeline
            </Button>
            <Button variant="outline" onClick={() => { setCreating(false); setSelectedSteps([]); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Existing pipelines */}
      {loading ? <LoadingState /> : pipelines.length === 0 && !creating ? (
        <EmptyState msg="No pipelines yet. Build your first NLP pipeline from 35+ engines." icon={Layers} />
      ) : (
        <div className="grid gap-3">
          {pipelines.map((p: any) => (
            <div key={p.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <Layers className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <Badge variant="outline" className="text-xs">{p.steps?.length ?? 0} steps</Badge>
                  </div>
                  {p.steps && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {p.steps.map((s: any, i: number) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {s.name ?? s.engineId}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" className="text-red-500" onClick={() => deletePipeline(p.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 2. Analysis Workbench ────────────────────────────────────────────────────

function AnalysisWorkbenchTab() {
  const [text, setText] = useState("");
  const [engines, setEngines] = useState<any[]>([]);
  const [selectedEngine, setSelectedEngine] = useState("ner");
  const [result, setResult] = useState<any>(null);
  const [processing, setProcessing] = useState(false);
  const [history, setHistory] = useState<{ engine: string; text: string; result: any; ts: number }[]>([]);

  useEffect(() => {
    (async () => {
      try { setEngines(await invoke("nlp:list-engines") ?? []); } catch {}
    })();
  }, []);

  const analyze = async () => {
    if (!text.trim()) return;
    setProcessing(true);
    try {
      const res = await invoke("nlp:run-engine", { engineId: selectedEngine, text, options: {} });
      setResult(res);
      setHistory([{ engine: selectedEngine, text: text.slice(0, 80), result: res, ts: Date.now() }, ...history.slice(0, 19)]);
    } catch (err) {
      setResult({ error: String(err) });
    }
    setProcessing(false);
  };

  const processWithPipeline = async () => {
    if (!text.trim()) return;
    setProcessing(true);
    try {
      const res = await invoke("nlp:process-text", { text, engines: [selectedEngine], options: {} });
      setResult(res);
    } catch (err) {
      setResult({ error: String(err) });
    }
    setProcessing(false);
  };

  return (
    <div className="space-y-6">
      {/* Input section */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="p-4 border-b bg-gradient-to-r from-emerald-500/5 to-cyan-500/5">
          <h4 className="font-semibold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-emerald-500" />
            Interactive Analysis
          </h4>
          <p className="text-xs text-muted-foreground mt-1">Paste text, choose an engine, and analyze instantly. Supports 35+ analysis types.</p>
        </div>

        <div className="p-4 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter or paste text to analyze... (supports documents up to 100K tokens)"
            className="w-full h-40 px-3 py-2 rounded-lg border bg-background text-sm resize-y font-mono"
          />

          <div className="flex gap-2 items-end flex-wrap">
            {/* Engine picker */}
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Analysis Engine</label>
              <select
                value={selectedEngine}
                onChange={(e) => setSelectedEngine(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              >
                {ENGINE_CATEGORIES.map((cat) => (
                  <optgroup key={cat.id} label={cat.label}>
                    {cat.engines.map((eng) => (
                      <option key={eng.id} value={eng.id}>{eng.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <Button onClick={analyze} disabled={processing || !text.trim()}>
              {processing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              Analyze
            </Button>
            <Button variant="outline" onClick={processWithPipeline} disabled={processing || !text.trim()}>
              <Layers className="h-4 w-4 mr-1" /> Pipeline Run
            </Button>
          </div>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between bg-muted/30">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">Analysis Result</span>
              <Badge variant="outline" className="text-xs">{selectedEngine}</Badge>
            </div>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2))}>
              <Copy className="h-3 w-3 mr-1" /> Copy JSON
            </Button>
          </div>
          <div className="p-4">
            {result.error ? (
              <div className="p-3 rounded-lg bg-red-500/10 text-red-600 text-sm">{result.error}</div>
            ) : (
              <AnalysisResultView result={result} engine={selectedEngine} />
            )}
          </div>
        </div>
      )}

      {/* Quick Engines grid */}
      <div className="rounded-xl border bg-card p-5">
        <h4 className="text-sm font-semibold mb-3">Quick Engine Reference</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {ENGINE_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return cat.engines.map((eng) => (
              <button
                key={eng.id}
                onClick={() => setSelectedEngine(eng.id)}
                className={cn(
                  "text-left p-2 rounded-lg border text-xs transition-all",
                  selectedEngine === eng.id ? "border-primary bg-primary/10" : "hover:border-primary/30",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{eng.name}</span>
                </div>
              </button>
            ));
          })}
        </div>
      </div>
    </div>
  );
}

function AnalysisResultView({ result, engine }: { result: any; engine: string }) {
  // Render annotations visually
  if (result?.annotations && Array.isArray(result.annotations)) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-medium">{result.annotations.length} annotations found</div>
        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {result.annotations.map((ann: any, idx: number) => (
            <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 text-sm">
              <Badge className="text-xs bg-primary/10 text-primary">{ann.type ?? ann.label ?? engine}</Badge>
              <span className="font-mono">{ann.text ?? ann.value ?? ann.coveredText}</span>
              {ann.score != null && (
                <span className="text-xs text-muted-foreground ml-auto">{(ann.score * 100).toFixed(1)}%</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // CAS-style result
  if (result?.cas || result?.processingSteps) {
    return (
      <div className="space-y-3">
        {result.processingSteps && (
          <div className="flex gap-2 flex-wrap">
            {result.processingSteps.map((s: any, i: number) => (
              <Badge key={i} variant="outline" className="text-xs">
                {s.engineId}: {s.durationMs}ms
              </Badge>
            ))}
          </div>
        )}
        <pre className="text-xs bg-muted/30 p-3 rounded-lg overflow-auto max-h-[300px] font-mono">
          {JSON.stringify(result.cas ?? result, null, 2)}
        </pre>
      </div>
    );
  }

  // Fallback: raw JSON
  return (
    <pre className="text-xs bg-muted/30 p-3 rounded-lg overflow-auto max-h-[400px] font-mono">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

// ── 3. Corpus Manager ────────────────────────────────────────────────────────

function CorpusManagerTab() {
  const [corpora, setCorpora] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [corpusName, setCorpusName] = useState("");
  const [corpusDesc, setCorpusDesc] = useState("");
  const [corpusText, setCorpusText] = useState("");

  useEffect(() => { loadCorpora(); }, []);

  const loadCorpora = async () => {
    setLoading(true);
    try {
      // Use dataset tools as corpus backend
      const result = await invoke("scraper:dataset:list");
      setCorpora(result ?? []);
    } catch { setCorpora([]); }
    setLoading(false);
  };

  const createCorpus = async () => {
    if (!corpusName) return;
    try {
      await invoke("scraper:dataset:create", {
        name: corpusName,
        description: corpusDesc,
        type: "text",
        metadata: { isCorpus: true, documentCount: corpusText ? 1 : 0 },
      });
      if (corpusText) {
        // TODO: add documents to corpus
      }
      setCreating(false);
      setCorpusName("");
      setCorpusDesc("");
      setCorpusText("");
      loadCorpora();
    } catch (err) { console.error(err); }
  };

  const batchProcess = async (datasetId: string) => {
    try {
      await invoke("nlp:process-dataset", { datasetId, engines: ["ner", "sentiment", "topic"] });
    } catch (err) { console.error(err); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Corpus & Dataset Manager</h3>
          <p className="text-sm text-muted-foreground">Manage text collections for NLP pipeline processing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><Upload className="h-4 w-4 mr-1" /> Import</Button>
          <Button onClick={() => setCreating(!creating)}><Plus className="h-4 w-4 mr-1" /> New Corpus</Button>
        </div>
      </div>

      {creating && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h4 className="font-medium">Create Corpus</h4>
          <input
            type="text"
            placeholder="Corpus name"
            value={corpusName}
            onChange={(e) => setCorpusName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <input
            type="text"
            placeholder="Description"
            value={corpusDesc}
            onChange={(e) => setCorpusDesc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <textarea
            placeholder="Paste initial text documents (one per line)..."
            value={corpusText}
            onChange={(e) => setCorpusText(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm h-24 resize-y font-mono"
          />
          <div className="flex gap-2">
            <Button onClick={createCorpus} disabled={!corpusName}><Save className="h-4 w-4 mr-1" /> Create</Button>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <LoadingState /> : corpora.length === 0 && !creating ? (
        <EmptyState msg="No corpora yet. Create a corpus or import documents to get started." icon={Database} />
      ) : (
        <div className="grid gap-3">
          {corpora.map((c: any) => (
            <div key={c.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <Database className="h-5 w-5 text-blue-500" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <Badge variant="outline" className="text-xs">{c.type ?? "text"}</Badge>
                    {c.metadata?.isCorpus && <Badge className="text-xs bg-blue-500/10 text-blue-500">Corpus</Badge>}
                  </div>
                  {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => batchProcess(c.id)}>
                  <Play className="h-3 w-3 mr-1" /> Process
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Supported formats */}
      <div className="rounded-xl border bg-muted/20 p-4">
        <h4 className="text-sm font-semibold mb-2">Supported Import Formats</h4>
        <div className="flex gap-2 flex-wrap">
          {["TXT", "CSV", "TSV", "JSON", "JSONL", "XML", "HTML", "PDF", "DOCX", "CoNLL", "IOB2", "BRAT", "Parquet", "UIMA XMI", "GATE XML"].map((fmt) => (
            <Badge key={fmt} variant="outline" className="text-xs">{fmt}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 4. Annotation Studio ─────────────────────────────────────────────────────

function AnnotationStudioTab() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [taxonomies, setTaxonomies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [taskType, setTaskType] = useState("ner");

  useEffect(() => {
    (async () => {
      try {
        const [t, tax] = await Promise.all([
          invoke("annotation:list-tasks"),
          invoke("annotation:list-taxonomies"),
        ]);
        setTasks(t ?? []);
        setTaxonomies(tax ?? []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const createTask = async () => {
    if (!taskName) return;
    try {
      await invoke("annotation:create-task", {
        name: taskName,
        taskType,
        datasetId: "",
        config: { annotationType: taskType, minAnnotatorsPerItem: 2 },
      });
      setShowCreate(false);
      setTaskName("");
      const t = await invoke("annotation:list-tasks");
      setTasks(t ?? []);
    } catch (err) { console.error(err); }
  };

  const TASK_TYPES = [
    { id: "ner", label: "Named Entity Recognition", icon: Target },
    { id: "classification", label: "Text Classification", icon: Tags },
    { id: "sentiment", label: "Sentiment Labeling", icon: MessageSquare },
    { id: "relation", label: "Relation Annotation", icon: GitBranch },
    { id: "qa", label: "Question Answering", icon: Search },
    { id: "sequence", label: "Sequence Labeling", icon: ListTree },
    { id: "translation", label: "Translation / Alignment", icon: Globe },
    { id: "summarization", label: "Summarization Quality", icon: AlignLeft },
  ];

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Annotation Studio</h3>
          <p className="text-sm text-muted-foreground">Human-in-the-loop labeling with inter-annotator agreement scoring</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4 mr-1" /> New Task
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Tasks" value={tasks.filter((t: any) => t.status === "active").length.toString()} icon={Tags} color="text-blue-500" />
        <StatCard label="Taxonomies" value={taxonomies.length.toString()} icon={ListTree} color="text-purple-500" />
        <StatCard label="Total Tasks" value={tasks.length.toString()} icon={CheckCircle} color="text-green-500" />
        <StatCard label="Task Types" value={TASK_TYPES.length.toString()} icon={Target} color="text-orange-500" />
      </div>

      {/* Create task */}
      {showCreate && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h4 className="font-medium">Create Annotation Task</h4>
          <input
            type="text"
            placeholder="Task name"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {TASK_TYPES.map((tt) => {
              const Icon = tt.icon;
              return (
                <button
                  key={tt.id}
                  onClick={() => setTaskType(tt.id)}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-lg border text-xs transition-all text-left",
                    taskType === tt.id ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/30",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tt.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button onClick={createTask} disabled={!taskName}><Save className="h-4 w-4 mr-1" /> Create</Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 && !showCreate ? (
        <EmptyState msg="No annotation tasks yet. Create one to start labeling data." icon={Tags} />
      ) : (
        <div className="grid gap-3">
          {tasks.map((t: any) => (
            <div key={t.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <Tags className="h-5 w-5 text-purple-500" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t.name}</span>
                    <Badge variant="outline" className="text-xs">{t.taskType ?? t.type}</Badge>
                    <Badge className={cn("text-xs", t.status === "active" ? "bg-green-500/10 text-green-600" : "bg-gray-500/10 text-gray-500")}>
                      {t.status}
                    </Badge>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Features comparison */}
      <div className="rounded-xl border bg-gradient-to-br from-purple-500/5 to-pink-500/5 p-5">
        <h4 className="text-sm font-semibold mb-3">🏆 Beyond GATE, brat, Label Studio</h4>
        <div className="grid md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-card border">
            <span className="font-semibold">Multi-annotator Agreement</span>
            <p className="text-muted-foreground mt-1">Cohen's Kappa, Fleiss' Kappa, Krippendorff's Alpha built in</p>
          </div>
          <div className="p-3 rounded-lg bg-card border">
            <span className="font-semibold">Active Learning</span>
            <p className="text-muted-foreground mt-1">Model suggests hardest examples first. You label less, get more.</p>
          </div>
          <div className="p-3 rounded-lg bg-card border">
            <span className="font-semibold">Pre-annotation</span>
            <p className="text-muted-foreground mt-1">AI pre-labels with NER/sentiment, humans correct. 10x faster.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 5. Model Training ────────────────────────────────────────────────────────

function ModelTrainingTab() {
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTrain, setShowTrain] = useState(false);
  const [trainConfig, setTrainConfig] = useState({
    name: "",
    baseModel: "llama-3.2-1b",
    taskType: "ner",
    datasetId: "",
    epochs: "3",
    learningRate: "2e-5",
    batchSize: "8",
  });

  useEffect(() => {
    (async () => {
      try {
        // Check for installed/trained models
        const result = await invoke("model-manager:list-installed");
        setModels(result?.models?.filter((m: any) => m.details?.family?.includes("fine-tuned")) ?? []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const startTraining = async () => {
    // Would launch via neural network builder
    console.log("Training with config:", trainConfig);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Model Training & Fine-tuning</h3>
          <p className="text-sm text-muted-foreground">Train NLP models on your annotated data — all local, fully sovereign</p>
        </div>
        <Button onClick={() => setShowTrain(!showTrain)}>
          <Plus className="h-4 w-4 mr-1" /> Train Model
        </Button>
      </div>

      {showTrain && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h4 className="font-semibold">Configure Training Run</h4>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Model Name</label>
              <input
                type="text"
                value={trainConfig.name}
                onChange={(e) => setTrainConfig({ ...trainConfig, name: e.target.value })}
                placeholder="e.g., customer-ner-v1"
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Base Model</label>
              <select
                value={trainConfig.baseModel}
                onChange={(e) => setTrainConfig({ ...trainConfig, baseModel: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              >
                <optgroup label="Local Models (Ollama)">
                  <option value="llama-3.2-1b">Llama 3.2 1B (fast, good for NER)</option>
                  <option value="llama-3.2-3b">Llama 3.2 3B (balanced)</option>
                  <option value="llama-3.1-8b">Llama 3.1 8B (high quality)</option>
                  <option value="deepseek-r1:8b">DeepSeek R1 8B (reasoning)</option>
                  <option value="glm-4.7-flash">GLM 4.7 Flash (multilingual)</option>
                </optgroup>
                <optgroup label="Embedding Models">
                  <option value="nomic-embed-text">Nomic Embed Text (384d)</option>
                  <option value="bge-small">BGE Small (384d)</option>
                </optgroup>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Task Type</label>
              <select
                value={trainConfig.taskType}
                onChange={(e) => setTrainConfig({ ...trainConfig, taskType: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              >
                <option value="ner">Named Entity Recognition</option>
                <option value="classification">Text Classification</option>
                <option value="sentiment">Sentiment Analysis</option>
                <option value="qa">Question Answering</option>
                <option value="summarization">Summarization</option>
                <option value="translation">Translation</option>
                <option value="generation">Text Generation</option>
                <option value="embedding">Embedding Fine-tune</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Training Dataset</label>
              <select
                value={trainConfig.datasetId}
                onChange={(e) => setTrainConfig({ ...trainConfig, datasetId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              >
                <option value="">Select dataset...</option>
                {/* Will be populated from annotation tasks / corpora */}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Epochs</label>
              <input
                type="number"
                value={trainConfig.epochs}
                onChange={(e) => setTrainConfig({ ...trainConfig, epochs: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Learning Rate</label>
              <input
                type="text"
                value={trainConfig.learningRate}
                onChange={(e) => setTrainConfig({ ...trainConfig, learningRate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Batch Size</label>
              <input
                type="number"
                value={trainConfig.batchSize}
                onChange={(e) => setTrainConfig({ ...trainConfig, batchSize: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={startTraining} disabled={!trainConfig.name}>
              <Play className="h-4 w-4 mr-1" /> Start Training
            </Button>
            <Button variant="outline" onClick={() => setShowTrain(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Training methods */}
      <div className="grid md:grid-cols-3 gap-4">
        {[
          { name: "LoRA Fine-tune", desc: "Low-rank adapter training. Modify <1% of weights. Fast, efficient, reversible.", icon: Zap, color: "text-yellow-500" },
          { name: "Full Fine-tune", desc: "Update all model weights. Maximum quality for large datasets.", icon: Brain, color: "text-purple-500" },
          { name: "Prompt Tuning", desc: "Learn soft prompts. Zero weight changes. Works with any frozen model.", icon: MessageSquare, color: "text-blue-500" },
        ].map((m) => (
          <div key={m.name} className="rounded-xl border bg-card p-4">
            <m.icon className={cn("h-6 w-6 mb-2", m.color)} />
            <h4 className="font-semibold text-sm">{m.name}</h4>
            <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
          </div>
        ))}
      </div>

      {/* Competitive comparison */}
      <div className="rounded-xl border bg-gradient-to-br from-orange-500/5 to-red-500/5 p-5">
        <h4 className="text-sm font-semibold mb-3">🚀 Why JoyCreate Training Beats IBM Watson / Google AutoML</h4>
        <div className="grid md:grid-cols-2 gap-3 text-xs">
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <span><strong>100% local</strong> — your data never leaves your machine</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <span><strong>Zero API costs</strong> — train on your own GPU/CPU forever</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <span><strong>Any model</strong> — Llama, DeepSeek, GLM, Mistral, custom ONNX</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <span><strong>Export anywhere</strong> — ONNX, GGUF, SafeTensors, HuggingFace, Docker</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <span><strong>Marketplace</strong> — sell your trained models on JoyMarketplace</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <span><strong>Annotation → Training → Deployment</strong> in one platform</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 6. Evaluation Tab ────────────────────────────────────────────────────────

function EvaluationTab() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Pipeline & Model Evaluation</h3>
        <p className="text-sm text-muted-foreground">Benchmark engines, compare models, and track metrics over time</p>
      </div>

      {/* Metrics grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { metric: "Precision / Recall / F1", desc: "Standard classification metrics per label", icon: Target },
          { metric: "BLEU / ROUGE / METEOR", desc: "Generation quality for summaries and translations", icon: BarChart2 },
          { metric: "Perplexity", desc: "Language model quality metric", icon: Brain },
          { metric: "Exact Match / F1 (QA)", desc: "Question answering accuracy", icon: Search },
          { metric: "Cohen's Kappa", desc: "Inter-annotator agreement", icon: Users },
          { metric: "Latency / Throughput", desc: "Tokens/sec, p95 latency, memory usage", icon: Timer },
        ].map((m) => (
          <div key={m.metric} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <m.icon className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm">{m.metric}</span>
            </div>
            <p className="text-xs text-muted-foreground">{m.desc}</p>
          </div>
        ))}
      </div>

      {/* How to evaluate */}
      <div className="rounded-xl border bg-muted/20 p-5">
        <h4 className="text-sm font-semibold mb-3">Evaluation Workflow</h4>
        <div className="flex items-center gap-3 overflow-x-auto text-xs">
          {["Select Pipeline", "Choose Test Set", "Run Evaluation", "View Metrics", "Compare Models", "Export Report"].map((step, i) => (
            <React.Fragment key={step}>
              <div className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg bg-card border">
                <Badge variant="outline" className="text-xs">{i + 1}</Badge>
                {step}
              </div>
              {i < 5 && <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 7. Embeddings Tab ────────────────────────────────────────────────────────

function EmbeddingsTab() {
  const [text, setText] = useState("");
  const [embedding, setEmbedding] = useState<number[] | null>(null);
  const [processing, setProcessing] = useState(false);

  const generateEmbedding = async () => {
    if (!text.trim()) return;
    setProcessing(true);
    try {
      const result = await invoke("embedding:embed-query", text);
      setEmbedding(Array.isArray(result) ? result : (result?.embedding ?? result?.vector ?? null));
    } catch (err) { console.error(err); }
    setProcessing(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Vector Embeddings Explorer</h3>
        <p className="text-sm text-muted-foreground">Generate, visualize, and search semantic vector spaces</p>
      </div>

      {/* Embedding generator */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text to embed..."
          className="w-full h-24 px-3 py-2 rounded-lg border bg-background text-sm resize-y"
        />
        <div className="flex gap-2">
          <Button onClick={generateEmbedding} disabled={processing || !text.trim()}>
            {processing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Box className="h-4 w-4 mr-1" />}
            Generate Embedding
          </Button>
        </div>

        {embedding && (
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs">{embedding.length} dimensions</Badge>
              <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(JSON.stringify(embedding))}>
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>
            {/* Mini visualization */}
            <div className="flex gap-px h-16 items-end rounded-lg bg-muted/30 p-1 overflow-hidden">
              {embedding.slice(0, 100).map((v, i) => (
                <div
                  key={i}
                  className={cn("flex-1 min-w-[2px] rounded-t-sm", v >= 0 ? "bg-blue-500" : "bg-red-500")}
                  style={{ height: `${Math.min(Math.abs(v) * 300, 100)}%`, opacity: 0.7 }}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">First 100 of {embedding.length} dimensions shown</p>
          </div>
        )}
      </div>

      {/* Embedding models */}
      <div className="grid md:grid-cols-3 gap-3">
        {[
          { name: "nomic-embed-text", dims: 768, desc: "General purpose text embeddings", speed: "Fast" },
          { name: "bge-small-en", dims: 384, desc: "Compact, high quality English", speed: "Very Fast" },
          { name: "all-MiniLM-L6-v2", dims: 384, desc: "Sentence transformers classic", speed: "Fast" },
        ].map((m) => (
          <div key={m.name} className="rounded-xl border bg-card p-3">
            <div className="font-medium text-sm">{m.name}</div>
            <div className="flex gap-2 mt-1">
              <Badge variant="outline" className="text-xs">{m.dims}d</Badge>
              <Badge variant="outline" className="text-xs">{m.speed}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
          </div>
        ))}
      </div>

      {/* Use cases */}
      <div className="rounded-xl border bg-muted/20 p-4">
        <h4 className="text-sm font-semibold mb-2">Embedding Applications</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {["Semantic Search", "Document Clustering", "Duplicate Detection", "Recommendation", "RAG Retrieval", "Similarity Scoring", "Anomaly Detection", "Zero-shot Classification"].map((use) => (
            <div key={use} className="p-2 rounded-lg bg-card border text-center">{use}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 8. Export & Deploy Tab ───────────────────────────────────────────────────

function ExportDeployTab() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Export & Deploy</h3>
        <p className="text-sm text-muted-foreground">Package pipelines and models for production deployment</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { format: "Docker Container", desc: "Self-contained inference server with REST API", icon: Box, color: "text-blue-500" },
          { format: "ONNX Runtime", desc: "Cross-platform optimized model format", icon: Cpu, color: "text-green-500" },
          { format: "GGUF (llama.cpp)", desc: "Quantized models for efficient CPU inference", icon: Terminal, color: "text-orange-500" },
          { format: "HuggingFace Hub", desc: "Push to HuggingFace model hub", icon: Globe, color: "text-yellow-500" },
          { format: "REST API", desc: "Auto-generated OpenAPI server with docs", icon: Code, color: "text-purple-500" },
          { format: "JoyMarketplace", desc: "Publish as a paid model on the marketplace", icon: Rocket, color: "text-pink-500" },
          { format: "Python Package", desc: "pip-installable package with CLI", icon: FileText, color: "text-cyan-500" },
          { format: "Edge / WASM", desc: "Browser-ready WebAssembly deployment", icon: Zap, color: "text-red-500" },
          { format: "Celestia DA", desc: "Publish to decentralized data availability layer", icon: Lock, color: "text-indigo-500" },
        ].map((f) => (
          <div key={f.format} className="rounded-xl border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer">
            <f.icon className={cn("h-6 w-6 mb-2", f.color)} />
            <h4 className="font-semibold text-sm">{f.format}</h4>
            <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* The IBM killer pitch */}
      <div className="rounded-xl border bg-gradient-to-br from-red-500/5 to-orange-500/5 p-6">
        <h4 className="font-semibold mb-3">🏆 The Complete NLP Platform — Why JoyCreate Wins</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2 font-semibold">Feature</th>
                <th className="text-center p-2">IBM Watson</th>
                <th className="text-center p-2">GATE</th>
                <th className="text-center p-2">Stanford</th>
                <th className="text-center p-2 text-primary font-bold">JoyCreate</th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: "Runs 100% Local", ibm: false, gate: true, stanford: true, joy: true },
                { feature: "35+ Analysis Engines", ibm: false, gate: true, stanford: false, joy: true },
                { feature: "Visual Pipeline Builder", ibm: true, gate: true, stanford: false, joy: true },
                { feature: "Annotation Studio", ibm: false, gate: true, stanford: false, joy: true },
                { feature: "Model Training (LoRA)", ibm: false, gate: false, stanford: false, joy: true },
                { feature: "Multimodal (OCR/ASR/TTS)", ibm: true, gate: false, stanford: false, joy: true },
                { feature: "Knowledge Graph Builder", ibm: true, gate: false, stanford: true, joy: true },
                { feature: "LLM-Powered Engines", ibm: true, gate: false, stanford: false, joy: true },
                { feature: "Marketplace Publishing", ibm: false, gate: false, stanford: false, joy: true },
                { feature: "Zero Data Lock-in", ibm: false, gate: true, stanford: true, joy: true },
                { feature: "Zero API Costs", ibm: false, gate: true, stanford: true, joy: true },
                { feature: "Web3 / Decentralized", ibm: false, gate: false, stanford: false, joy: true },
              ].map((row) => (
                <tr key={row.feature} className="border-b">
                  <td className="p-2 font-medium">{row.feature}</td>
                  <td className="p-2 text-center">{row.ibm ? <CheckCircle className="h-4 w-4 text-green-500 inline" /> : <XCircle className="h-4 w-4 text-red-400 inline" />}</td>
                  <td className="p-2 text-center">{row.gate ? <CheckCircle className="h-4 w-4 text-green-500 inline" /> : <XCircle className="h-4 w-4 text-red-400 inline" />}</td>
                  <td className="p-2 text-center">{row.stanford ? <CheckCircle className="h-4 w-4 text-green-500 inline" /> : <XCircle className="h-4 w-4 text-red-400 inline" />}</td>
                  <td className="p-2 text-center"><CheckCircle className="h-4 w-4 text-primary inline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Users placeholder for Evaluation
const Users = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

// ── Main Page ────────────────────────────────────────────────────────────────

export default function NlpStudioPage() {
  const [activeTab, setActiveTab] = useState<TabId>("pipeline");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600">
            <Brain className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">NLP & AI Model Studio</h1>
            <p className="text-sm text-muted-foreground">
              The complete platform for natural language processing — pipelines, annotation, training, evaluation, and deployment.
              Replaces UIMA, GATE, Stanford CoreNLP, OpenNLP, DKPro, ClearTK, and IBM Watson NLU.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="text-xs">35+ Engines</Badge>
            <Badge variant="outline" className="text-xs">8 Task Types</Badge>
            <Badge variant="outline" className="text-xs">100% Local</Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b px-6">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                  activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "pipeline" && <PipelineBuilderTab />}
        {activeTab === "analysis" && <AnalysisWorkbenchTab />}
        {activeTab === "corpus" && <CorpusManagerTab />}
        {activeTab === "annotation" && <AnnotationStudioTab />}
        {activeTab === "training" && <ModelTrainingTab />}
        {activeTab === "evaluation" && <EvaluationTab />}
        {activeTab === "embeddings" && <EmbeddingsTab />}
        {activeTab === "deploy" && <ExportDeployTab />}
      </div>
    </div>
  );
}
