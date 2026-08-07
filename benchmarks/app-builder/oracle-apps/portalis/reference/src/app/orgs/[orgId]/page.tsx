import Link from "next/link";
import { FolderKanban, Settings, Users } from "lucide-react";
import { NotAuthorized } from "@/components/not-authorized";
import { getOrgForMember, listOrgMembers, requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;

  const { org, role } = membership;
  const members = await listOrgMembers(org.id);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{org.name}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {org.description || "No description yet."}
        </p>
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Slug
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {org.slug}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Members
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {members.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Your role
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">{role}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Link
          href={`/orgs/${org.id}/projects`}
          className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <FolderKanban className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">
              Projects
            </span>
            <span className="mt-0.5 block text-sm text-slate-500">
              Browse and create projects.
            </span>
          </span>
        </Link>
        <Link
          href={`/orgs/${org.id}/settings`}
          className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Settings className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">
              Settings
            </span>
            <span className="mt-0.5 block text-sm text-slate-500">
              Update the organization profile.
            </span>
          </span>
        </Link>
        <Link
          href={`/orgs/${org.id}/members`}
          className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Users className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">
              Members
            </span>
            <span className="mt-0.5 block text-sm text-slate-500">
              See who has access.
            </span>
          </span>
        </Link>
      </section>
    </div>
  );
}
