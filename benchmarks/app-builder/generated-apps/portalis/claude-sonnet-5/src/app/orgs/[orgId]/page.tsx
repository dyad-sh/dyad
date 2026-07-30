import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/server";
import { getMembership, getOrgById } from "@/lib/orgs";
import { FolderKanban, Settings, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const org = await getOrgById(orgId);
  const membership = org
    ? await getMembership(orgId, session.user.id)
    : undefined;

  if (!org || !membership) {
    return null;
  }

  return (
    <div>
      {org.description && (
        <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
          {org.description}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href={`/orgs/${orgId}/projects`}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
        >
          <FolderKanban className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="font-semibold text-foreground">Projects</div>
            <div className="text-sm text-muted-foreground">
              View and manage projects
            </div>
          </div>
        </Link>

        <Link
          href={`/orgs/${orgId}/settings`}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
        >
          <Settings className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="font-semibold text-foreground">Settings</div>
            <div className="text-sm text-muted-foreground">
              Update organization profile
            </div>
          </div>
        </Link>

        <Link
          href={`/orgs/${orgId}/members`}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
        >
          <Users className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="font-semibold text-foreground">Members</div>
            <div className="text-sm text-muted-foreground">
              View organization members
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
