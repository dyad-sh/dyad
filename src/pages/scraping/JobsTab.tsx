import { useState, useCallback } from "react";
import {
  ListTodo,
  Clock,
  Play,
  Pause,
  Trash2,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useScrapingJobs,
  useScrapingJob,
  useRunScrapingJob,
  usePauseScrapingJob,
  useCancelScrapingJob,
  useDeleteScrapingJob,
  useScrapingResults,
  useExportResults,
  useScrapingJobProgress,
} from "@/hooks/use_scraping";
import { STATUS_VISUALS, fadeUpVariant, staggerItem } from "./constants";
import { StatCard } from "./StatCard";

export function JobsTab() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const { data: jobs = [], isLoading } = useScrapingJobs(statusFilter);
  const { data: selectedJob } = useScrapingJob(selectedJobId);
  const { data: results } = useScrapingResults(selectedJobId);
  const runJob = useRunScrapingJob();
  const pauseJob = usePauseScrapingJob();
  const cancelJob = useCancelScrapingJob();
  const deleteJob = useDeleteScrapingJob();
  const exportResults = useExportResults();

  const handleJobProgress = useCallback((_job: any) => {}, []);
  useScrapingJobProgress(handleJobProgress);

  const getStatus = (status: string) => STATUS_VISUALS[status] ?? STATUS_VISUALS.queued;

  return (
    <motion.div {...fadeUpVariant} className="space-y-6">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <Select
          value={statusFilter ?? "all"}
          onValueChange={(v) => setStatusFilter(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline">{jobs.length} jobs</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Job list */}
        <div className="lg:col-span-1 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ListTodo className="h-12 w-12 mb-3 opacity-30" />
              <p className="font-medium">No jobs yet</p>
              <p className="text-sm">Start a Quick Scrape or Crawler job</p>
            </div>
          ) : (
            <AnimatePresence>
              {jobs.map((job: any) => {
                const sv = getStatus(job.status);
                return (
                  <motion.div key={job.id} {...staggerItem} layout>
                    <Card
                      className={`cursor-pointer transition-all duration-200 border-border/50 hover:shadow-md hover:border-violet-500/30 ${
                        selectedJobId === job.id ? "border-primary shadow-md" : ""
                      }`}
                      onClick={() => setSelectedJobId(job.id)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={sv.color}>{sv.icon}</span>
                            <span className="text-sm font-medium truncate">{job.name}</span>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {job.pagesDone}/{job.pagesTotal}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {job.recordsExtracted} records &middot; {job.engine}
                          {job.errorCount > 0 && (
                            <span className="text-red-500"> &middot; {job.errorCount} errors</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Job detail */}
        <div className="lg:col-span-2">
          {selectedJob ? (
            <motion.div {...fadeUpVariant}>
              <Card className="border-border/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{selectedJob.name}</CardTitle>
                      <CardDescription className="font-mono text-xs">{selectedJob.id}</CardDescription>
                    </div>
                    <div className="flex gap-1">
                      {selectedJob.status === "queued" && (
                        <Button size="sm" onClick={() => runJob.mutate(selectedJob.id)}>
                          <Play className="h-3.5 w-3.5 mr-1" />
                          Run
                        </Button>
                      )}
                      {selectedJob.status === "running" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => pauseJob.mutate(selectedJob.id)}>
                            <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => cancelJob.mutate(selectedJob.id)}>
                            <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                          </Button>
                        </>
                      )}
                      {(selectedJob.status === "done" || selectedJob.status === "failed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => exportResults.mutate({ jobId: selectedJob.id, format: "json" })}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" /> Export
                        </Button>
                      )}
                      {selectedJob.status !== "running" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            deleteJob.mutate(selectedJob.id);
                            setSelectedJobId(undefined);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <StatCard label="Status" value={selectedJob.status} />
                    <StatCard label="Pages" value={`${selectedJob.pagesDone}/${selectedJob.pagesTotal}`} />
                    <StatCard label="Records" value={selectedJob.recordsExtracted} />
                    <StatCard label="Errors" value={selectedJob.errorCount} />
                  </div>

                  {selectedJob.lastError && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      {selectedJob.lastError}
                    </div>
                  )}

                  {results && results.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">
                        Results ({results.length})
                      </Label>
                      <ScrollArea className="h-60">
                        <div className="space-y-1">
                          {results.map((r: any) => (
                            <div
                              key={r.id}
                              className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 text-sm transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Badge
                                  variant={r.statusCode === 200 ? "default" : "destructive"}
                                  className="text-xs"
                                >
                                  {r.statusCode}
                                </Badge>
                                <span className="truncate">{r.url}</span>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {r.extractionEngine}
                              </span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <ListTodo className="h-10 w-10 mb-3 opacity-20" />
              <p>Select a job to view details</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
