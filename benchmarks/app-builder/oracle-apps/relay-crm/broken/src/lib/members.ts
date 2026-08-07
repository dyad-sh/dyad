import { sql } from "@/db";
import type { SessionUser } from "@/lib/workspace";

export type MemberRow = {
  id: string;
  userId: string;
  email: string;
  role: string;
};

export type InviteRow = {
  id: string;
  email: string;
  role: string;
  workspaceId: string;
  workspaceName: string;
  workspace: { id: string; name: string };
};

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  return (await sql`
    SELECT id, user_id AS "userId", email, role
    FROM workspace_members
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at ASC
  `) as MemberRow[];
}

type RawInvite = {
  id: string;
  email: string;
  role: string;
  workspaceId: string;
  workspaceName: string;
};

const shape = (rows: RawInvite[]): InviteRow[] =>
  rows.map((r) => ({
    ...r,
    workspace: { id: r.workspaceId, name: r.workspaceName },
  }));

export async function listWorkspaceInvites(
  workspaceId: string,
): Promise<InviteRow[]> {
  const rows = (await sql`
    SELECT i.id, i.email, i.role,
           i.workspace_id AS "workspaceId",
           w.name AS "workspaceName"
    FROM workspace_invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.workspace_id = ${workspaceId} AND i.status = 'pending'
    ORDER BY i.created_at ASC
  `) as RawInvite[];
  return shape(rows);
}

export async function listInvitesForEmail(email: string): Promise<InviteRow[]> {
  const rows = (await sql`
    SELECT i.id, i.email, i.role,
           i.workspace_id AS "workspaceId",
           w.name AS "workspaceName"
    FROM workspace_invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE lower(i.email) = lower(${email}) AND i.status = 'pending'
    ORDER BY i.created_at ASC
  `) as RawInvite[];
  return shape(rows);
}

export type InviteResult =
  | { ok: true; invite: InviteRow }
  | { ok: false; status: number; error: string };

export async function createInvite(
  workspaceId: string,
  email: string,
  invitedBy: string,
  role: "member" | "viewer" = "member",
): Promise<InviteResult> {
  const normalized = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, status: 400, error: "Enter a valid email address." };
  }

  const already = (await sql`
    SELECT id FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND lower(email) = lower(${normalized})
  `) as { id: string }[];
  if (already.length > 0) {
    return { ok: false, status: 400, error: "That person is already a member." };
  }

  const existing = (await sql`
    SELECT i.id, i.email, i.role, i.workspace_id AS "workspaceId", w.name AS "workspaceName"
    FROM workspace_invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.workspace_id = ${workspaceId}
      AND lower(i.email) = lower(${normalized})
      AND i.status = 'pending'
  `) as RawInvite[];
  if (existing.length > 0) {
    return { ok: true, invite: shape(existing)[0] };
  }

  const inserted = (await sql`
    INSERT INTO workspace_invites (workspace_id, email, invited_by, role)
    VALUES (${workspaceId}, ${normalized}, ${invitedBy}, ${role})
    RETURNING id
  `) as { id: string }[];

  const rows = (await sql`
    SELECT i.id, i.email, i.role, i.workspace_id AS "workspaceId", w.name AS "workspaceName"
    FROM workspace_invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.id = ${inserted[0].id}
  `) as RawInvite[];
  return { ok: true, invite: shape(rows)[0] };
}

export type AcceptResult =
  | { ok: true; workspaceId: string }
  | { ok: false; status: number; error: string };

