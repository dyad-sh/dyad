import { FolderKanban, KeyRound, ScrollText, Users } from "lucide-react";
import { NotAuthorized } from "@/components/not-authorized";
import { getOrgForMember, requireUser } from "@/lib/orgs";
import { getOrgUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

export default async function UsagePage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;

  const usage = await getOrgUsage(membership.org.id);

  const cards = [
    {
      label: "Projects",
      value: usage.projects,
      testId: "usage-projects-count",
      icon: FolderKanban,
    },
    {
      label: "Members",
      value: usage.members,
      testId: "usage-members-count",
      icon: Users,
    },
    {
      label: "Active API keys",
      value: usage.apiKeys,
      testId: "usage-api-keys-count",
      icon: KeyRound,
    },
    {
      label: "Audit events",
      value: usage.auditEvents,
      testId: "usage-events-count",
      icon: ScrollText,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Usage</h2>
        <p className="mt-1 text-sm text-slate-500">
          Current totals for {membership.org.name}.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.testId}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <card.icon className="h-4 w-4" />
            </span>
            <p
              data-testid={card.testId}
              className="mt-4 text-3xl font-semibold tracking-tight text-slate-900"
            >
              {card.value}
            </p>
            <p className="mt-1 text-sm text-slate-500">{card.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
