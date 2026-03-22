import { useState } from "react";
import { Bug, Play, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showError, showSuccess } from "@/lib/toast";
import { useCreateScrapingJob, useRunScrapingJob } from "@/hooks/use_scraping";
import { fadeUpVariant } from "./constants";

export function CrawlerTab() {
  const [seedUrl, setSeedUrl] = useState("");
  const [maxPages, setMaxPages] = useState("50");
  const [maxDepth, setMaxDepth] = useState("3");
  const [scope, setScope] = useState("subdomain");
  const createJob = useCreateScrapingJob();
  const runJob = useRunScrapingJob();

  const handleStartCrawl = async () => {
    if (!seedUrl.trim()) return;
    try {
      const result = await createJob.mutateAsync({
        name: `Crawl: ${new URL(seedUrl).hostname}`,
        config: {
          sourceType: "url",
          url: seedUrl,
          mode: "hybrid",
          crawl: {
            enabled: true,
            maxPages: Number.parseInt(maxPages, 10),
            maxDepth: Number.parseInt(maxDepth, 10),
            scope,
            respectRobots: true,
          },
          output: { format: "markdown" },
        },
      });
      await runJob.mutateAsync(result.jobId);
      showSuccess("Crawl started");
    } catch (err: any) {
      showError(err.message);
    }
  };

  return (
    <motion.div {...fadeUpVariant} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-green-500" />
            Site Crawler
          </CardTitle>
          <CardDescription>
            Crawl an entire site with configurable depth, scope, and concurrency
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Seed URL</Label>
            <Input
              placeholder="https://docs.example.com"
              value={seedUrl}
              onChange={(e) => setSeedUrl(e.target.value)}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Max Pages</Label>
              <Input
                type="number"
                value={maxPages}
                onChange={(e) => setMaxPages(e.target.value)}
                min="1"
                max="10000"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Max Depth</Label>
              <Input
                type="number"
                value={maxDepth}
                onChange={(e) => setMaxDepth(e.target.value)}
                min="1"
                max="20"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subdomain">Same Subdomain</SelectItem>
                  <SelectItem value="domain">Same Domain</SelectItem>
                  <SelectItem value="path">Same Path</SelectItem>
                  <SelectItem value="custom_regex">Custom Regex</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleStartCrawl} disabled={!seedUrl.trim() || createJob.isPending}>
            {createJob.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Start Crawl
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
