import { ReportExecutive } from "@/components/reports/ReportExecutive";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { filterRecords } from "@/lib/search";
import { useReportMetrics } from "@/hooks/useOpsQueries";

export default function ReportsPage() {
  const query = useReportMetrics();
  const rows = query.data ?? [];
  const filtered = filterRecords(rows, "");
  return (
    <>
      <PageHeader title="Reports" description="Browse metric records generated for this large scaffold-style fixture." actions={<Button variant="outline">Export</Button>} />
      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ReportExecutive items={filtered} />
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold">Fixture records</p>
            <p className="text-sm text-slate-600">This page renders {filtered.length} typed records through React Query and local mock services.</p>
            <p className="rounded-md bg-slate-100 p-3 text-xs text-slate-500">This section intentionally contains enough static structure to look like a mature generated product.</p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
