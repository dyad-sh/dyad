/**
 * Dataset Studio Page
 * Comprehensive local-first dataset creation, management, and publishing
 * Includes: Web scraping, multimodal items, AI generation, provenance tracking, P2P sync
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { scraperClient } from "@/ipc/scraper_client";
import { getDatasetStudioClient } from "@/ipc/dataset_studio_client";
import type {
  ScrapingConfig,
  ScrapingJob,
  Dataset,
  DatasetPreview,
  ScrapingField,
  ScrapingTemplate,
} from "@/types/scraper_types";
import type { DatasetItem, DatasetManifest, GenerationJob, StudioDataset } from "@/ipc/dataset_studio_client";
import {
  useStudioDatasets,
  useCreateDataset,
  useDeleteDataset,
  useDatasetItems,
  useDatasetManifest,
  useGenerationJobs,
  useBuildManifest,
  useCreateSplits,
  useSignManifest,
  useCreateGenerationJob,
  useP2pSyncStatus,
  useExportDataset,
  useAddItemFromFile,
  useDeleteDatasetItem,
  useUpdateItemLabels,
} from "@/hooks/useDatasetStudio";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Database,
  Globe,
  Plus,
  Play,
  Pause,
  Download,
  Trash2,
  MoreVertical,
  RefreshCw,
  FileJson,
  FileSpreadsheet,
  Layers,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Settings2,
  Eye,
  Sparkles,
  Copy,
  Upload,
  Zap,
  Target,
  Image,
  FileText,
  Music,
  Video,
  Code,
  Hash,
  Shield,
  Users,
  GitBranch,
  Share2,
  Lock,
  Fingerprint,
  Split,
  Package,
  Wand2,
  Brain,
  Tag,
  Filter,
  Search,
  FolderOpen,
  FileUp,
  Signature,
} from "lucide-react";

export default function DatasetPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("studio");
  const [isNewConfigOpen, setIsNewConfigOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreview | null>(null);

  // Dataset Studio state
  const [selectedStudioDataset, setSelectedStudioDataset] = useState<string | null>(null);
  const [isCreateDatasetOpen, setIsCreateDatasetOpen] = useState(false);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isBuildManifestOpen, setIsBuildManifestOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [itemFilter, setItemFilter] = useState({ modality: "", split: "" });
  const [selectedItem, setSelectedItem] = useState<DatasetItem | null>(null);
  
  // Split creation state
  const [splitRatios, setSplitRatios] = useState({ train: 0.8, val: 0.1, test: 0.1 });
  
  // Generation form state
  const [generationForm, setGenerationForm] = useState({
    jobType: "text_generation" as const,
    modelId: "",
    prompt: "",
    targetCount: 100,
    temperature: 0.7,
  });

  // Config form state
  const [configForm, setConfigForm] = useState<Partial<ScrapingConfig>>({
    name: "",
    sourceUrl: "",
    mode: "local",
    fields: [],
  });
  const [currentField, setCurrentField] = useState<Partial<ScrapingField>>({
    name: "",
    type: "text",
    selector: "",
    selectorType: "css",
  });

  // Create dataset form state
  const [createDatasetForm, setCreateDatasetForm] = useState({
    name: "",
    description: "",
    license: "cc-by-4.0",
    datasetType: "custom" as const,
  });

  // Dataset Studio hooks - Fetch Studio datasets (the new table)
  const { data: studioDatasets = [], isLoading: studioLoading } = useStudioDatasets();
  const createDatasetMutation = useCreateDataset();
  const deleteDatasetMutation = useDeleteDataset();
  
  const { data: studioItems, isLoading: itemsLoading } = useDatasetItems(
    selectedStudioDataset || "",
    {
      modality: itemFilter.modality || undefined,
      split: itemFilter.split || undefined,
      enabled: !!selectedStudioDataset,
    }
  );
  const { data: manifest } = useDatasetManifest(selectedStudioDataset || "", !!selectedStudioDataset);
  const { data: generationJobs } = useGenerationJobs(selectedStudioDataset || "", !!selectedStudioDataset);
  const { data: p2pStatus } = useP2pSyncStatus(selectedStudioDataset || "", !!selectedStudioDataset);
  
  const addItemMutation = useAddItemFromFile();
  const deleteItemMutation = useDeleteDatasetItem();
  const buildManifestMutation = useBuildManifest();
  const createSplitsMutation = useCreateSplits();
  const signManifestMutation = useSignManifest();
  const createJobMutation = useCreateGenerationJob();
  const exportMutation = useExportDataset();

  // Fetch scraper status
  const { data: status } = useQuery({
    queryKey: ["scraper-status"],
    queryFn: () => scraperClient.getStatus(),
    refetchInterval: 5000,
  });

  // Fetch configs
  const { data: configs = [], isLoading: configsLoading } = useQuery({
    queryKey: ["scraper-configs"],
    queryFn: () => scraperClient.listConfigs(),
  });

  // Fetch scraped datasets (file-based from scraper)
  const { data: scrapedDatasets = [], isLoading: datasetsLoading } = useQuery({
    queryKey: ["scraped-datasets"],
    queryFn: () => scraperClient.listDatasets(),
  });

  // Fetch jobs
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ["scraper-jobs"],
    queryFn: () => scraperClient.listJobs(),
    refetchInterval: 2000,
  });

  // Fetch templates
  const { data: templates = [] } = useQuery({
    queryKey: ["scraper-templates"],
    queryFn: () => scraperClient.getTemplates(),
  });

  // Save config mutation
  const saveConfigMutation = useMutation({
    mutationFn: (config: Partial<ScrapingConfig>) => scraperClient.saveConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scraper-configs"] });
      toast.success("Scraping config saved");
      setIsNewConfigOpen(false);
      setConfigForm({ name: "", sourceUrl: "", mode: "local", fields: [] });
    },
    onError: (error) => {
      toast.error(`Failed to save config: ${error.message}`);
    },
  });

  // Start job mutation
  const startJobMutation = useMutation({
    mutationFn: (configId: string) => scraperClient.startJob(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scraper-jobs"] });
      toast.success("Scraping job started");
    },
    onError: (error) => {
      toast.error(`Failed to start job: ${error.message}`);
    },
  });

  // Delete config mutation
  const deleteConfigMutation = useMutation({
    mutationFn: (configId: string) => scraperClient.deleteConfig(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scraper-configs"] });
      toast.success("Config deleted");
    },
  });

  // Delete scraped dataset mutation
  const deleteScrapedDatasetMutation = useMutation({
    mutationFn: (datasetId: string) => scraperClient.deleteDataset(datasetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scraped-datasets"] });
      toast.success("Scraped dataset deleted");
    },
  });

  // Export dataset mutation
  const exportDatasetMutation = useMutation({
    mutationFn: ({ datasetId, format }: { datasetId: string; format: string }) =>
      scraperClient.exportDataset(datasetId, { format: format as "json" | "csv" | "jsonl" }),
    onSuccess: (filePath) => {
      toast.success(`Dataset exported to ${filePath}`);
    },
  });

  // Preview dataset
  const handlePreview = async (dataset: Dataset) => {
    setSelectedDataset(dataset);
    try {
      const preview = await scraperClient.previewDataset(dataset.id, 50);
      setPreviewData(preview);
      setIsPreviewOpen(true);
    } catch (error) {
      toast.error("Failed to load preview");
    }
  };

  // Add field to config
  const addField = () => {
    if (!currentField.name || !currentField.selector) {
      toast.error("Field name and selector are required");
      return;
    }
    const newField: ScrapingField = {
      id: Date.now().toString(),
      name: currentField.name,
      type: currentField.type || "text",
      selector: currentField.selector,
      selectorType: currentField.selectorType || "css",
    };
    setConfigForm({
      ...configForm,
      fields: [...(configForm.fields || []), newField],
    });
    setCurrentField({ name: "", type: "text", selector: "", selectorType: "css" });
  };

  // Remove field from config
  const removeField = (fieldId: string) => {
    setConfigForm({
      ...configForm,
      fields: (configForm.fields || []).filter((f) => f.id !== fieldId),
    });
  };

  // Use template
  const useTemplate = (template: ScrapingTemplate) => {
    setConfigForm({
      name: template.name,
      mode: "local",
      fields: template.config.fields,
    });
    setIsNewConfigOpen(true);
    toast.success(`Template "${template.name}" loaded`);
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Job status badge
  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/50">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/50">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/50">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-background via-background to-emerald-950/5">
      {/* Header */}
      <div className="flex-none border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                <Database className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
                  Data Studio
                </h1>
                <p className="text-sm text-muted-foreground">
                  Web scraping & dataset management • Local-first approach
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Status indicator */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-400">
                  {status?.activeJobs || 0} active jobs
                </span>
              </div>
              <Dialog open={isNewConfigOpen} onOpenChange={setIsNewConfigOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg">
                    <Plus className="w-4 h-4 mr-2" />
                    New Scraper
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Create Scraping Config</DialogTitle>
                    <DialogDescription>
                      Configure your web scraper to extract data from websites
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Config Name</Label>
                        <Input
                          placeholder="My Scraper"
                          value={configForm.name}
                          onChange={(e) =>
                            setConfigForm({ ...configForm, name: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Mode</Label>
                        <Select
                          value={configForm.mode}
                          onValueChange={(value) =>
                            setConfigForm({
                              ...configForm,
                              mode: value as "local" | "api" | "hybrid",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="local">
                              <div className="flex items-center gap-2">
                                <Zap className="w-4 h-4 text-emerald-500" />
                                Local (Free)
                              </div>
                            </SelectItem>
                            <SelectItem value="api">
                              <div className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-blue-500" />
                                API (Heavy tasks)
                              </div>
                            </SelectItem>
                            <SelectItem value="hybrid">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-violet-500" />
                                Hybrid (Auto)
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Target URL</Label>
                      <Input
                        placeholder="https://example.com/products"
                        value={configForm.sourceUrl}
                        onChange={(e) =>
                          setConfigForm({ ...configForm, sourceUrl: e.target.value })
                        }
                      />
                    </div>

                    {/* Fields */}
                    <div className="space-y-3">
                      <Label>Extraction Fields</Label>
                      {(configForm.fields || []).length > 0 && (
                        <div className="space-y-2">
                          {(configForm.fields || []).map((field) => (
                            <div
                              key={field.id}
                              className="flex items-center justify-between p-2 rounded-lg bg-muted/50 border"
                            >
                              <div className="flex items-center gap-2">
                                <Target className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium">{field.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {field.type}
                                </Badge>
                                <code className="text-xs text-muted-foreground">
                                  {field.selector}
                                </code>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeField(field.id)}
                              >
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-4 gap-2 p-3 rounded-lg border border-dashed">
                        <Input
                          placeholder="Field name"
                          value={currentField.name}
                          onChange={(e) =>
                            setCurrentField({ ...currentField, name: e.target.value })
                          }
                        />
                        <Select
                          value={currentField.type}
                          onValueChange={(value) =>
                            setCurrentField({
                              ...currentField,
                              type: value as ScrapingField["type"],
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="url">URL</SelectItem>
                            <SelectItem value="image">Image</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                            <SelectItem value="array">Array</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="CSS selector"
                          value={currentField.selector}
                          onChange={(e) =>
                            setCurrentField({ ...currentField, selector: e.target.value })
                          }
                        />
                        <Button onClick={addField} variant="outline">
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsNewConfigOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => saveConfigMutation.mutate(configForm)}
                      disabled={!configForm.name || !configForm.sourceUrl}
                    >
                      Save Config
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="px-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="studio" className="data-[state=active]:bg-background">
              <Sparkles className="w-4 h-4 mr-2" />
              Studio ({studioDatasets.length})
            </TabsTrigger>
            <TabsTrigger value="datasets" className="data-[state=active]:bg-background">
              <Database className="w-4 h-4 mr-2" />
              Scraped ({scrapedDatasets.length})
            </TabsTrigger>
            <TabsTrigger value="scrapers" className="data-[state=active]:bg-background">
              <Globe className="w-4 h-4 mr-2" />
              Scrapers ({configs.length})
            </TabsTrigger>
            <TabsTrigger value="jobs" className="data-[state=active]:bg-background">
              <RefreshCw className="w-4 h-4 mr-2" />
              Jobs ({jobs.filter((j) => j.status === "running").length} active)
            </TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-background">
              <Layers className="w-4 h-4 mr-2" />
              Templates
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              {/* Dataset Studio Tab */}
              <TabsContent value="studio" className="mt-0 space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                  {/* Left Panel - Dataset List & Actions */}
                  <div className="lg:col-span-1 space-y-4">
                    {/* Create New Dataset */}
                    <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-teal-500/5">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Plus className="w-4 h-4" />
                          Create Dataset
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Dialog open={isCreateDatasetOpen} onOpenChange={setIsCreateDatasetOpen}>
                          <DialogTrigger asChild>
                            <Button className="w-full bg-gradient-to-r from-emerald-500 to-teal-600">
                              <Plus className="w-4 h-4 mr-2" />
                              New Dataset
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Create New Dataset</DialogTitle>
                              <DialogDescription>
                                Create a dataset to store multimodal data with full provenance tracking
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <Label>Dataset Name</Label>
                                <Input 
                                  placeholder="My Dataset" 
                                  value={createDatasetForm.name}
                                  onChange={(e) => setCreateDatasetForm({...createDatasetForm, name: e.target.value})}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea 
                                  placeholder="Describe your dataset..." 
                                  value={createDatasetForm.description}
                                  onChange={(e) => setCreateDatasetForm({...createDatasetForm, description: e.target.value})}
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>Dataset Type</Label>
                                  <Select 
                                    value={createDatasetForm.datasetType}
                                    onValueChange={(v) => setCreateDatasetForm({...createDatasetForm, datasetType: v as any})}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="custom">Custom</SelectItem>
                                      <SelectItem value="training">Training</SelectItem>
                                      <SelectItem value="evaluation">Evaluation</SelectItem>
                                      <SelectItem value="fine_tuning">Fine-tuning</SelectItem>
                                      <SelectItem value="rag">RAG Knowledge Base</SelectItem>
                                      <SelectItem value="mixed">Mixed</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label>License</Label>
                                  <Select 
                                    value={createDatasetForm.license}
                                    onValueChange={(v) => setCreateDatasetForm({...createDatasetForm, license: v})}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="cc-by-4.0">CC BY 4.0</SelectItem>
                                      <SelectItem value="cc-by-sa-4.0">CC BY-SA 4.0</SelectItem>
                                      <SelectItem value="cc0">CC0 (Public Domain)</SelectItem>
                                      <SelectItem value="mit">MIT</SelectItem>
                                      <SelectItem value="apache-2.0">Apache 2.0</SelectItem>
                                      <SelectItem value="proprietary">Proprietary</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setIsCreateDatasetOpen(false)}>Cancel</Button>
                              <Button 
                                className="bg-gradient-to-r from-emerald-500 to-teal-600"
                                disabled={!createDatasetForm.name || createDatasetMutation.isPending}
                                onClick={() => {
                                  createDatasetMutation.mutate({
                                    name: createDatasetForm.name,
                                    description: createDatasetForm.description || undefined,
                                    datasetType: createDatasetForm.datasetType,
                                    license: createDatasetForm.license,
                                  }, {
                                    onSuccess: (result) => {
                                      setIsCreateDatasetOpen(false);
                                      setCreateDatasetForm({ name: "", description: "", license: "cc-by-4.0", datasetType: "custom" });
                                      setSelectedStudioDataset(result.datasetId);
                                    }
                                  });
                                }}
                              >
                                {createDatasetMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <Plus className="w-4 h-4 mr-2" />
                                )}
                                Create
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </CardContent>
                    </Card>

                    {/* Dataset List */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Database className="w-4 h-4" />
                            Datasets
                          </span>
                          <Badge variant="outline">{studioDatasets.length}</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <ScrollArea className="h-[300px]">
                          {studioDatasets.length === 0 ? (
                            <div className="p-4 text-center text-muted-foreground text-sm">
                              No datasets yet. Create one to get started!
                            </div>
                          ) : (
                            <div className="divide-y">
                              {studioDatasets.map((ds) => (
                                <button
                                  key={ds.id}
                                  className={`w-full p-3 text-left hover:bg-muted/50 transition-colors ${
                                    selectedStudioDataset === ds.id ? "bg-emerald-500/10 border-l-2 border-l-emerald-500" : ""
                                  }`}
                                  onClick={() => setSelectedStudioDataset(ds.id)}
                                >
                                  <div className="flex items-center gap-2">
                                    <Database className="w-4 h-4 text-emerald-500" />
                                    <span className="font-medium text-sm truncate">{ds.name}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                    <span>{ds.itemCount || 0} items</span>
                                    <span>•</span>
                                    <span>{formatSize(ds.totalBytes || 0)}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </ScrollArea>
                      </CardContent>
                    </Card>

                    {/* Quick Stats */}
                    {selectedStudioDataset && manifest && (
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Hash className="w-4 h-4" />
                            Provenance
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Version</span>
                            <Badge variant="outline">{manifest.version}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Status</span>
                            <Badge className={
                              manifest.publishStatus === "marketplace_published" 
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-yellow-500/20 text-yellow-400"
                            }>
                              {manifest.publishStatus}
                            </Badge>
                          </div>
                          {manifest.manifestHash && (
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Hash</span>
                              <code className="text-xs bg-muted px-1 rounded truncate max-w-[120px]">
                                {manifest.manifestHash.slice(0, 12)}...
                              </code>
                            </div>
                          )}
                          {manifest.creatorSignature && (
                            <div className="flex items-center gap-1 text-emerald-500">
                              <Signature className="w-3 h-3" />
                              <span className="text-xs">Signed</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* Right Panel - Items & Actions */}
                  <div className="lg:col-span-3 space-y-4">
                    {!selectedStudioDataset ? (
                      <Card className="border-dashed">
                        <CardContent className="py-16 text-center">
                          <Database className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                          <h3 className="text-xl font-medium mb-2">Select a Dataset</h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            Choose a dataset from the list or create a new one to get started
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <>
                        {/* Action Bar */}
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-2">
                            {/* Add Items */}
                            <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <FileUp className="w-4 h-4 mr-2" />
                                  Add Items
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Add Items to Dataset</DialogTitle>
                                  <DialogDescription>
                                    Upload files or import from various sources
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="grid grid-cols-2 gap-4 py-4">
                                  <Button variant="outline" className="h-24 flex-col gap-2">
                                    <Upload className="w-6 h-6" />
                                    <span>Upload Files</span>
                                  </Button>
                                  <Button variant="outline" className="h-24 flex-col gap-2">
                                    <FolderOpen className="w-6 h-6" />
                                    <span>Import Folder</span>
                                  </Button>
                                  <Button variant="outline" className="h-24 flex-col gap-2">
                                    <Globe className="w-6 h-6" />
                                    <span>From URL</span>
                                  </Button>
                                  <Button variant="outline" className="h-24 flex-col gap-2">
                                    <Database className="w-6 h-6" />
                                    <span>From Scraper</span>
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>

                            {/* Generate with AI */}
                            <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10">
                                  <Wand2 className="w-4 h-4 mr-2" />
                                  Generate
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-lg">
                                <DialogHeader>
                                  <DialogTitle>Generate Data with Local AI</DialogTitle>
                                  <DialogDescription>
                                    Use local AI models to generate synthetic data
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <Label>Generation Type</Label>
                                    <Select 
                                      value={generationForm.jobType}
                                      onValueChange={(v) => setGenerationForm({...generationForm, jobType: v as any})}
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="text_generation">
                                          <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4" />
                                            Text Generation
                                          </div>
                                        </SelectItem>
                                        <SelectItem value="image_generation">
                                          <div className="flex items-center gap-2">
                                            <Image className="w-4 h-4" />
                                            Image Generation
                                          </div>
                                        </SelectItem>
                                        <SelectItem value="augmentation">
                                          <div className="flex items-center gap-2">
                                            <Sparkles className="w-4 h-4" />
                                            Data Augmentation
                                          </div>
                                        </SelectItem>
                                        <SelectItem value="labeling">
                                          <div className="flex items-center gap-2">
                                            <Tag className="w-4 h-4" />
                                            Auto-Labeling
                                          </div>
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Prompt Template</Label>
                                    <Textarea 
                                      placeholder="Generate {count} examples of..."
                                      value={generationForm.prompt}
                                      onChange={(e) => setGenerationForm({...generationForm, prompt: e.target.value})}
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                      <Label>Target Count</Label>
                                      <Input 
                                        type="number" 
                                        value={generationForm.targetCount}
                                        onChange={(e) => setGenerationForm({...generationForm, targetCount: parseInt(e.target.value)})}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Temperature: {generationForm.temperature}</Label>
                                      <Slider 
                                        value={[generationForm.temperature]} 
                                        min={0} 
                                        max={1} 
                                        step={0.1}
                                        onValueChange={([v]) => setGenerationForm({...generationForm, temperature: v})}
                                      />
                                    </div>
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setIsGenerateOpen(false)}>Cancel</Button>
                                  <Button 
                                    className="bg-gradient-to-r from-violet-500 to-purple-600"
                                    onClick={() => {
                                      createJobMutation.mutate({
                                        datasetId: selectedStudioDataset,
                                        jobType: generationForm.jobType,
                                        config: {
                                          prompt: generationForm.prompt,
                                          targetCount: generationForm.targetCount,
                                          temperature: generationForm.temperature,
                                        },
                                        providerType: "local",
                                        providerId: "ollama",
                                        modelId: generationForm.modelId || "llama3.2",
                                      });
                                      setIsGenerateOpen(false);
                                    }}
                                  >
                                    <Brain className="w-4 h-4 mr-2" />
                                    Start Generation
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>

                            {/* Create Splits */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <Split className="w-4 h-4 mr-2" />
                                  Splits
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="w-64 p-4">
                                <div className="space-y-3">
                                  <h4 className="font-medium text-sm">Create Train/Val/Test Splits</h4>
                                  <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                      <span>Train: {Math.round(splitRatios.train * 100)}%</span>
                                      <span>Val: {Math.round(splitRatios.val * 100)}%</span>
                                      <span>Test: {Math.round(splitRatios.test * 100)}%</span>
                                    </div>
                                  </div>
                                  <Button 
                                    size="sm" 
                                    className="w-full"
                                    onClick={() => {
                                      createSplitsMutation.mutate({
                                        datasetId: selectedStudioDataset,
                                        ratios: splitRatios,
                                      });
                                    }}
                                  >
                                    Apply Splits
                                  </Button>
                                </div>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Build Manifest */}
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => buildManifestMutation.mutate({
                                datasetId: selectedStudioDataset,
                                version: "1.0.0",
                                license: "cc-by-4.0",
                              })}
                            >
                              <Package className="w-4 h-4 mr-2" />
                              Build Manifest
                            </Button>

                            {/* Sign */}
                            {manifest && !manifest.creatorSignature && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="border-emerald-500/30 text-emerald-400"
                                onClick={() => signManifestMutation.mutate(manifest.id)}
                              >
                                <Fingerprint className="w-4 h-4 mr-2" />
                                Sign
                              </Button>
                            )}

                            {/* Export */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <Download className="w-4 h-4 mr-2" />
                                  Export
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem>
                                  <FileJson className="w-4 h-4 mr-2" />
                                  JSONL Format
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Package className="w-4 h-4 mr-2" />
                                  HuggingFace Format
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                                  Parquet Format
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>

                            {/* P2P Share */}
                            <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400">
                              <Share2 className="w-4 h-4 mr-2" />
                              P2P Share
                            </Button>
                          </div>
                        </div>

                        {/* Filters */}
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Filter className="w-4 h-4 text-muted-foreground" />
                            <Select 
                              value={itemFilter.modality || "all"}
                              onValueChange={(v) => setItemFilter({...itemFilter, modality: v === "all" ? "" : v})}
                            >
                              <SelectTrigger className="w-[140px] h-8">
                                <SelectValue placeholder="All Types" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="text">
                                  <div className="flex items-center gap-2">
                                    <FileText className="w-3 h-3" /> Text
                                  </div>
                                </SelectItem>
                                <SelectItem value="image">
                                  <div className="flex items-center gap-2">
                                    <Image className="w-3 h-3" /> Image
                                  </div>
                                </SelectItem>
                                <SelectItem value="audio">
                                  <div className="flex items-center gap-2">
                                    <Music className="w-3 h-3" /> Audio
                                  </div>
                                </SelectItem>
                                <SelectItem value="video">
                                  <div className="flex items-center gap-2">
                                    <Video className="w-3 h-3" /> Video
                                  </div>
                                </SelectItem>
                                <SelectItem value="context">
                                  <div className="flex items-center gap-2">
                                    <Code className="w-3 h-3" /> Context
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <Select 
                              value={itemFilter.split || "all"}
                              onValueChange={(v) => setItemFilter({...itemFilter, split: v === "all" ? "" : v})}
                            >
                              <SelectTrigger className="w-[120px] h-8">
                                <SelectValue placeholder="All Splits" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Splits</SelectItem>
                                <SelectItem value="train">Train</SelectItem>
                                <SelectItem value="val">Validation</SelectItem>
                                <SelectItem value="test">Test</SelectItem>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input placeholder="Search items..." className="pl-8 h-8" />
                            </div>
                          </div>
                        </div>

                        {/* Items Grid/List */}
                        {itemsLoading ? (
                          <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          </div>
                        ) : !studioItems?.items?.length ? (
                          <Card className="border-dashed">
                            <CardContent className="py-12 text-center">
                              <FileUp className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                              <h3 className="text-lg font-medium">No items yet</h3>
                              <p className="text-sm text-muted-foreground mb-4">
                                Add items to your dataset to get started
                              </p>
                              <Button onClick={() => setIsAddItemOpen(true)}>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Items
                              </Button>
                            </CardContent>
                          </Card>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {studioItems.items.map((item: DatasetItem) => (
                              <Card 
                                key={item.id} 
                                className="group cursor-pointer hover:border-emerald-500/50 transition-all"
                                onClick={() => setSelectedItem(item)}
                              >
                                <CardContent className="p-3">
                                  {/* Preview */}
                                  <div className="aspect-square rounded-lg bg-muted/50 mb-2 flex items-center justify-center overflow-hidden">
                                    {item.modality === "image" && item.thumbnailPath ? (
                                      <img 
                                        src={`file://${item.thumbnailPath}`} 
                                        alt="" 
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="text-muted-foreground">
                                        {item.modality === "text" && <FileText className="w-8 h-8" />}
                                        {item.modality === "image" && <Image className="w-8 h-8" />}
                                        {item.modality === "audio" && <Music className="w-8 h-8" />}
                                        {item.modality === "video" && <Video className="w-8 h-8" />}
                                        {item.modality === "context" && <Code className="w-8 h-8" />}
                                      </div>
                                    )}
                                  </div>
                                  {/* Info */}
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <Badge variant="outline" className="text-xs">
                                        {item.modality}
                                      </Badge>
                                      <Badge 
                                        variant="outline" 
                                        className={`text-xs ${
                                          item.split === "train" ? "border-blue-500/50 text-blue-400" :
                                          item.split === "val" ? "border-yellow-500/50 text-yellow-400" :
                                          item.split === "test" ? "border-emerald-500/50 text-emerald-400" :
                                          ""
                                        }`}
                                      >
                                        {item.split}
                                      </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {formatSize(item.byteSize)}
                                    </p>
                                    {item.sourceType === "generated" && (
                                      <div className="flex items-center gap-1 text-xs text-violet-400">
                                        <Wand2 className="w-3 h-3" />
                                        AI Generated
                                      </div>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}

                        {/* Generation Jobs */}
                        {generationJobs && generationJobs.length > 0 && (
                          <Card>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-base flex items-center gap-2">
                                <Brain className="w-4 h-4" />
                                Generation Jobs
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {generationJobs.map((job: GenerationJob) => (
                                  <div key={job.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="font-medium text-sm">{job.jobType}</span>
                                        {getJobStatusBadge(job.status)}
                                      </div>
                                      <Progress value={job.progress} className="h-1" />
                                      <p className="text-xs text-muted-foreground mt-1">
                                        {job.completedItems} / {job.totalItems} items
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Datasets Tab */}
              <TabsContent value="datasets" className="mt-0 space-y-4">
                {datasetsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : scrapedDatasets.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                      <Database className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium">No scraped datasets yet</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Create a scraper to collect data or import an existing dataset
                      </p>
                      <div className="flex justify-center gap-2">
                        <Button onClick={() => setIsNewConfigOpen(true)}>
                          <Plus className="w-4 h-4 mr-2" />
                          Create Scraper
                        </Button>
                        <Button variant="outline">
                          <Upload className="w-4 h-4 mr-2" />
                          Import Dataset
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {scrapedDatasets.map((dataset) => (
                      <Card
                        key={dataset.id}
                        className="group hover:border-emerald-500/50 transition-all duration-200"
                      >
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
                                <Database className="w-5 h-5 text-emerald-500" />
                              </div>
                              <div>
                                <CardTitle className="text-base">{dataset.name}</CardTitle>
                                <CardDescription className="text-xs">
                                  {dataset.stats.rowCount} rows •{" "}
                                  {formatSize(dataset.stats.sizeBytes)}
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
                                <DropdownMenuItem onClick={() => handlePreview(dataset)}>
                                  <Eye className="w-4 h-4 mr-2" />
                                  Preview
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    exportDatasetMutation.mutate({
                                      datasetId: dataset.id,
                                      format: "json",
                                    })
                                  }
                                >
                                  <FileJson className="w-4 h-4 mr-2" />
                                  Export JSON
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    exportDatasetMutation.mutate({
                                      datasetId: dataset.id,
                                      format: "csv",
                                    })
                                  }
                                >
                                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                                  Export CSV
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-red-500"
                                  onClick={() => deleteScrapedDatasetMutation.mutate(dataset.id)}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {dataset.schema.slice(0, 4).map((field) => (
                              <Badge
                                key={field.name}
                                variant="outline"
                                className="text-xs font-normal"
                              >
                                {field.name}
                              </Badge>
                            ))}
                            {dataset.schema.length > 4 && (
                              <Badge variant="outline" className="text-xs font-normal">
                                +{dataset.schema.length - 4} more
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-4 pt-3 border-t">
                            <span className="text-xs text-muted-foreground">
                              Created {new Date(dataset.createdAt).toLocaleDateString()}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handlePreview(dataset)}
                            >
                              View
                              <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Scrapers Tab */}
              <TabsContent value="scrapers" className="mt-0 space-y-4">
                {configsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : configs.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                      <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium">No scrapers configured</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Create your first scraper or start with a template
                      </p>
                      <Button onClick={() => setIsNewConfigOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Create Scraper
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {configs.map((config) => (
                      <Card key={config.id} className="hover:border-emerald-500/50 transition-colors">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                                <Globe className="w-5 h-5 text-blue-500" />
                              </div>
                              <div>
                                <h4 className="font-medium">{config.name}</h4>
                                <p className="text-sm text-muted-foreground truncate max-w-md">
                                  {config.sourceUrl}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="capitalize">
                                {config.mode}
                              </Badge>
                              <Badge variant="outline">
                                {(config.fields || []).length} fields
                              </Badge>
                              <Button
                                size="sm"
                                onClick={() => startJobMutation.mutate(config.id)}
                                disabled={startJobMutation.isPending}
                              >
                                <Play className="w-4 h-4 mr-1" />
                                Run
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem>
                                    <Settings2 className="w-4 h-4 mr-2" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem>
                                    <Copy className="w-4 h-4 mr-2" />
                                    Duplicate
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-red-500"
                                    onClick={() => deleteConfigMutation.mutate(config.id)}
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
              </TabsContent>

              {/* Jobs Tab */}
              <TabsContent value="jobs" className="mt-0 space-y-4">
                {jobsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : jobs.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                      <RefreshCw className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium">No jobs yet</h3>
                      <p className="text-sm text-muted-foreground">
                        Run a scraper to see jobs here
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {jobs.map((job) => (
                      <Card
                        key={job.id}
                        className={
                          job.status === "running"
                            ? "border-blue-500/50"
                            : "hover:border-muted-foreground/50"
                        }
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                                {job.status === "running" ? (
                                  <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                                ) : job.status === "completed" ? (
                                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                                ) : job.status === "failed" ? (
                                  <XCircle className="w-5 h-5 text-red-500" />
                                ) : (
                                  <Clock className="w-5 h-5 text-yellow-500" />
                                )}
                              </div>
                              <div>
                                <h4 className="font-medium">{job.configName}</h4>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(job.createdAt).toLocaleString()}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {getJobStatusBadge(job.status)}
                              {job.status === "running" && (
                                <div className="w-32">
                                  <Progress
                                    value={
                                      job.progress.total > 0
                                        ? (job.progress.completed / job.progress.total) * 100
                                        : 0
                                    }
                                    className="h-2"
                                  />
                                  <p className="text-xs text-muted-foreground mt-1 text-right">
                                    {job.progress.completed}/{job.progress.total}
                                  </p>
                                </div>
                              )}
                              {job.stats.itemsExtracted && (
                                <Badge variant="outline">
                                  {job.stats.itemsExtracted} items
                                </Badge>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Templates Tab */}
              <TabsContent value="templates" className="mt-0 space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {templates.map((template) => (
                    <Card
                      key={template.id}
                      className="group hover:border-emerald-500/50 transition-all cursor-pointer"
                      onClick={() => useTemplate(template)}
                    >
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center">
                            <Layers className="w-5 h-5 text-violet-500" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{template.name}</CardTitle>
                            <CardDescription className="text-xs">
                              {template.category}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-3">
                          {template.description}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(template.config.fields || []).slice(0, 3).map((field) => (
                            <Badge key={field.id} variant="outline" className="text-xs">
                              {field.name}
                            </Badge>
                          ))}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full mt-4 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Use Template
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </div>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{selectedDataset?.name}</DialogTitle>
            <DialogDescription>
              {selectedDataset?.stats.rowCount} rows • {selectedDataset?.schema.length} columns
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            {previewData && (
              <Table>
                <TableHeader>
                  <TableRow>
                    {previewData.columns.map((col) => (
                      <TableHead key={col}>{col}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.rows.map((row, i) => (
                    <TableRow key={i}>
                      {previewData.columns.map((col) => (
                        <TableCell key={col} className="max-w-xs truncate">
                          {String(row[col] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
