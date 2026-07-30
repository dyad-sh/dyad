import { withTransaction } from "@/db";
import { insertAuditLog, type AuditActor } from "@/lib/audit";
import { isOrgRole, type OrgRole } from "@/lib/roles";

export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: string,
  actor: AuditActor,
): Promise<{
  ok?: boolean;
  error?: string;
  notFound?: boolean;
  forbidden?: boolean;
}> {
  if (!isOrgRole(role)) {
    return { error: "Invalid role." };
  }

  return withTransaction(async (tx) => {
    const target = await tx`
      SELECT id, role, email FROM organization_members
      WHERE org_id = ${orgId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!target[0]) {
      return { notFound: true };
    }

    const previous = target[0] as {
      id: string;
      role: OrgRole;
      email: string;
    };

    if (previous.role === role) {
      return { ok: true };
    }

    if (role === "org_member") {
      const admins = await tx`
        SELECT user_id FROM organization_members
        WHERE org_id = ${orgId} AND role = 'org_admin'
      `;
      const isOnlyAdmin =
        admins.length === 1 &&
        (admins[0] as { user_id: string }).user_id === userId;
      if (isOnlyAdmin) {
        return {
          forbidden: true,
          error: "Cannot demote the only admin of the organization.",
        };
      }
    }

    await tx`
      UPDATE organization_members
      SET role = ${role as OrgRole}
      WHERE org_id = ${orgId} AND user_id = ${userId}
    `;

    await insertAuditLog(tx, {
      orgId,
      actor,
      action: "member.role_changed",
      target: userId,
      metadata: {
        email: previous.email,
        from: previous.role,
        to: role,
      },
    });

    return { ok: true };
  });
}

export async function removeMember(
  orgId: string,
  userId: string,
  actor: AuditActor,
): Promise<{
  ok?: boolean;
  error?: string;
  notFound?: boolean;
  forbidden?: boolean;
}> {
  return withTransaction(async (tx) => {
    const target = await tx`
      SELECT id, role, email FROM organization_members
      WHERE org_id = ${orgId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!target[0]) {
      return { notFound: true };
    }

    const row = target[0] as { id: string; role: OrgRole; email: string };
    if (row.role === "org_admin") {
      const admins = await tx`
        SELECT user_id FROM organization_members
        WHERE org_id = ${orgId} AND role = 'org_admin'
      `;
      if (admins.length <= 1) {
        return {
          forbidden: true,
          error: "Cannot remove the only admin of the organization.",
        };
      }
    }

    await tx`
      DELETE FROM organization_members
      WHERE org_id = ${orgId} AND user_id = ${userId}
    `;

    await insertAuditLog(tx, {
      orgId,
      actor,
      action: "member.removed",
      target: userId,
      metadata: { email: row.email, role: row.role },
    });

    return { ok: true };
  });
}
