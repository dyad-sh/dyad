import { useState } from "react";
import {
  HardDrive,
  AlertCircle,
  Loader2,
  ChevronLeft,
  Lock,
  Globe,
} from "lucide-react";
import {
  useStorageBuckets,
  useStorageObjects,
} from "@/hooks/useStorageBuckets";
import { PaginationControls } from "../PaginationControls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StorageSectionProps {
  projectId: string;
  organizationSlug: string | null;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StorageSection({
  projectId,
  organizationSlug,
}: StorageSectionProps) {
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [offset, setOffset] = useState(DEFAULT_OFFSET);

  const {
    data: buckets,
    isLoading: bucketsLoading,
    error: bucketsError,
  } = useStorageBuckets({ projectId, organizationSlug });

  const {
    data: objectsData,
    isLoading: objectsLoading,
    isFetching: objectsFetching,
    error: objectsError,
  } = useStorageObjects({
    projectId,
    organizationSlug,
    bucketId: selectedBucket,
    limit,
    offset,
  });

  const objects = objectsData?.objects ?? [];
  const total = objectsData?.total ?? null;

  const handleBackToBuckets = () => {
    setSelectedBucket(null);
    setOffset(DEFAULT_OFFSET);
  };

  if (bucketsLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="p-4 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  if (bucketsError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load storage buckets</AlertTitle>
          <AlertDescription>{bucketsError.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const bucketsList = buckets ?? [];

  // Bucket detail view
  if (selectedBucket) {
    const bucket = bucketsList.find((b) => b.id === selectedBucket);

    return (
      <div className="flex flex-col h-full">
        {/* Header with back button */}
        <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleBackToBuckets}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <HardDrive className="h-4 w-4" />
          <span className="text-sm font-medium">{selectedBucket}</span>
          {bucket && (
            <Badge variant={bucket.public ? "secondary" : "outline"}>
              {bucket.public ? "Public" : "Private"}
            </Badge>
          )}
          {objectsFetching && !objectsLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
          )}
        </div>

        {/* Objects content */}
        <div className="flex-1 overflow-auto">
          {objectsLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : objectsError ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Failed to load files</AlertTitle>
                <AlertDescription>{objectsError.message}</AlertDescription>
              </Alert>
            </div>
          ) : objects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
              <HardDrive className="w-12 h-12 text-muted-foreground" />
              <div>
                <h3 className="text-lg font-medium mb-2">No Files</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  This bucket is empty. Upload files to see them here.
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs">Name</TableHead>
                  <TableHead className="font-mono text-xs">Size</TableHead>
                  <TableHead className="font-mono text-xs">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {objects.map((obj) => (
                  <TableRow key={obj.id}>
                    <TableCell className="font-mono text-xs font-medium">
                      {obj.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {obj.metadata &&
                      typeof obj.metadata === "object" &&
                      "size" in obj.metadata
                        ? formatFileSize(Number(obj.metadata.size))
                        : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {new Date(obj.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        {objects.length > 0 && (
          <PaginationControls
            total={total}
            limit={limit}
            offset={offset}
            onLimitChange={(newLimit) => {
              setLimit(newLimit);
              setOffset(0);
            }}
            onOffsetChange={setOffset}
            isLoading={objectsFetching}
          />
        )}
      </div>
    );
  }

  // Buckets list view
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <HardDrive className="h-4 w-4" />
        <h3 className="text-sm font-medium">
          Storage Buckets{" "}
          <span className="text-muted-foreground">({bucketsList.length})</span>
        </h3>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {bucketsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
            <HardDrive className="w-12 h-12 text-muted-foreground" />
            <div>
              <h3 className="text-lg font-medium mb-2">No Buckets</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                No storage buckets found. Create a bucket in Supabase to manage
                files.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {bucketsList.map((bucket) => (
              <button
                key={bucket.id}
                type="button"
                onClick={() => setSelectedBucket(bucket.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-md border border-border",
                  "hover:bg-accent/50 transition-colors text-left",
                )}
              >
                {bucket.public ? (
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {bucket.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {bucket.public ? "Public" : "Private"}
                    {bucket.file_size_limit &&
                      ` · Max ${formatFileSize(bucket.file_size_limit)}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
