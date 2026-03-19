/**
 * Data Studio Page - Comprehensive UI for offline data management
 * 
 * Tabs:
 * - Datasets: Browse and manage datasets
 * - Import: Import data from various sources
 * - Generate: Synthetic data generation
 * - Scrape: Web scraping and API collection
 * - Export: Export to training formats
 * - Search: Full-text search across datasets
 * - Quality: Quality analysis and filtering
 * - Vault: Encrypted storage and identity
 * - Policies: Content policies and compliance
 */

import { useState } from "react";
import DOMPurify from "dompurify";
import { useExport } from "@/hooks/use-export";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Database,
  Upload,
  Search,
  Shield,
  Lock,
  FileCheck,
  Settings,
  BarChart3,
  FileText,
  Image,
  Music,
  Video,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download,
  Trash2,
  Plus,
  Eye,
  Filter,
  Sparkles,
  Globe,
  Wand2,
  Folder,
  Play,
  Pause,
  Rss,
  FileJson,
  Code,
} from "lucide-react";

import {
  useDatasetStatistics,
  useBackups,
  useBatchImport,
  useSearch,
  useSearchSuggestions,
  useSearchFacets,
  useSavedSearches,
  useSaveSearch,
  useQualityStatistics,
  useBatchQualityAnalysis,
  useExactDuplicates,
  usePolicies,
  useLicenses,
  usePrivacyRules,
  useViolations,
  useVaultIdentity,
  useVaultUnlock,
  useVaultLock,
  useVaultPeers,
  useIndexDataset,
  useSearchIndexStats,
  // Generation hooks
  useGenerationTemplates,
  useGenerateSingle,
  useStartGenerationBatch,
  useGenerationJobs,
  useCancelGenerationJob,
  useCreateHybridDataset,
  // Scraping hooks
  useScrapeUrl,
  useCreateScrapingJob,
  useStartScrapingJob,
  useScrapingJobs,
  useCancelScrapingJob,
  useParseFeed,
  useScrapeFeedToDataset,
  // Transform hooks
  useTransformTemplates,
  useTransformExportDataset,
  usePrepareTraining,
  useDatasetTransformStats,
} from "@/hooks/useDataStudioExtended";
import { useStudioDatasets, type StudioDataset } from "@/hooks/useDatasetStudio";
import type { SearchQuery } from "@/ipc/data_studio_extended_client";

type Dataset = StudioDataset;

// ============================================================================
// Sub-Components
// ============================================================================

