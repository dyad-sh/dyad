/**
 * Datasets & Web Scraper Page
 * Local-first data collection and dataset management
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { scraperClient } from "@/ipc/scraper_client";
import type {
  ScrapingConfig,
  ScrapingJob,
  Dataset,
  DatasetPreview,
  ScrapingField,
  ScrapingTemplate,
} from "@/types/scraper_types";
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
} from "lucide-react";

export default function DatasetPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("datasets");
  const [isNewConfigOpen, setIsNewConfigOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreview | null>(null);

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

  // Fetch datasets
  const { data: datasets = [], isLoading: datasetsLoading } = useQuery({
    queryKey: ["datasets"],
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

  // Delete dataset mutation
  const deleteDatasetMutation = useMutation({
    mutationFn: (datasetId: string) => scraperClient.deleteDataset(datasetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Dataset deleted");
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
            <TabsTrigger value="datasets" className="data-[state=active]:bg-background">
              <Database className="w-4 h-4 mr-2" />
              Datasets ({datasets.length})
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
              {/* Datasets Tab */}
              <TabsContent value="datasets" className="mt-0 space-y-4">
                {datasetsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : datasets.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                      <Database className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium">No datasets yet</h3>
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
                    {datasets.map((dataset) => (
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
                                  onClick={() => deleteDatasetMutation.mutate(dataset.id)}
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
