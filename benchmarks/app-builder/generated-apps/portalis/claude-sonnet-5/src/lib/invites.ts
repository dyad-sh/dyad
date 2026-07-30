import { randomBytes } from "crypto";
import { sql } from "@/db";
import type { OrgRole } from "@/lib/orgs";

export type InviteStatus = "pending" | "accepted" | "revoked";

export interface Invite {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  status: InviteStatus;
  created_at: string;
  accepted_at: string | null;
}

export interface InviteWithOrg extends Invite {
  org_name: string;
}

export function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

export async function getOrgInvites(orgId: string): Promise<Invite[]> {
  const rows = await sql`
    SELECT id, org_id, email, role, token, status, created_at, accepted_at
    FROM invites
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
  `;
  return rows as unknown as Invite[];
}

export async function getInviteByToken(
  token: string,
): Promise<InviteWithOrg | undefined> {
  const rows = await sql`
    SELECT i.id, i.org_id, i.email, i.role, i.token, i.status, i.created_at, i.accepted_at, o.name AS org_name
    FROM invites i
    JOIN organizations o ON o.id = i.org_id
    WHERE i.token = ${token}
  `;
  return rows[0] as InviteWithOrg | undefined;
}