export async function acceptInvite(
  inviteId: string,
  user: SessionUser,
): Promise<AcceptResult> {
  const rows = (await sql`
    SELECT id, workspace_id, email, role, status
    FROM workspace_invites WHERE id = ${inviteId}
  `) as {
    id: string;
    workspace_id: string;
    email: string;
    role: string;
    status: string;
  }[];

  const invite = rows[0];
  if (!invite) return { ok: false, status: 404, error: "Invite not found." };
  // ORACLE-DEFECT D9: crm-m2-s04 — the "is this invite addressed to you?" check
  // is gone. Holding the invite id is treated as proof of entitlement (the
  // classic capability-URL argument: the id is a random UUID, and /invites only
  // ever lists your own), so authorization now lives entirely in which ids the
  // UI shows you. Any signed-in third party who learns an invite id can accept
  // it and join that workspace. The legitimate invitee's flow is unchanged,
  // which is why the invite CUJs keep passing.
  if (invite.status !== "pending") {
    return { ok: false, status: 400, error: "This invite is no longer pending." };
  }

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, email, role)
    VALUES (${invite.workspace_id}, ${user.id}, ${user.email}, ${invite.role || "member"})
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;
  await sql`
    UPDATE workspace_invites SET status = 'accepted' WHERE id = ${invite.id}
  `;

  return { ok: true, workspaceId: invite.workspace_id };
}

export type MemberMutationResult =
  | { ok: true; member: MemberRow }
  | { ok: false; status: number; error: string };

async function findMember(
  workspaceId: string,
  memberId: string,
): Promise<MemberRow | null> {
  const rows = (await sql`
    SELECT id, user_id AS "userId", email, role
    FROM workspace_members
    WHERE id = ${memberId} AND workspace_id = ${workspaceId}
  `) as MemberRow[];
  return rows[0] ?? null;
}

async function countOwners(workspaceId: string): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS count FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND role = 'owner'
  `) as { count: number }[];
  return Number(rows[0]?.count ?? 0);
}

export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  role: string,
  actingUserId: string,
): Promise<MemberMutationResult> {
  const member = await findMember(workspaceId, memberId);
  if (!member) return { ok: false, status: 404, error: "Member not found." };

  if (member.userId === actingUserId) {
    return { ok: false, status: 403, error: "You cannot change your own role." };
  }
  if (member.role === "owner" && role !== "owner") {
    const owners = await countOwners(workspaceId);
    if (owners <= 1) {
      return {
        ok: false,
        status: 400,
        error: "A workspace must always have at least one owner.",
      };
    }
  }

  const rows = (await sql`
    UPDATE workspace_members SET role = ${role}
    WHERE id = ${memberId} AND workspace_id = ${workspaceId}
    RETURNING id, user_id AS "userId", email, role
  `) as MemberRow[];
  return { ok: true, member: rows[0] };
}

export async function removeMember(
  workspaceId: string,
  memberId: string,
  actingUserId: string,
): Promise<MemberMutationResult> {
  const member = await findMember(workspaceId, memberId);
  if (!member) return { ok: false, status: 404, error: "Member not found." };

  if (member.userId === actingUserId) {
    return {
      ok: false,
      status: 403,
      error: "You cannot remove yourself from the workspace.",
    };
  }
  if (member.role === "owner") {
    const owners = await countOwners(workspaceId);
    if (owners <= 1) {
      return {
        ok: false,
        status: 400,
        error: "A workspace must always have at least one owner.",
      };
    }
  }

  await sql`
    DELETE FROM workspace_members WHERE id = ${memberId} AND workspace_id = ${workspaceId}
  `;
  // ORACLE-DEFECT D6: crm-m3-s07 — removal drops the membership row but leaves the
  // removed user's `user_settings.active_workspace_id` pointing at this
  // workspace. Paired with the "trust the stored active workspace" defect in
  // `getWorkspaceContext`, a session that was inside the workspace when it was
  // removed keeps reading it.
  return { ok: true, member };
}

export async function createWorkspace(
  user: SessionUser,
  name: string,
): Promise<{ id: string; name: string }> {
  const rows = (await sql`
    INSERT INTO workspaces (name, owner_id) VALUES (${name}, ${user.id})
    RETURNING id, name
  `) as { id: string; name: string }[];
  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, email, role)
    VALUES (${rows[0].id}, ${user.id}, ${user.email}, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;
  return rows[0];
}
