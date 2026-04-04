import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListTodo, CalendarClock, Layout } from "lucide-react";

// Re-use the existing well-built scraping tab components
import { JobsTab as ScrapingJobsPanel } from "../scraping/JobsTab";
import { SchedulesTab as SchedulesPanel } from "../scraping/SchedulesTab";
import { TemplatesTab as TemplatesPanel } from "../scraping/TemplatesTab";

export default function JobsTab() {
  const [subTab, setSubTab] = useState("jobs");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Jobs & Automation</h2>
        <p className="text-sm text-muted-foreground">
          Monitor scraping jobs, manage schedules, and reuse templates
        </p>
      </div>

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList>
          <TabsTrigger value="jobs" className="gap-1.5">
            <ListTodo className="h-3.5 w-3.5" />
            Active Jobs
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            Schedules
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <Layout className="h-3.5 w-3.5" />
            Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="mt-4">
          <ScrapingJobsPanel />
        </TabsContent>
        <TabsContent value="schedules" className="mt-4">
          <SchedulesPanel />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
