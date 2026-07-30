import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { getOrgForUser } from "@/lib/orgs";
import { NotAuthorized } from "@/components/not-authorized";
import { OrgShell } from "@/components/org-shell";
import { MembersClient, type Member, type Invite } from "./members-client";

export const dynamic = "force-dynamic";

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const org = await getOrgForUser(orgId, session.user.id);
  if (!org) return <NotAuthorized />;

  const isAdmin = org.role === "org_admin";

  const members = (await sql`
    SELECT m.user_id AS "userId", m.role, u.email, u.name
    FROM memberships m
    JOIN neon_auth."user" u ON u.id = m.user_id
    WHERE m.org_id = ${org.id}
    ORDER BY m.created_at ASC
  `) as Member[];

  let invites: Invite[] = [];
  let origin = "";
  if (isAdmin) {
    invites = (await sql`
      SELECT id, email, role, status, token
      FROM invites
      WHERE org_id = ${org.id}
      ORDER BY created_at DESC
    `) as Invite[];
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const proto = h.get("x-forwarded-proto") ?? "http";
    origin = `${proto}://${host}`;
  }

  return (
    <OrgShell org={org}>
      <MembersClient
        orgId={org.id}
        members={members}
        invites={invites}
        origin={origin}
        isAdmin={isAdmin}
      />
    </OrgShell>
  );
}
