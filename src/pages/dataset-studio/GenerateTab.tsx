import { useState } from "react";
import { Sparkles, Wand2, Play, Plus, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useGenerationTemplates,
  useGenerateSingle,
  useStartGenerationBatch,
  useGenerationJobs,
  useCancelGenerationJob,
} from "@/hooks/useDataStudioExtended";

interface GenerateTabProps {
  datasetId: string | null;
}

export default function GenerateTab({ datasetId }: GenerateTabProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [generateCount, setGenerateCount] = useState("10");

  const { data: templates } = useGenerationTemplates();
  const { data: jobs } = useGenerationJobs({ datasetId: datasetId || undefined });
  const generateSingle = useGenerateSingle();
  const startBatch = useStartGenerationBatch();
  const cancelJob = useCancelGenerationJob();

  const handleGenerateSingle = () => {
    if (!selectedTemplate) return;
    generateSingle.mutate({ templateId: selectedTemplate });
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
            <CardDescription>Generate synthetic training data using AI templates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!datasetId ? (
              <p className="text-muted-foreground">Select a dataset first (Datasets tab)</p>
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
                  <Button onClick={handleStartBatch} disabled={!selectedTemplate || startBatch.isPending}>
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
            <CardDescription>Mix multiple datasets with different ratios</CardDescription>
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
                        <Badge
                          variant={
                            job.status === "running"
                              ? "default"
                              : job.status === "completed"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {job.status}
                        </Badge>
                        {job.status === "running" && (
                          <Button size="sm" variant="ghost" onClick={() => cancelJob.mutate(job.id)}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <Progress value={(job.progress.completed / job.progress.total) * 100} className="h-2" />
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
