/**
 * Scraping Page — Redesigned 7-tab web scraping interface.
 *
 * Thin shell: polished header + tab strip + lazy tab imports.
 * Each tab lives in its own file for maintainability.
 */

import { useState } from "react";
import {
  Globe,
  Zap,
  MousePointer2,
  Bug,
  ListTodo,
  CalendarClock,
  Layout,
  Settings,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useScrapingJobs } from "@/hooks/use_scraping";
import { QuickScrapeTab } from "./QuickScrapeTab";
import { VisualBuilderTab } from "./VisualBuilderTab";
import { CrawlerTab } from "./CrawlerTab";
import { JobsTab } from "./JobsTab";
import { SchedulesTab } from "./SchedulesTab";
import { TemplatesTab } from "./TemplatesTab";
import { SettingsTab } from "./SettingsTab";

export default function ScrapingPage() {
  const [activeTab, setActiveTab] = useState("quick");
  const { data: jobs = [] } = useScrapingJobs();
  const runningCount = jobs.filter((j: any) => j.status === "running").length;

  return (
    <div className="flex flex-col h-full w-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-border/50 px-6 py-5 bg-gradient-to-r from-rose-500/5 via-orange-500/5 to-amber-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500/20 via-orange-500/20 to-amber-500/20 border border-rose-500/20">
              <Globe className="h-5 w-5 text-rose-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-rose-600 via-orange-600 to-amber-600 bg-clip-text text-transparent">
                Web Scraping
              </h1>
              <p className="text-sm text-muted-foreground">
                Multi-engine extraction with anti-bot bypass
              </p>
            </div>
          </div>

          {/* Live counters */}
          <div className="flex items-center gap-2">
            {runningCount > 0 && (
              <Badge variant="outline" className="gap-1 text-blue-500 border-blue-500/20 bg-blue-500/5 animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {runningCount} running
              </Badge>
            )}
            <Badge variant="outline" className="text-muted-foreground">
              {jobs.length} total jobs
            </Badge>
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="border-b border-border/50 px-6">
          <TabsList className="h-11 bg-transparent">
            <TabsTrigger value="quick" className="gap-1.5 data-[state=active]:shadow-none">
              <Zap className="h-3.5 w-3.5" />
              Quick Scrape
            </TabsTrigger>
            <TabsTrigger value="builder" className="gap-1.5 data-[state=active]:shadow-none">
              <MousePointer2 className="h-3.5 w-3.5" />
              Visual Builder
            </TabsTrigger>
            <TabsTrigger value="crawler" className="gap-1.5 data-[state=active]:shadow-none">
              <Bug className="h-3.5 w-3.5" />
              Crawler
            </TabsTrigger>
            <TabsTrigger value="jobs" className="gap-1.5 data-[state=active]:shadow-none">
              <ListTodo className="h-3.5 w-3.5" />
              Jobs
              {runningCount > 0 && (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
              )}
            </TabsTrigger>
            <TabsTrigger value="schedules" className="gap-1.5 data-[state=active]:shadow-none">
              <CalendarClock className="h-3.5 w-3.5" />
              Schedules
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5 data-[state=active]:shadow-none">
              <Layout className="h-3.5 w-3.5" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 data-[state=active]:shadow-none">
              <Settings className="h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6">
            <TabsContent value="quick" className="mt-0">
              <QuickScrapeTab />
            </TabsContent>
            <TabsContent value="builder" className="mt-0">
              <VisualBuilderTab />
            </TabsContent>
            <TabsContent value="crawler" className="mt-0">
              <CrawlerTab />
            </TabsContent>
            <TabsContent value="jobs" className="mt-0">
              <JobsTab />
            </TabsContent>
            <TabsContent value="schedules" className="mt-0">
              <SchedulesTab />
            </TabsContent>
            <TabsContent value="templates" className="mt-0">
              <TemplatesTab />
            </TabsContent>
            <TabsContent value="settings" className="mt-0">
              <SettingsTab />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
