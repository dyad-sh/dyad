import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getMembership, getOrgById } from "@/lib/orgs";
import { AuditPanel } from "./audit-panel";

export const dynamic = "force-dynamic";

export default async function AuditPage({
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

  if (membership.role !== "org_admin") {
    return (
      <div className="mx-auto max-w-2xl py-10 text-center">
        <div
          data-testid="not-authorized"
          className="rounded-xl border border-border bg-card px-6 py-10"
        >
          <h1 className="text-xl font-semibold text-foreground">
            Not authorized
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only organization admins can view the audit log.
          </p>
        </div>
      </div>
    );
  }

  return <AuditPanel orgId={orgId} />;
}
