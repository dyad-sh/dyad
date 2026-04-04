import { useState, lazy, Suspense } from "react";
import { Database, Globe, Sparkles, FileCheck, Download, ListTodo, Settings, Brain, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useScrapingJobs } from "@/hooks/use_scraping";

const DatasetsTab = lazy(() => import("./DatasetsTab"));
const CollectTab = lazy(() => import("./CollectTab"));
const GenerateTab = lazy(() => import("./GenerateTab"));
const RefineTab = lazy(() => import("./RefineTab"));
const ExportTab = lazy(() => import("./ExportTab"));
const KnowledgeTab = lazy(() => import("./KnowledgeTab"));
const JobsTab = lazy(() => import("./JobsTab"));
const SettingsTab = lazy(() => import("./SettingsTab"));

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function DatasetStudioPage() {
  const [activeTab, setActiveTab] = useState("datasets");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const { data: jobs = [] } = useScrapingJobs();
  const runningCount = jobs.filter((j: any) => j.status === "running").length;

  return (
    <div className="flex flex-col h-full w-full" data-joy-assist="dataset-studio-page">
      {/* Header */}
      <div className="shrink-0 border-b bg-gradient-to-r from-emerald-500/5 via-teal-500/5 to-cyan-500/5 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/20">
              <Database className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Dataset Studio</h1>
              <p className="text-sm text-muted-foreground">
                Collect, generate, refine, and export training-ready datasets
              </p>
            </div>
          </div>
          {runningCount > 0 && (
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              {runningCount} running
            </Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="shrink-0 border-b px-6">
          <TabsList className="h-11 bg-transparent p-0 gap-1">
            <TabsTrigger value="datasets" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Database className="h-3.5 w-3.5" />
              Datasets
            </TabsTrigger>
            <TabsTrigger value="collect" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Globe className="h-3.5 w-3.5" />
              Collect
            </TabsTrigger>
            <TabsTrigger value="generate" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Sparkles className="h-3.5 w-3.5" />
              Generate
            </TabsTrigger>
            <TabsTrigger value="refine" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <FileCheck className="h-3.5 w-3.5" />
              Refine
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Download className="h-3.5 w-3.5" />
              Export
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Brain className="h-3.5 w-3.5" />
              Knowledge
            </TabsTrigger>
            <TabsTrigger value="jobs" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <ListTodo className="h-3.5 w-3.5" />
              Jobs
              {runningCount > 0 && (
                <Badge variant="default" className="ml-1 h-4 px-1 text-[10px]">{runningCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Settings className="h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6">
            <Suspense fallback={<TabFallback />}>
              <TabsContent value="datasets" className="mt-0">
                <DatasetsTab selectedDatasetId={selectedDatasetId} onSelectDataset={setSelectedDatasetId} />
              </TabsContent>
              <TabsContent value="collect" className="mt-0">
                <CollectTab datasetId={selectedDatasetId} />
              </TabsContent>
              <TabsContent value="generate" className="mt-0">
                <GenerateTab datasetId={selectedDatasetId} />
              </TabsContent>
              <TabsContent value="refine" className="mt-0">
                <RefineTab datasetId={selectedDatasetId} />
              </TabsContent>
              <TabsContent value="export" className="mt-0">
                <ExportTab datasetId={selectedDatasetId} />
              </TabsContent>
              <TabsContent value="knowledge" className="mt-0">
                <KnowledgeTab />
              </TabsContent>
              <TabsContent value="jobs" className="mt-0">
                <JobsTab />
              </TabsContent>
              <TabsContent value="settings" className="mt-0">
                <SettingsTab />
              </TabsContent>
            </Suspense>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
