import { NotAuthorized } from "@/components/not-authorized";
import { ApiKeysPanel } from "@/components/orgs/api-keys-panel";
import { listApiKeys } from "@/lib/api-keys";
import { requireOrgAccess } from "@/lib/orgs";
import { isOrgAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({
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

  const keys = await listApiKeys(orgId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">API keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue read-only credentials for{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            GET /api/v1/projects
          </code>
          . Secrets are shown once and stored hashed.
        </p>
      </div>
      <ApiKeysPanel
        orgId={orgId}
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.key_prefix,
          status: k.status,
        }))}
      />
    </div>
  );
}
