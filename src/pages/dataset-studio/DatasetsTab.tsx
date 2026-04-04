import { useState } from "react";
import {
  Database,
  Search,
  Download,
  FileText,
  Image,
  Music,
  Video,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useDatasetStatistics,
  useIndexDataset,
} from "@/hooks/useDataStudioExtended";
import { useStudioDatasets, type StudioDataset } from "@/hooks/useDatasetStudio";

type Dataset = StudioDataset;

interface DatasetsTabProps {
  selectedDatasetId: string | null;
  onSelectDataset: (id: string) => void;
}

export default function DatasetsTab({ selectedDatasetId, onSelectDataset }: DatasetsTabProps) {
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Datasets</CardTitle>
          </CardHeader>
          <CardContent>
            <DatasetList onSelect={onSelectDataset} />
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
  );
}

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
