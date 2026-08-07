import { NotAuthorized } from "@/components/not-authorized";
import { listApiKeys } from "@/lib/api-keys";
import { getOrgForMember, requireUser } from "@/lib/orgs";
import { ApiKeysManager } from "./api-keys-manager";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;
  if (membership.role !== "org_admin") return <NotAuthorized />;

  const keys = await listApiKeys(membership.org.id);

  return <ApiKeysManager orgId={membership.org.id} keys={keys} />;
}
