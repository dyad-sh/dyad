import { randomBytes } from "crypto";
import { sql, withTransaction } from "@/db";
import { insertAuditLog, type AuditActor } from "@/lib/audit";
import type { SessionUser } from "@/lib/orgs";
import { isOrgRole, type OrgRole } from "@/lib/roles";

export type InviteStatus = "pending" | "accepted" | "revoked";

export type OrganizationInvite = {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  status: InviteStatus;
  invited_by: string;
  created_at: string;
  updated_at: string;
};

export type InviteWithOrg = OrganizationInvite & {
  org_name: string;
};

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function listPendingInvites(
  orgId: string,
): Promise<OrganizationInvite[]> {
  const rows = await sql`
    SELECT id, org_id, email, role, token, status, invited_by, created_at, updated_at
    FROM organization_invites
    WHERE org_id = ${orgId} AND status = 'pending'
    ORDER BY created_at DESC
  `;
  return rows as OrganizationInvite[];
}

export async function createInvite(input: {
  orgId: string;
  email: string;
  role: string;
  actor: AuditActor;
}): Promise<{ invite?: OrganizationInvite; error?: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { error: "A valid email is required." };
  }
  if (!isOrgRole(input.role)) {
    return { error: "Invalid role." };
  }

  const existingMember = await sql`
    SELECT id FROM organization_members
    WHERE org_id = ${input.orgId} AND lower(email) = ${email}
    LIMIT 1
  `;
  if (existingMember.length > 0) {
    return { error: "That user is already a member of this organization." };
  }

  const existingPending = await sql`
    SELECT id FROM organization_invites
    WHERE org_id = ${input.orgId}
      AND lower(email) = ${email}
      AND status = 'pending'
    LIMIT 1
  `;
  if (existingPending.length > 0) {
    return { error: "A pending invite already exists for that email." };
  }

  const token = generateToken();

  try {
    const invite = await withTransaction(async (tx) => {
      const rows = await tx`
        INSERT INTO organization_invites (org_id, email, role, token, status, invited_by)
        VALUES (
          ${input.orgId},
          ${email},
          ${input.role},
          ${token},
          ${"pending"},
          ${input.actor.id}
        )
        RETURNING id, org_id, email, role, token, status, invited_by, created_at, updated_at
      `;
      const created = rows[0] as OrganizationInvite;
      await insertAuditLog(tx, {
        orgId: input.orgId,
        actor: input.actor,
        action: "member.invited",
        target: created.id,
        metadata: { email, role: input.role },
      });
      return created;
    });
    return { invite };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("23505") || message.toLowerCase().includes("unique")) {
      return { error: "A pending invite already exists for that email." };
    }
    return { error: "Failed to create invite." };
  }
}

export async function revokeInvite(
  orgId: string,
  inviteId: string,
  actor: AuditActor,
): Promise<{ ok?: boolean; notFound?: boolean }> {
  return withTransaction(async (tx) => {
    const rows = await tx`
      UPDATE organization_invites
      SET status = 'revoked', updated_at = now()
      WHERE id = ${inviteId}
        AND org_id = ${orgId}
        AND status = 'pending'
      RETURNING id, email, role
    `;
    if (!rows[0]) {
      return { notFound: true };
    }

    const invite = rows[0] as { id: string; email: string; role: string };
    await insertAuditLog(tx, {
      orgId,
      actor,
      action: "invite.revoked",
      target: invite.id,
      metadata: { email: invite.email, role: invite.role },
    });

    return { ok: true };
  });
}

export async function getInviteByToken(
  token: string,
): Promise<InviteWithOrg | null> {
  const rows = await sql`
    SELECT
      i.id,
      i.org_id,
      i.email,
      i.role,
      i.token,
      i.status,
      i.invited_by,
      i.created_at,
      i.updated_at,
      o.name AS org_name
    FROM organization_invites i
    INNER JOIN organizations o ON o.id = i.org_id
    WHERE i.token = ${token}
    LIMIT 1
  `;
  return (rows[0] as InviteWithOrg | undefined) ?? null;
}

export async function acceptInvite(
  token: string,
  user: SessionUser,
): Promise<{ orgId?: string; error?: string; status?: number }> {
  try {
    return await withTransaction(async (tx) => {
      const inviteRows = await tx`
        SELECT
          i.id,
          i.org_id,
          i.email,
          i.role,
          i.token,
          i.status,
          i.invited_by,
          i.created_at,
          i.updated_at,
          o.name AS org_name
        FROM organization_invites i
        INNER JOIN organizations o ON o.id = i.org_id
        WHERE i.token = ${token}
        LIMIT 1
        FOR UPDATE OF i
      `;
      const invite = inviteRows[0] as InviteWithOrg | undefined;
      if (!invite) {
        return { error: "Invite not found.", status: 404 };
      }
      if (invite.status === "revoked") {
        return { error: "This invite has been revoked.", status: 400 };
      }
      if (invite.status === "accepted") {
        return { error: "This invite has already been accepted.", status: 400 };
      }
      if (invite.status !== "pending") {
        return { error: "This invite is no longer valid.", status: 400 };
      }

      const existing = await tx`
        SELECT id FROM organization_members
        WHERE org_id = ${invite.org_id} AND user_id = ${user.id}
        LIMIT 1
      `;

      if (existing.length === 0) {
        await tx`
          INSERT INTO organization_members (org_id, user_id, role, email, name)
          VALUES (
            ${invite.org_id},
            ${user.id},
            ${invite.role},
            ${user.email},
            ${user.name}
          )
        `;
      }

      const updated = await tx`
        UPDATE organization_invites
        SET status = 'accepted', updated_at = now()
        WHERE id = ${invite.id} AND status = 'pending'
        RETURNING id
      `;
      if (!updated[0]) {
        return { error: "This invite is no longer valid.", status: 400 };
      }

      await insertAuditLog(tx, {
        orgId: invite.org_id,
        actor: user,
        action: "invite.accepted",
        target: invite.id,
        metadata: {
          email: user.email,
          role: invite.role,
          inviteEmail: invite.email,
        },
      });

      return { orgId: invite.org_id };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("23505") || message.toLowerCase().includes("unique")) {
      // Race: member already inserted — retry accept path outside is complicated;
      // treat as failure to re-fetch; callers can refresh.
      return { error: "Failed to accept invite.", status: 409 };
    }
    return { error: "Failed to accept invite.", status: 500 };
  }
}
