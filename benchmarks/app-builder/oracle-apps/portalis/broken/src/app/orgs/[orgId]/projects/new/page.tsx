import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NotAuthorized } from "@/components/not-authorized";
import { getOrgForMember, requireUser } from "@/lib/orgs";
import { CreateProjectForm } from "./create-project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;

  return (
    <div className="max-w-lg">
      <Link
        href={`/orgs/${membership.org.id}/projects`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to projects
      </Link>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">New project</h2>
        <p className="mt-1 text-sm text-slate-500">
          Projects belong to {membership.org.name} only.
        </p>
        <div className="mt-6">
          <CreateProjectForm orgId={membership.org.id} />
        </div>
      </div>
    </div>
  );
}
