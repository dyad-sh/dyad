import Link from "next/link";
import { sql } from "@/db";
import { PortalHeader } from "@/components/portal-header";
import { getMemberOrg, requireUser } from "@/lib/orgs";
import { KeyAdmin } from "./key-admin";

export const dynamic = "force-dynamic";
export default async function ApiKeysPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const org = await getMemberOrg(orgId, user.id);
  if (!org || org.role !== "org_admin") return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="p-16"><div data-testid="not-authorized">Not authorized</div></main></div>;
  const keys = await sql`SELECT id, name, prefix, status FROM api_keys WHERE organization_id = ${org.id}::uuid ORDER BY created_at DESC` as { id: string; name: string; prefix: string; status: string }[];
  return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-4xl px-6 py-10"><Link href={`/orgs/${org.id}`} className="text-sm font-medium text-blue-600 hover:underline">← Back to {org.name}</Link><div className="mt-6"><p className="text-sm font-medium text-blue-600">Administration</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">API keys</h1><p className="mt-2 text-sm text-slate-500">Keys provide read-only access to this organization’s projects.</p></div><div className="mt-8"><KeyAdmin orgId={org.id} initialKeys={keys} /></div></main></div>;
}
