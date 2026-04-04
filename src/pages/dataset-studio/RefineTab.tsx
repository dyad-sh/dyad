import { useState } from "react";
import DOMPurify from "dompurify";
import {
  FileCheck,
  Search,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useQualityStatistics,
  useBatchQualityAnalysis,
  useExactDuplicates,
  useSearch,
  useSearchSuggestions,
  useSearchFacets,
  useSearchIndexStats,
} from "@/hooks/useDataStudioExtended";
import type { SearchQuery } from "@/ipc/data_studio_extended_client";

interface RefineTabProps {
  datasetId: string | null;
}

export default function RefineTab({ datasetId }: RefineTabProps) {
  return (
    <div className="space-y-6">
      <QualityPanel datasetId={datasetId} />
      <SearchPanel />
    </div>
  );
}

function QualityPanel({ datasetId }: { datasetId: string | null }) {
  const { data: qualityStats } = useQualityStatistics(datasetId || "");
  const { data: duplicates } = useExactDuplicates(datasetId || "");
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
          <CardDescription>Analyze and filter data quality</CardDescription>
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
                <p className="text-2xl font-bold text-green-600">{qualityStats.statistics.analyzed}</p>
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

function SearchPanel() {
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState<SearchQuery | null>(null);

  const { data: searchResults, isLoading } = useSearch(searchQuery);
  const { data: suggestions } = useSearchSuggestions(searchText);
  const { data: facets } = useSearchFacets(searchText);
  const { data: indexStats } = useSearchIndexStats();

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
          <CardDescription>Search across all indexed datasets</CardDescription>
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
                <Badge key={i} variant="secondary" className="cursor-pointer" onClick={() => setSearchText(s.text)}>
                  {s.text}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                      <span className="text-xs text-muted-foreground">Score: {result.rank.toFixed(2)}</span>
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
