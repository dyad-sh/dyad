import { useParams } from "react-router-dom";
import { ProjectBudget } from "@/components/projects/ProjectBudget";
import { ProjectHealth } from "@/components/projects/ProjectHealth";
import { ProjectTimeline } from "@/components/projects/ProjectTimeline";
import { PageHeader } from "@/components/layout/PageHeader";
import { useProject, useProjects } from "@/hooks/useOpsQueries";

export default function ProjectDetailPage() {
  const { id = "" } = useParams();
  const project = useProject(id);
  const projects = useProjects();
  const item = project.data;
  return (
    <>
      <PageHeader title={item?.name ?? "Project detail"} description={item?.summary ?? "Detailed project route for fixture navigation."} />
      <section className="grid gap-4 lg:grid-cols-3">
        <ProjectHealth items={item ? [item] : []} />
        <ProjectBudget items={item ? [item] : []} />
        <ProjectTimeline items={projects.data ?? []} compact />
      </section>
    </>
  );
}
