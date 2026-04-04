import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, MousePointer2, Bug, Upload, Rss, Code } from "lucide-react";

// Re-export scraping tabs directly — they are already well-built standalone components
import { QuickScrapeTab } from "../scraping/QuickScrapeTab";
import { VisualBuilderTab } from "../scraping/VisualBuilderTab";
import { CrawlerTab } from "../scraping/CrawlerTab";
import { ImportSubTab } from "./collect/ImportSubTab";
import { FeedSubTab } from "./collect/FeedSubTab";
import { ApiSubTab } from "./collect/ApiSubTab";

interface CollectTabProps {
  datasetId: string | null;
}

export default function CollectTab({ datasetId }: CollectTabProps) {
  const [subTab, setSubTab] = useState("quick");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Data Collection</h2>
        <p className="text-sm text-muted-foreground">
          Scrape websites, import files, consume feeds, or hit APIs — all in one place
        </p>
      </div>

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList>
          <TabsTrigger value="quick" className="gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Quick Scrape
          </TabsTrigger>
          <TabsTrigger value="builder" className="gap-1.5">
            <MousePointer2 className="h-3.5 w-3.5" />
            Visual Builder
          </TabsTrigger>
          <TabsTrigger value="crawler" className="gap-1.5">
            <Bug className="h-3.5 w-3.5" />
            Crawler
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            Import
          </TabsTrigger>
          <TabsTrigger value="feed" className="gap-1.5">
            <Rss className="h-3.5 w-3.5" />
            RSS Feed
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-1.5">
            <Code className="h-3.5 w-3.5" />
            API
          </TabsTrigger>
        </TabsList>

        <TabsContent value="quick" className="mt-4">
          <QuickScrapeTab />
        </TabsContent>
        <TabsContent value="builder" className="mt-4">
          <VisualBuilderTab />
        </TabsContent>
        <TabsContent value="crawler" className="mt-4">
          <CrawlerTab />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <ImportSubTab datasetId={datasetId} />
        </TabsContent>
        <TabsContent value="feed" className="mt-4">
          <FeedSubTab datasetId={datasetId} />
        </TabsContent>
        <TabsContent value="api" className="mt-4">
          <ApiSubTab datasetId={datasetId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