function DatasetList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data: datasets, isLoading } = useStudioDatasets();
  
  if (isLoading) {
    return <div className="flex items-center justify-center p-8">Loading datasets...</div>;
  }
  
  if (!datasets || datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
        <Database className="h-12 w-12 mb-4" />
        <p>No datasets yet</p>
        <p className="text-sm">Create a dataset to get started</p>
      </div>
    );
  }
  
  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2">
        {datasets.map((dataset: Dataset) => (
          <Card
            key={dataset.id}
            className="cursor-pointer hover:bg-accent"
            onClick={() => onSelect(dataset.id)}
          >
            <CardHeader className="p-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{dataset.name}</CardTitle>
                <Badge variant="outline">{dataset.datasetType}</Badge>
              </div>
              <CardDescription className="text-xs">
                {dataset.itemCount.toLocaleString()} items • {(dataset.totalBytes / 1024 / 1024).toFixed(1)} MB
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

function ImportPanel({ datasetId }: { datasetId: string | null }) {
  const [importPath, setImportPath] = useState("");
  const batchImport = useBatchImport();
  
  const handleImport = () => {
    if (!datasetId || !importPath) return;
    
    batchImport.mutate({
      datasetId,
      directoryPath: importPath,
      recursive: true,
    });
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Import Data
        </CardTitle>
        <CardDescription>
          Import files from a directory into your dataset
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!datasetId ? (
          <p className="text-muted-foreground">Select a dataset first</p>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Directory Path</label>
              <Input
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                placeholder="C:\path\to\data"
              />
            </div>
            
            <div className="flex gap-2">
              <Button onClick={handleImport} disabled={batchImport.isPending}>
                {batchImport.isPending ? "Importing..." : "Start Import"}
              </Button>
            </div>
            
            {batchImport.isSuccess && (
              <div className="p-3 bg-green-50 dark:bg-green-950 rounded-md">
                <p className="text-sm text-green-700 dark:text-green-300">
                  Successfully imported {batchImport.data.imported} items
                  {batchImport.data.failed > 0 && ` (${batchImport.data.failed} failed)`}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SearchPanel() {
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState<SearchQuery | null>(null);
  
  const { data: searchResults, isLoading } = useSearch(searchQuery);
  const { data: suggestions } = useSearchSuggestions(searchText);
  const { data: facets } = useSearchFacets(searchText);
  const { data: indexStats } = useSearchIndexStats();
  const savedSearches = useSavedSearches();
  const saveSearch = useSaveSearch();
  
  const handleSearch = () => {
    if (!searchText.trim()) return;
    setSearchQuery({ query: searchText });
  };
  
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Full-Text Search
          </CardTitle>
          <CardDescription>
            Search across all indexed datasets
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search datasets..."
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isLoading}>
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
          
          {suggestions?.suggestions && suggestions.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.suggestions.slice(0, 5).map((s, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setSearchText(s.text)}
                >
                  {s.text}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Facets */}
      {facets?.facets && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs font-medium mb-1">Modality</p>
              <div className="flex flex-wrap gap-1">
                {facets.facets.modality.map((f, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {f.value} ({f.count})
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium mb-1">Split</p>
              <div className="flex flex-wrap gap-1">
                {facets.facets.split.map((f, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {f.value} ({f.count})
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Results */}
      {searchResults?.results && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {searchResults.total} results ({searchResults.executionTimeMs}ms)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {searchResults.results.map((result, i) => (
                  <div key={i} className="p-3 border rounded-md">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline">{result.datasetName}</Badge>
                      <span className="text-xs text-muted-foreground">
                        Score: {result.rank.toFixed(2)}
                      </span>
                    </div>
                    <p
                      className="text-sm"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.snippet) }}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
      
      {/* Index Stats */}
      {indexStats?.stats && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Index Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{indexStats.stats.totalItems.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Indexed Items</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{indexStats.stats.uniqueTerms.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Unique Terms</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{indexStats.stats.byDataset.length}</p>
                <p className="text-xs text-muted-foreground">Datasets</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QualityPanel({ datasetId }: { datasetId: string | null }) {
  const { data: qualityStats, isLoading: statsLoading } = useQualityStatistics(datasetId || "");
  const { data: duplicates, isLoading: dupsLoading } = useExactDuplicates(datasetId || "");
  const batchAnalysis = useBatchQualityAnalysis();
  
  const handleBatchAnalysis = () => {
    if (!datasetId) return;
    batchAnalysis.mutate({ datasetId, types: ["all"] });
  };
  
  if (!datasetId) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Select a dataset to view quality analysis
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Quality Analysis
          </CardTitle>
          <CardDescription>
            Analyze and filter data quality
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleBatchAnalysis} disabled={batchAnalysis.isPending}>
            {batchAnalysis.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <BarChart3 className="h-4 w-4 mr-2" />
                Run Batch Analysis
              </>
            )}
          </Button>
          
          {qualityStats?.statistics && (
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 border rounded-md">
                <p className="text-sm font-medium">Total Items</p>
                <p className="text-2xl font-bold">{qualityStats.statistics.total}</p>
              </div>
              <div className="p-3 border rounded-md">
                <p className="text-sm font-medium">Analyzed</p>
                <p className="text-2xl font-bold text-green-600">
                  {qualityStats.statistics.analyzed}
                </p>
              </div>
              <div className="p-3 border rounded-md">
                <p className="text-sm font-medium">Avg Blur Score</p>
                <p className="text-2xl font-bold">
                  {(qualityStats.statistics.quality.avgBlurScore * 100).toFixed(1)}%
                </p>
              </div>
              <div className="p-3 border rounded-md">
                <p className="text-sm font-medium">Avg Readability</p>
                <p className="text-2xl font-bold">
                  {(qualityStats.statistics.quality.avgReadability * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Duplicate Detection</CardTitle>
        </CardHeader>
        <CardContent>
          {duplicates && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>Total Items</span>
                <span className="font-medium">{duplicates.totalItems}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Unique Items</span>
                <span className="font-medium">{duplicates.uniqueItems}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Duplicate Groups</span>
                <Badge variant={duplicates.duplicateGroups > 0 ? "destructive" : "default"}>
                  {duplicates.duplicateGroups}
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VaultPanel() {
  const [passphrase, setPassphrase] = useState("");
  const { data: identity, isError: identityError } = useVaultIdentity();
  const { data: peers } = useVaultPeers();
  const unlock = useVaultUnlock();
  const lock = useVaultLock();
  
  const isLocked = identityError;
  
  const handleUnlock = () => {
    if (!passphrase) return;
    unlock.mutate(passphrase);
    setPassphrase("");
  };
  
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Data Vault
          </CardTitle>
          <CardDescription>
            Encrypted storage for sensitive data and cryptographic identity
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLocked ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-yellow-600">
                <Lock className="h-4 w-4" />
                <span>Vault is locked</span>
              </div>
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              />
              <Button onClick={handleUnlock} disabled={unlock.isPending}>
                Unlock Vault
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>Vault is unlocked</span>
              </div>
              
              {identity?.identity && (
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-xs font-medium mb-1">Public Key</p>
                  <code className="text-xs break-all">
                    {identity.identity.publicKey.substring(0, 64)}...
                  </code>
                </div>
              )}
              
              <Button variant="outline" onClick={() => lock.mutate()}>
                Lock Vault
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      
      {!isLocked && peers?.peers && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trusted Peers</CardTitle>
          </CardHeader>
          <CardContent>
            {peers.peers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No peers added yet</p>
            ) : (
              <div className="space-y-2">
                {peers.peers.map((peer, i) => (
                  <div key={i} className="flex items-center justify-between p-2 border rounded">
                    <div>
                      <p className="font-medium">{peer.name}</p>
                      <p className="text-xs text-muted-foreground">{peer.peerId}</p>
                    </div>
                    {peer.trusted && <Badge variant="secondary">Trusted</Badge>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Generate Panel - Synthetic Data Generation
// ============================================================================

function GeneratePanel({ datasetId }: { datasetId: string | null }) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [generateCount, setGenerateCount] = useState("10");
  const [customPrompt, setCustomPrompt] = useState("");
  
  const { data: templates } = useGenerationTemplates();
  const { data: jobs } = useGenerationJobs({ datasetId: datasetId || undefined });
  const generateSingle = useGenerateSingle();
  const startBatch = useStartGenerationBatch();
  const cancelJob = useCancelGenerationJob();
  const createHybrid = useCreateHybridDataset();
  
  const handleGenerateSingle = () => {
    if (!selectedTemplate) return;
    generateSingle.mutate({
      templateId: selectedTemplate,
    });
  };
  
  const handleStartBatch = () => {
    if (!datasetId || !selectedTemplate) return;
    startBatch.mutate({
      datasetId,
      templateId: selectedTemplate,
      count: parseInt(generateCount) || 10,
    });
  };
  
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Synthetic Data Generation
            </CardTitle>
            <CardDescription>
              Generate synthetic training data using AI templates
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!datasetId ? (
              <p className="text-muted-foreground">Select a dataset first</p>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template</label>
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a generation template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates?.templates?.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} - {t.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Number to Generate</label>
                  <Input
                    type="number"
                    value={generateCount}
                    onChange={(e) => setGenerateCount(e.target.value)}
                    min="1"
                    max="10000"
                  />
                </div>
                
                <div className="flex gap-2">
                  <Button
                    onClick={handleGenerateSingle}
                    disabled={!selectedTemplate || generateSingle.isPending}
                    variant="outline"
                  >
                    <Wand2 className="h-4 w-4 mr-2" />
                    Preview One
                  </Button>
                  <Button
                    onClick={handleStartBatch}
                    disabled={!selectedTemplate || startBatch.isPending}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Generate Batch
                  </Button>
                </div>
                
                {generateSingle.data && (
                  <Card className="bg-muted">
                    <CardHeader className="py-2">
                      <CardTitle className="text-sm">Preview Result</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs overflow-auto max-h-40">
                        {JSON.stringify(generateSingle.data.data, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hybrid Dataset Creation</CardTitle>
            <CardDescription>
              Mix multiple datasets with different ratios
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" disabled={!datasetId}>
              <Plus className="h-4 w-4 mr-2" />
              Create Hybrid Dataset
            </Button>
          </CardContent>
        </Card>
      </div>
      
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generation Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {jobs?.jobs && jobs.jobs.length > 0 ? (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {jobs.jobs.map((job) => (
                    <div key={job.id} className="p-2 border rounded">
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant={
                          job.status === "running" ? "default" :
                          job.status === "completed" ? "outline" : "secondary"
                        }>
                          {job.status}
                        </Badge>
                        {job.status === "running" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => cancelJob.mutate(job.id)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <Progress
                        value={(job.progress.completed / job.progress.total) * 100}
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {job.progress.completed} / {job.progress.total}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">No jobs</p>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Templates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {templates?.templates?.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.type}</p>
                  </div>
                  {t.isBuiltin && <Badge variant="secondary">Built-in</Badge>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Scrape Panel - Web Scraping
// ============================================================================

function ScrapePanel({ datasetId }: { datasetId: string | null }) {
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [scrapeType, setScrapeType] = useState<"web" | "feed" | "api">("web");
  
  const scrapeUrlMutation = useScrapeUrl();
  const { data: scrapingJobs } = useScrapingJobs({ datasetId: datasetId || undefined });
  const createJob = useCreateScrapingJob();
  const startJob = useStartScrapingJob();
  const cancelJob = useCancelScrapingJob();
  const scrapeFeed = useScrapeFeedToDataset();
  
  const handleScrapePreview = () => {
    if (!scrapeUrl) return;
    scrapeUrlMutation.mutate({ url: scrapeUrl });
  };
  
  const handleScrapeFeed = () => {
    if (!datasetId || !feedUrl) return;
    scrapeFeed.mutate({
      datasetId,
      feedUrl,
      scrapeFullContent: true,
    });
  };
  
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Web Scraping
            </CardTitle>
            <CardDescription>
              Scrape data from websites, APIs, and RSS feeds
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={scrapeType === "web" ? "default" : "outline"}
                onClick={() => setScrapeType("web")}
                size="sm"
              >
                <Globe className="h-4 w-4 mr-1" />
                Web Page
              </Button>
              <Button
                variant={scrapeType === "feed" ? "default" : "outline"}
                onClick={() => setScrapeType("feed")}
                size="sm"
              >
                <Rss className="h-4 w-4 mr-1" />
                RSS Feed
              </Button>
              <Button
                variant={scrapeType === "api" ? "default" : "outline"}
                onClick={() => setScrapeType("api")}
                size="sm"
              >
                <Code className="h-4 w-4 mr-1" />
                API
              </Button>
            </div>
            
            {!datasetId ? (
              <p className="text-muted-foreground">Select a dataset first</p>
            ) : scrapeType === "web" ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">URL to Scrape</label>
                  <Input
                    value={scrapeUrl}
                    onChange={(e) => setScrapeUrl(e.target.value)}
                    placeholder="https://example.com/page"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleScrapePreview}
                    disabled={!scrapeUrl || scrapeUrlMutation.isPending}
                    variant="outline"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Preview
                  </Button>
                  <Button disabled={!scrapeUrl}>
                    <Download className="h-4 w-4 mr-2" />
                    Scrape to Dataset
                  </Button>
                </div>
                
                {scrapeUrlMutation.data && (
                  <Card className="bg-muted">
                    <CardHeader className="py-2">
                      <CardTitle className="text-sm">
                        {scrapeUrlMutation.data.data.title || "Scraped Content"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-2">
                        {scrapeUrlMutation.data.data.content.length} characters
                      </p>
                      <pre className="text-xs overflow-auto max-h-40">
                        {scrapeUrlMutation.data.data.content.substring(0, 500)}...
                      </pre>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : scrapeType === "feed" ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">RSS/Atom Feed URL</label>
                  <Input
                    value={feedUrl}
                    onChange={(e) => setFeedUrl(e.target.value)}
                    placeholder="https://example.com/feed.xml"
                  />
                </div>
                <Button
                  onClick={handleScrapeFeed}
                  disabled={!feedUrl || scrapeFeed.isPending}
                >
                  <Rss className="h-4 w-4 mr-2" />
                  Import Feed Items
                </Button>
                
                {scrapeFeed.data && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm">
                      Imported {scrapeFeed.data.added} items ({scrapeFeed.data.failed} failed)
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">API Endpoint</label>
                  <Input placeholder="https://api.example.com/data" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Headers (JSON)</label>
                  <Textarea placeholder='{"Authorization": "Bearer xxx"}' rows={3} />
                </div>
                <Button>
                  <Code className="h-4 w-4 mr-2" />
                  Scrape API
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batch Scraping</CardTitle>
            <CardDescription>
              Create a job to scrape multiple URLs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <label className="text-sm font-medium">URLs (one per line)</label>
              <Textarea placeholder="https://example.com/page1&#10;https://example.com/page2" rows={4} />
            </div>
            <Button className="mt-4" disabled={!datasetId}>
              <Plus className="h-4 w-4 mr-2" />
              Create Scraping Job
            </Button>
          </CardContent>
        </Card>
      </div>
      
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scraping Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {scrapingJobs?.jobs && scrapingJobs.jobs.length > 0 ? (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {scrapingJobs.jobs.map((job) => (
                    <div key={job.id} className="p-2 border rounded">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">{job.name}</span>
                        <Badge variant={
                          job.status === "running" ? "default" :
                          job.status === "completed" ? "outline" : "secondary"
                        }>
                          {job.status}
                        </Badge>
                      </div>
                      <Progress
                        value={(job.progress.completed / job.progress.total) * 100}
                        className="h-2"
                      />
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs text-muted-foreground">
                          {job.progress.completed} / {job.progress.total}
                        </p>
                        {job.status === "running" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => cancelJob.mutate(job.id)}
                          >
                            <Pause className="h-3 w-3" />
                          </Button>
                        )}
                        {job.status === "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startJob.mutate(job.id)}
                          >
                            <Play className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">No scraping jobs</p>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start">
              <Globe className="h-4 w-4 mr-2" />
              Parse Sitemap
            </Button>
            <Button variant="outline" className="w-full justify-start">
              <FileJson className="h-4 w-4 mr-2" />
              Import from API
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Export Panel - Training Format Export
// ============================================================================

function ExportPanel({ datasetId }: { datasetId: string | null }) {
  const [exportFormat, setExportFormat] = useState("huggingface");
  const [outputDir, setOutputDir] = useState("");
  const [framework, setFramework] = useState("huggingface");
  
  const { data: templates } = useTransformTemplates();
  const { data: stats } = useDatasetTransformStats(datasetId || "");
  const exportDataset = useTransformExportDataset();
  const prepareTraining = usePrepareTraining();
  const { exportToDocument, hasLibreOffice, isExporting } = useExport();
  
  const handleExport = () => {
    if (!datasetId || !outputDir) return;
    exportDataset.mutate({
      datasetId,
      config: {
        format: exportFormat as any,
        outputDir,
        splitRatios: { train: 0.8, val: 0.1, test: 0.1 },
        shuffleSeed: 42,
      },
    });
  };
  
  const handlePrepareTraining = () => {
    if (!datasetId || !outputDir) return;
    prepareTraining.mutate({
      datasetId,
      outputDir,
      framework: framework as any,
    });
  };
  
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Dataset
            </CardTitle>
            <CardDescription>
              Export to various training-ready formats
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!datasetId ? (
              <p className="text-muted-foreground">Select a dataset first</p>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Export Format</label>
                  <Select value={exportFormat} onValueChange={setExportFormat}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="jsonl">JSONL (Generic)</SelectItem>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="huggingface">HuggingFace Datasets</SelectItem>
                      <SelectItem value="alpaca">Alpaca Format</SelectItem>
                      <SelectItem value="sharegpt">ShareGPT Format</SelectItem>
                      <SelectItem value="openai">OpenAI Fine-tune Format</SelectItem>
                      <SelectItem value="llama">LLaMA Format</SelectItem>
                      <SelectItem value="text-plain">Plain Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Output Directory</label>
                  <Input
                    value={outputDir}
                    onChange={(e) => setOutputDir(e.target.value)}
                    placeholder="C:/Users/data/exports/my-dataset"
                  />
                </div>
                
                <div className="grid grid-cols-3 gap-4 p-3 bg-muted rounded-md">
                  <div className="text-center">
                    <p className="text-xl font-bold">80%</p>
                    <p className="text-xs text-muted-foreground">Train</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold">10%</p>
                    <p className="text-xs text-muted-foreground">Validation</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold">10%</p>
                    <p className="text-xs text-muted-foreground">Test</p>
                  </div>
                </div>
                
                <Button
                  onClick={handleExport}
                  disabled={!outputDir || exportDataset.isPending}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export Dataset
                </Button>
                
                {exportDataset.data && exportDataset.data.result && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm">
                      Exported {exportDataset.data.result.totalItems} items to {exportDataset.data.result.files?.length || 0} files
                    </span>
                  </div>
                )}

                {hasLibreOffice && (
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!datasetId || isExporting}
                      onClick={() => {
                        if (!datasetId) return;
                        const s = stats?.stats;
                        const sections = [
                          { type: "heading" as const, level: 1, content: "Dataset Report" },
                          { type: "paragraph" as const, content: `Dataset ID: ${datasetId}` },
                          { type: "heading" as const, level: 2, content: "Statistics" },
                          { type: "paragraph" as const, content: `Total Items: ${s?.itemCount?.toLocaleString() ?? "N/A"}` },
                          { type: "paragraph" as const, content: `Total Tokens: ${s?.totalTokens?.toLocaleString() ?? "N/A"}` },
                          { type: "paragraph" as const, content: `Avg Tokens/Item: ${s ? Math.round(s.avgTokensPerItem) : "N/A"}` },
                          { type: "paragraph" as const, content: `Min Tokens: ${s?.minTokens ?? "N/A"} | Max Tokens: ${s?.maxTokens ?? "N/A"}` },
                          { type: "heading" as const, level: 2, content: "Export Configuration" },
                          { type: "paragraph" as const, content: `Format: ${exportFormat}` },
                          { type: "paragraph" as const, content: `Split Ratios: Train 80% / Val 10% / Test 10%` },
                          { type: "paragraph" as const, content: `Generated: ${new Date().toLocaleString()}` },
                        ];
                        exportToDocument.mutate({
                          name: `dataset-report-${datasetId}`,
                          sections,
                          format: "pdf",
                          title: "Dataset Report",
                        });
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Export Report (PDF)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!datasetId || isExporting}
                      onClick={() => {
                        if (!datasetId) return;
                        const s = stats?.stats;
                        const sections = [
                          { type: "heading" as const, level: 1, content: "Dataset Report" },
                          { type: "paragraph" as const, content: `Dataset ID: ${datasetId}` },
                          { type: "heading" as const, level: 2, content: "Statistics" },
                          { type: "paragraph" as const, content: `Total Items: ${s?.itemCount?.toLocaleString() ?? "N/A"}` },
                          { type: "paragraph" as const, content: `Total Tokens: ${s?.totalTokens?.toLocaleString() ?? "N/A"}` },
                          { type: "paragraph" as const, content: `Avg Tokens/Item: ${s ? Math.round(s.avgTokensPerItem) : "N/A"}` },
                          { type: "paragraph" as const, content: `Min Tokens: ${s?.minTokens ?? "N/A"} | Max Tokens: ${s?.maxTokens ?? "N/A"}` },
                          { type: "heading" as const, level: 2, content: "Export Configuration" },
                          { type: "paragraph" as const, content: `Format: ${exportFormat}` },
                          { type: "paragraph" as const, content: `Split Ratios: Train 80% / Val 10% / Test 10%` },
                          { type: "paragraph" as const, content: `Generated: ${new Date().toLocaleString()}` },
                        ];
                        exportToDocument.mutate({
                          name: `dataset-report-${datasetId}`,
                          sections,
                          format: "docx",
                          title: "Dataset Report",
                        });
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Export Report (DOCX)
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Folder className="h-5 w-5" />
              Prepare for Training
            </CardTitle>
            <CardDescription>
              Create complete folder structure for ML frameworks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Framework</label>
              <Select value={framework} onValueChange={setFramework}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="huggingface">HuggingFace Transformers</SelectItem>
                  <SelectItem value="pytorch">PyTorch</SelectItem>
                  <SelectItem value="tensorflow">TensorFlow</SelectItem>
                  <SelectItem value="llama">LLaMA / llama.cpp</SelectItem>
                  <SelectItem value="lora">LoRA Fine-tuning</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button
              onClick={handlePrepareTraining}
              disabled={!datasetId || !outputDir || prepareTraining.isPending}
              variant="outline"
            >
              <Folder className="h-4 w-4 mr-2" />
              Create Training Structure
            </Button>
          </CardContent>
        </Card>
      </div>
      
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dataset Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.stats ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Items</span>
                  <span className="font-medium">{stats.stats.itemCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total Tokens</span>
                  <span className="font-medium">{stats.stats.totalTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Avg Tokens/Item</span>
                  <span className="font-medium">{Math.round(stats.stats.avgTokensPerItem)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Min Tokens</span>
                  <span className="font-medium">{stats.stats.minTokens}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Max Tokens</span>
                  <span className="font-medium">{stats.stats.maxTokens}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a dataset to view stats</p>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Folder Templates</CardTitle>
          </CardHeader>
          <CardContent>
            {templates?.templates ? (
              <div className="space-y-2">
                {templates.templates.map((t) => (
                  <div key={t.id} className="p-2 border rounded">
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading templates...</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PolicyPanel() {
  const { data: policies } = usePolicies();
  const { data: licenses } = useLicenses();
  const { data: privacyRules } = usePrivacyRules();
  const { data: violations } = useViolations({ resolved: false });
  
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Content Policies
          </CardTitle>
          <CardDescription>
            Manage content policies and compliance rules
          </CardDescription>
        </CardHeader>
        <CardContent>
          {policies?.policies && policies.policies.length > 0 ? (
            <div className="space-y-2">
              {policies.policies.map((policy, i) => (
                <div key={i} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <p className="font-medium">{policy.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {policy.rules.length} rules
                    </p>
                  </div>
                  <Badge variant={policy.enabled ? "default" : "secondary"}>
                    {policy.enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No policies defined</p>
          )}
          <Button variant="outline" className="mt-4">
            <Plus className="h-4 w-4 mr-2" />
            Create Policy
          </Button>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Violations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {violations?.violations && violations.violations.length > 0 ? (
            <div className="space-y-2">
              {violations.violations.slice(0, 5).map((violation, i) => (
                <div key={i} className="p-2 border rounded bg-red-50 dark:bg-red-950">
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">
                    {violation.policyName}
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {violation.description}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm">No violations detected</span>
            </div>
          )}
        </CardContent>
      </Card>
      
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Licenses</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{licenses?.licenses?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Available licenses</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Privacy Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{privacyRules?.rules?.length || 0}</p>
            <p className="text-xs text-muted-foreground">PII detection rules</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function DataStudioPage() {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("datasets");
  
  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Data Studio</h1>
          <p className="text-muted-foreground">
            Comprehensive offline data management for AI training and personal data
          </p>
        </div>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="datasets" className="gap-2">
            <Database className="h-4 w-4" />
            Datasets
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-2">
            <Upload className="h-4 w-4" />
            Import
          </TabsTrigger>
          <TabsTrigger value="generate" className="gap-2">
            <Sparkles className="h-4 w-4" />
            Generate
          </TabsTrigger>
          <TabsTrigger value="scrape" className="gap-2">
            <Globe className="h-4 w-4" />
            Scrape
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-2">
            <Search className="h-4 w-4" />
            Search
          </TabsTrigger>
          <TabsTrigger value="quality" className="gap-2">
            <FileCheck className="h-4 w-4" />
            Quality
          </TabsTrigger>
          <TabsTrigger value="vault" className="gap-2">
            <Lock className="h-4 w-4" />
            Vault
          </TabsTrigger>
          <TabsTrigger value="policies" className="gap-2">
            <Shield className="h-4 w-4" />
            Policies
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="datasets">
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Your Datasets</CardTitle>
                </CardHeader>
                <CardContent>
                  <DatasetList onSelect={setSelectedDatasetId} />
                </CardContent>
              </Card>
            </div>
            
            <div className="col-span-2">
              {selectedDatasetId ? (
                <DatasetDetailPanel datasetId={selectedDatasetId} />
              ) : (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    Select a dataset to view details
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="import">
          <div className="grid grid-cols-2 gap-6">
            <ImportPanel datasetId={selectedDatasetId} />
            <Card>
              <CardHeader>
                <CardTitle>Export Data</CardTitle>
                <CardDescription>Export datasets to various formats</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline">
                      <FileText className="h-4 w-4 mr-2" />
                      JSONL
                    </Button>
                    <Button variant="outline">
                      <FileText className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
                    <Button variant="outline">
                      <Database className="h-4 w-4 mr-2" />
                      SQLite
                    </Button>
                    <Button variant="outline">
                      <FileText className="h-4 w-4 mr-2" />
                      Parquet
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="generate">
          <GeneratePanel datasetId={selectedDatasetId} />
        </TabsContent>
        
        <TabsContent value="scrape">
          <ScrapePanel datasetId={selectedDatasetId} />
        </TabsContent>
        
        <TabsContent value="export">
          <ExportPanel datasetId={selectedDatasetId} />
        </TabsContent>
        
        <TabsContent value="search">
          <SearchPanel />
        </TabsContent>
        
        <TabsContent value="quality">
          <QualityPanel datasetId={selectedDatasetId} />
        </TabsContent>
        
        <TabsContent value="vault">
          <VaultPanel />
        </TabsContent>
        
        <TabsContent value="policies">
          <PolicyPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DatasetDetailPanel({ datasetId }: { datasetId: string }) {
  const { data: stats, isLoading } = useDatasetStatistics(datasetId);
  const indexDataset = useIndexDataset();
  
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">Loading...</CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dataset Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {stats && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 border rounded-md text-center">
                <p className="text-3xl font-bold">{stats.totalItems.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Total Items</p>
              </div>
              <div className="p-4 border rounded-md text-center">
                <p className="text-3xl font-bold">{(stats.totalBytes / 1024 / 1024).toFixed(1)}</p>
                <p className="text-sm text-muted-foreground">MB Total</p>
              </div>
              <div className="p-4 border rounded-md text-center">
                <p className="text-3xl font-bold">{Object.keys(stats.byModality).length}</p>
                <p className="text-sm text-muted-foreground">Modalities</p>
              </div>
            </div>
            
            <Separator />
            
            <div>
              <h4 className="font-medium mb-3">By Modality</h4>
              <div className="space-y-2">
                {Object.entries(stats.byModality).map(([modality, data]) => (
                  <div key={modality} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {modality === "text" && <FileText className="h-4 w-4" />}
                      {modality === "image" && <Image className="h-4 w-4" />}
                      {modality === "audio" && <Music className="h-4 w-4" />}
                      {modality === "video" && <Video className="h-4 w-4" />}
                      <span className="capitalize">{modality}</span>
                    </div>
                    <Badge variant="secondary">{data.count} items</Badge>
                  </div>
                ))}
              </div>
            </div>
            
            <Separator />
            
            <div>
              <h4 className="font-medium mb-3">By Split</h4>
              <div className="space-y-2">
                {Object.entries(stats.bySplit).map(([split, count]) => (
                  <div key={split} className="flex items-center justify-between">
                    <span className="capitalize">{split}</span>
                    <Badge variant="outline">{count}</Badge>
                  </div>
                ))}
              </div>
            </div>
            
            <Separator />
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => indexDataset.mutate(datasetId)}
                disabled={indexDataset.isPending}
              >
                <Search className="h-4 w-4 mr-2" />
                Index for Search
              </Button>
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default DataStudioPage;
