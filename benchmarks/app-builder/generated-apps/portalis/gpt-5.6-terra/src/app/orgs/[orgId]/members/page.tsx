import { headers } from "next/headers";
import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { InvitePanel } from "@/components/invite-panel";
import { MemberAdmin } from "@/components/member-admin";
import { sql } from "@/db";
import { requireOrgMember } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization || role !== "org_admin") return <NotAuthorized />;
  const members = await sql`
    SELECT m.user_id, m.role, u.email
    FROM organization_memberships m JOIN neon_auth.user u ON u.id = m.user_id::text
    WHERE m.org_id = ${orgId}::uuid ORDER BY m.created_at ASC
  ` as unknown as { user_id: string; role: "org_admin" | "org_member"; email: string }[];
  const invites = role === "org_admin" ? await sql`SELECT id, email, role, token, status FROM organization_invites WHERE org_id = ${orgId}::uuid AND status = 'pending' ORDER BY created_at DESC` as unknown as { id: string; email: string; role: string; token: string; status: string }[] : [];
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin = `${protocol}://${host}`;

  return <PageShell><OrgShell org={organization} role={role!}><section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><h2 className="text-lg font-semibold">Members</h2><span data-testid="member-count" className="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700">{members.length} {members.length === 1 ? "member" : "members"}</span></div><table data-testid="members-table" className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3 font-medium">Email</th><th className="px-6 py-3 font-medium">Role</th>{role === "org_admin" && <th className="px-6 py-3" />}</tr></thead>{role === "org_admin" ? <MemberAdmin orgId={orgId} members={members} /> : <tbody>{members.map((member) => <tr key={member.user_id} data-testid="member-row" data-member-email={member.email} data-user-id={member.user_id} className="border-t border-slate-100"><td data-testid="member-email" className="px-6 py-4">{member.email}</td><td data-testid="member-role" className="px-6 py-4">{member.role}</td></tr>)}</tbody>}</table></section>{role === "org_admin" && <InvitePanel orgId={orgId} invites={invites} origin={origin} />}</OrgShell></PageShell>;
}
