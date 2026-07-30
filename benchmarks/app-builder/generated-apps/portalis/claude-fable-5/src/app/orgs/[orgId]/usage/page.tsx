import { redirect } from "next/navigation";
import { BarChart3, FolderKanban, KeyRound, Users } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { getOrgForUser } from "@/lib/orgs";
import { NotAuthorized } from "@/components/not-authorized";
import { OrgShell } from "@/components/org-shell";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function UsagePage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const org = await getOrgForUser(orgId, session.user.id);
  if (!org) return <NotAuthorized />;

  const rows = await sql`
    SELECT
      (SELECT count(*) FROM projects WHERE org_id = ${org.id})::int AS projects,
      (SELECT count(*) FROM memberships WHERE org_id = ${org.id})::int AS members,
      (SELECT count(*) FROM api_keys WHERE org_id = ${org.id} AND status = 'active')::int AS "apiKeys",
      (SELECT count(*) FROM audit_log WHERE org_id = ${org.id})::int AS events
  `;
  const usage = rows[0] as {
    projects: number;
    members: number;
    apiKeys: number;
    events: number;
  };

  const stats = [
    {
      label: "Projects",
      value: usage.projects,
      testid: "usage-projects-count",
      icon: FolderKanban,
    },
    {
      label: "Members",
      value: usage.members,
      testid: "usage-members-count",
      icon: Users,
    },
    {
      label: "Active API keys",
      value: usage.apiKeys,
      testid: "usage-api-keys-count",
      icon: KeyRound,
    },
    {
      label: "Audit events",
      value: usage.events,
      testid: "usage-events-count",
      icon: BarChart3,
    },
  ];

  return (
    <OrgShell org={org}>
      <h2 className="text-lg font-semibold">Usage</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.testid}>
            <CardContent className="flex items-center gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <stat.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-2xl font-bold" data-testid={stat.testid}>
                  {stat.value}
                </p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </OrgShell>
  );
}
