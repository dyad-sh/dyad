import { Activity, AlertTriangle, DollarSign, Rocket } from "lucide-react";
import { DashboardHealth } from "@/components/dashboard/DashboardHealth";
import { DashboardNarrative } from "@/components/dashboard/DashboardNarrative";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { DashboardOwners } from "@/components/dashboard/DashboardOwners";
import { DashboardQueue } from "@/components/dashboard/DashboardQueue";
import { DashboardRegions } from "@/components/dashboard/DashboardRegions";
import { DashboardRevenue } from "@/components/dashboard/DashboardRevenue";
import { DashboardSla } from "@/components/dashboard/DashboardSla";
import { MetricCard } from "@/components/layout/MetricCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCompact, formatCurrency, formatPercent } from "@/lib/format";
import { useProjects, useWorkspaceOverview } from "@/hooks/useOpsQueries";
import { importedCorpusOverview } from "@/fixture-corpus";
import { importedCorpusOverview } from "@/fixture-corpus";

const Index = () => {
  const overview = useWorkspaceOverview();
  const projects = useProjects();
  const data = overview.data;
  const projectItems = projects.data ?? [];
  return (
    <>
      <PageHeader title="Operations dashboard" description="A broad static dashboard that mirrors a generated Dyad app after months of feature growth." />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Revenue" value={data ? formatCurrency(data.revenue) : "..."} detail="Mock customer ARR" icon={<DollarSign className="h-4 w-4" />} />
        <MetricCard title="Deployment health" value={data ? formatPercent(data.deploymentHealth) : "..."} detail="Across preview, staging, production" icon={<Rocket className="h-4 w-4" />} />
        <MetricCard title="Open incidents" value={data?.incidentLoad.open ?? "..."} detail="Deterministic fixture data" icon={<AlertTriangle className="h-4 w-4" />} />
        <MetricCard title="Automations" value={data?.automations ?? "..."} detail="Enabled workflow rules" icon={<Activity className="h-4 w-4" />} />
        <MetricCard title="Imported corpus" value={formatCompact(importedCorpusOverview.moduleCount)} detail={`${formatCompact(importedCorpusOverview.recordCount)} records in Vite graph`} icon={<Activity className="h-4 w-4" />} />
        <MetricCard title="Imported corpus" value={formatCompact(importedCorpusOverview.moduleCount)} detail={`${formatCompact(importedCorpusOverview.recordCount)} records in Vite graph`} icon={<Activity className="h-4 w-4" />} />
      </section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <DashboardOverview items={projectItems} />
        <DashboardHealth items={projectItems} />
        <DashboardRevenue items={projectItems} />
        <DashboardSla items={projectItems} />
        <DashboardQueue items={projectItems} />
        <DashboardRegions items={projectItems} />
        <DashboardOwners items={projectItems} />
        <DashboardNarrative items={projectItems} />
      </section>
    </>
  );
};

export default Index;
