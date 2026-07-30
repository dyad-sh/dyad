import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getOrgForUser } from "@/lib/orgs";
import { NotAuthorized } from "@/components/not-authorized";
import { OrgShell } from "@/components/org-shell";
import { AuditClient } from "./audit-client";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const org = await getOrgForUser(orgId, session.user.id);
  if (!org || org.role !== "org_admin") return <NotAuthorized />;

  return (
    <OrgShell org={org}>
      <AuditClient orgId={org.id} />
    </OrgShell>
  );
}
