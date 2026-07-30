import { NotAuthorized } from "@/components/not-authorized";
import { OrgSettingsForm } from "@/components/orgs/org-settings-form";
import { requireOrgAccess } from "@/lib/orgs";
import { isOrgAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function OrgSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }

  if (!isOrgAdmin(access.membership.role)) {
    return <NotAuthorized />;
  }

  const { org } = access;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage this organization&apos;s profile.
        </p>
      </div>
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
        <OrgSettingsForm
          orgId={org.id}
          initialName={org.name}
          initialDescription={org.description ?? ""}
        />
      </div>
    </div>
  );
}
