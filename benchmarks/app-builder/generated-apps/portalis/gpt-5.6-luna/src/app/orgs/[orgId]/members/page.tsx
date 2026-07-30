import Link from "next/link";
import { headers } from "next/headers";
import { sql } from "@/db";
import { PortalHeader } from "@/components/portal-header";
import { getMemberOrg, requireUser } from "@/lib/orgs";
import { MemberAdmin, type Invite, type Member } from "./member-admin";

export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const org = await getMemberOrg(orgId, user.id);
  if (!org || org.role !== "org_admin") return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-3xl px-6 py-16"><div data-testid="not-authorized" className="rounded-2xl border bg-white p-10 text-center"><h1 className="text-2xl font-semibold text-slate-950">Not authorized</h1><p className="mt-2 text-slate-500">Only organization admins can manage members.</p><Link href="/orgs" className="mt-6 inline-block text-sm font-medium text-blue-600 hover:underline">Back to organizations</Link></div></main></div>;

  const members = await sql`SELECT user_id, user_email, role FROM organization_members WHERE organization_id = ${org.id}::uuid ORDER BY created_at ASC` as Member[];
  const invites = await sql`SELECT id, invited_email, role, status, token FROM organization_invites WHERE organization_id = ${org.id}::uuid ORDER BY created_at DESC` as Invite[];
  const myRole = members.find((member) => member.user_id === user.id)?.role; const requestHeaders = await headers(); const protocol = requestHeaders.get("x-forwarded-proto") ?? "http"; const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost"; const origin = `${protocol}://${host}`;
  return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-5xl px-6 py-10"><Link href={`/orgs/${org.id}`} className="text-sm font-medium text-blue-600 hover:underline">← Back to {org.name}</Link><div className="mt-6"><p className="text-sm font-medium text-blue-600">Organization directory</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Members</h1><p className="mt-2 text-sm text-slate-500">{members.length} {members.length === 1 ? "member" : "members"}</p></div><div className="mt-8"><MemberAdmin orgId={org.id} members={members} invites={invites} origin={origin} isAdmin={myRole === "org_admin"} /></div></main></div>;
}
