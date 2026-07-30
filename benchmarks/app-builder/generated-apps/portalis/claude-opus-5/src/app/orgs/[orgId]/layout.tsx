import type { ReactNode } from "react";
import Link from "next/link";
import { NotAuthorized } from "@/components/not-authorized";
import { getOrgForMember, requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);

  if (!membership) return <NotAuthorized />;

  const { org } = membership;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link
            href="/orgs"
            className="text-xs font-medium text-slate-400 transition hover:text-slate-600"
          >
            Organizations
          </Link>
          <h1
            data-testid="org-header-name"
            className="text-2xl font-semibold tracking-tight text-slate-900"
          >
            {org.name}
          </h1>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            href={`/orgs/${org.id}/projects`}
            data-testid="nav-projects"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Projects
          </Link>
          <Link
            href={`/orgs/${org.id}/settings`}
            data-testid="nav-settings"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Settings
          </Link>
          <Link
            href={`/orgs/${org.id}/members`}
            data-testid="nav-members"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Members
          </Link>
          <Link
            href={`/orgs/${org.id}/usage`}
            data-testid="nav-usage"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Usage
          </Link>
          <Link
            href={`/orgs/${org.id}/api-keys`}
            data-testid="nav-api-keys"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            API keys
          </Link>
          <Link
            href={`/orgs/${org.id}/audit`}
            data-testid="nav-audit"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Audit
          </Link>
        </nav>
      </div>
      <div className="pt-8">{children}</div>
    </div>
  );
}
