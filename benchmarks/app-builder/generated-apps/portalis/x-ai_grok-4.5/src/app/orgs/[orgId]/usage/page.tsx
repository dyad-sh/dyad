import { NotAuthorized } from "@/components/not-authorized";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireOrgAccess } from "@/lib/orgs";
import { getOrgUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

export default async function UsagePage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }

  const usage = await getOrgUsage(orgId);

  const cards = [
    {
      label: "Projects",
      value: usage.projectsCount,
      testId: "usage-projects-count",
    },
    {
      label: "Members",
      value: usage.membersCount,
      testId: "usage-members-count",
    },
    {
      label: "Active API keys",
      value: usage.apiKeysCount,
      testId: "usage-api-keys-count",
    },
    {
      label: "Audit events",
      value: usage.eventsCount,
      testId: "usage-events-count",
    },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Snapshot of activity in this organization.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.testId} className="border-border/80 shadow-sm">
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle
                data-testid={card.testId}
                className="text-3xl font-semibold tracking-tight"
              >
                {card.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
