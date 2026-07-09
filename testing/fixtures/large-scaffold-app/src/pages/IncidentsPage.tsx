import { Link } from "react-router-dom";
import { IncidentTable } from "@/components/incidents/IncidentTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { filterRecords } from "@/lib/search";
import { useIncidents } from "@/hooks/useOpsQueries";

export default function IncidentsPage() {
  const query = useIncidents();
  const rows = query.data ?? [];
  const filtered = filterRecords(rows, "");
  return (
    <>
      <PageHeader title="Incidents" description="Browse incident records generated for this large scaffold-style fixture." actions={<Button variant="outline">Export</Button>} />
      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <IncidentTable items={filtered} />
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold">Fixture records</p>
            <p className="text-sm text-slate-600">This page renders {filtered.length} typed records through React Query and local mock services.</p>
            <div className="space-y-2">{filtered.slice(0, 5).map((item) => <Button key={item.id} asChild variant="secondary" className="w-full justify-start"><Link to={`/incidents/${item.id}`}>{item.name ?? item.title ?? item.id}</Link></Button>)}</div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
