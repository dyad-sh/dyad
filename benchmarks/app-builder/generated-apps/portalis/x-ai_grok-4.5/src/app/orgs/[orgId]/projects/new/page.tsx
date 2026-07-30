import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateProjectForm } from "@/components/orgs/create-project-form";
import { NotAuthorized } from "@/components/not-authorized";
import { requireOrgAccess } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/orgs/${orgId}/projects`}
          className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to projects
        </Link>
        <h2 className="text-xl font-semibold tracking-tight">New project</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a project in this organization.
        </p>
      </div>
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
        <CreateProjectForm orgId={orgId} />
      </div>
    </div>
  );
}
