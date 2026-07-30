import Link from "next/link";
import {
  Activity,
  FolderKanban,
  KeyRound,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import { NotAuthorized } from "@/components/not-authorized";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireOrgAccess } from "@/lib/orgs";
import { isOrgAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }

  const { org, membership } = access;
  const admin = isOrgAdmin(membership.role);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {org.description?.trim()
            ? org.description
            : admin
              ? "No description yet. Add one in Settings."
              : "No description yet."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href={`/orgs/${org.id}/projects`} className="group block">
          <Card className="h-full transition-shadow group-hover:shadow-md">
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <FolderKanban className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Projects</CardTitle>
              <CardDescription>
                View and manage projects in this organization.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href={`/orgs/${org.id}/members`} className="group block">
          <Card className="h-full transition-shadow group-hover:shadow-md">
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <Users className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Members</CardTitle>
              <CardDescription>
                View who belongs to this organization and their roles.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href={`/orgs/${org.id}/usage`} className="group block">
          <Card className="h-full transition-shadow group-hover:shadow-md">
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <Activity className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Usage</CardTitle>
              <CardDescription>
                Counts of projects, members, keys, and events.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {admin ? (
          <>
            <Link href={`/orgs/${org.id}/settings`} className="group block">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <Settings className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">Settings</CardTitle>
                  <CardDescription>
                    Update the organization name and description.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <Link href={`/orgs/${org.id}/audit`} className="group block">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <ScrollText className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">Audit</CardTitle>
                  <CardDescription>
                    Review administrative changes for this organization.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <Link href={`/orgs/${org.id}/api-keys`} className="group block">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">API keys</CardTitle>
                  <CardDescription>
                    Issue and revoke read-only org credentials.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
