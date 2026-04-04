import { useState } from "react";
import { Rss, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScrapeFeedToDataset } from "@/hooks/useDataStudioExtended";

interface FeedSubTabProps {
  datasetId: string | null;
}

export function FeedSubTab({ datasetId }: FeedSubTabProps) {
  const [feedUrl, setFeedUrl] = useState("");
  const scrapeFeed = useScrapeFeedToDataset();

  const handleScrapeFeed = () => {
    if (!datasetId || !feedUrl) return;
    scrapeFeed.mutate({
      datasetId,
      feedUrl,
      scrapeFullContent: true,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rss className="h-5 w-5" />
          RSS / Atom Feed
        </CardTitle>
        <CardDescription>Import articles from RSS and Atom feeds into your dataset</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!datasetId ? (
          <p className="text-muted-foreground">Select a dataset first (Datasets tab)</p>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">RSS/Atom Feed URL</label>
              <Input
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
              />
            </div>
            <Button onClick={handleScrapeFeed} disabled={!feedUrl || scrapeFeed.isPending}>
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
        )}
      </CardContent>
    </Card>
  );
}
