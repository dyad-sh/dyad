import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getMembership, getOrgById } from "@/lib/orgs";
import { getOrgUsage } from "@/lib/usage";
import { FolderKanban, KeyRound, ScrollText, Users } from "lucide-react";

export const dynamic = "force-dynamic";

function UsageCard({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-bold text-foreground" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

export default async function UsagePage({
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

  const usage = await getOrgUsage(orgId);

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Usage</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A snapshot of this organization&apos;s activity.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <UsageCard
          icon={FolderKanban}
          label="Projects"
          value={usage.projects}
          testId="usage-projects-count"
        />
        <UsageCard
          icon={Users}
          label="Members"
          value={usage.members}
          testId="usage-members-count"
        />
        <UsageCard
          icon={KeyRound}
          label="Active API keys"
          value={usage.apiKeys}
          testId="usage-api-keys-count"
        />
        <UsageCard
          icon={ScrollText}
          label="Audit events"
          value={usage.auditEvents}
          testId="usage-events-count"
        />
      </div>
    </div>
  );
}
