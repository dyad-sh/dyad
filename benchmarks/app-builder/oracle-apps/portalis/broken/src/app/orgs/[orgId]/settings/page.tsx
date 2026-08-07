import { NotAuthorized } from "@/components/not-authorized";
import { getOrgForMember, requireUser } from "@/lib/orgs";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function OrgSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;
  if (membership.role !== "org_admin") return <NotAuthorized />;

  const { org } = membership;

  return (
    <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        Organization profile
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Update how this organization appears across Portalis.
      </p>
      <div className="mt-6">
        <SettingsForm
          orgId={org.id}
          initialName={org.name}
          initialDescription={org.description ?? ""}
        />
      </div>
    </div>
  );
}
