import { Link } from "react-router-dom";
import { ProjectTable } from "@/components/projects/ProjectTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { filterRecords } from "@/lib/search";
import { useProjects } from "@/hooks/useOpsQueries";

export default function ProjectsPage() {
  const query = useProjects();
  const rows = query.data ?? [];
  const filtered = filterRecords(rows, "");
  return (
    <>
      <PageHeader title="Projects" description="Browse project records generated for this large scaffold-style fixture." actions={<Button variant="outline">Export</Button>} />
      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ProjectTable items={filtered} />
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold">Fixture records</p>
            <p className="text-sm text-slate-600">This page renders {filtered.length} typed records through React Query and local mock services.</p>
            <div className="space-y-2">{filtered.slice(0, 5).map((item) => <Button key={item.id} asChild variant="secondary" className="w-full justify-start"><Link to={`/projects/${item.id}`}>{item.name}</Link></Button>)}</div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
