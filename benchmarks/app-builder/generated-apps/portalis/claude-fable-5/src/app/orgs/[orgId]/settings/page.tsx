import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getOrgForUser } from "@/lib/orgs";
import { NotAuthorized } from "@/components/not-authorized";
import { OrgShell } from "@/components/org-shell";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function OrgSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const org = await getOrgForUser(orgId, session.user.id);
  if (!org) return <NotAuthorized />;

  return (
    <OrgShell org={org}>
      {org.role === "org_admin" ? (
        <SettingsForm
          orgId={org.id}
          initialName={org.name}
          initialDescription={org.description}
        />
      ) : (
        <div className="max-w-lg space-y-4 rounded-lg border bg-background p-6">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Name</p>
            <p className="font-medium">{org.name}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Description
            </p>
            <p>{org.description || "—"}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Only organization admins can edit these settings.
          </p>
        </div>
      )}
    </OrgShell>
  );
}
