import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { getOrgForUser } from "@/lib/orgs";
import { NotAuthorized } from "@/components/not-authorized";
import { OrgShell } from "@/components/org-shell";
import { ApiKeysClient, type ApiKey } from "./api-keys-client";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const org = await getOrgForUser(orgId, session.user.id);
  if (!org || org.role !== "org_admin") return <NotAuthorized />;

  const keys = (await sql`
    SELECT id, name, prefix, status
    FROM api_keys
    WHERE org_id = ${org.id}
    ORDER BY created_at DESC
  `) as ApiKey[];

  return (
    <OrgShell org={org}>
      <ApiKeysClient orgId={org.id} keys={keys} />
    </OrgShell>
  );
}
