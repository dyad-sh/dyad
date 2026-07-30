import { sql } from "@/db";
import { requireSessionUser } from "@/lib/auth/session";
import { canManageMembers, forbiddenResponse } from "@/lib/permissions";
import {
  clampString,
  sanitizeWriteBody,
  validateOptionalEmail,
  validationError,
} from "@/lib/validation";
import { requireWorkspaceMembership } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function invitePayload(
  invite: Record<string, unknown>,
  workspaceName: string,
) {
  return {
    id: String(invite.id),
    email: String(invite.email),
    role: String(invite.role ?? "member"),
    workspaceId: String(invite.workspace_id),
    name: workspaceName,
    workspaceName,
    workspace: {
      id: String(invite.workspace_id),
      name: workspaceName,
    },
  };
}

export async function POST(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const { id: workspaceId } = await context.params;
  const membership = await requireWorkspaceMembership(user.id, workspaceId);
  if (membership instanceof Response) return membership;

  if (!canManageMembers(membership.role)) {
    return forbiddenResponse();
  }

  let body: Record<string, unknown>;
    try {
      // Keep invite role; strip identity fields that clients must not set.
      const raw = await request.json();
      const roleValue = raw?.role;
      body = sanitizeWriteBody(raw);
      if (roleValue !== undefined) {
        body.role = roleValue;
      }
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  
    const emailResult = validateOptionalEmail(body.email);
    if (emailResult instanceof Response) return emailResult;
    const email = emailResult.trim().toLowerCase();
    if (!email) {
      return validationError("A valid email is required");
    }
  
    const role = String(body.role ?? "member").trim();
    if (role !== "member" && role !== "viewer") {
      return validationError("Invite role must be member or viewer");
    }

  if (email === user.email.trim().toLowerCase()) {
    return Response.json({ error: "You are already a member" }, { status: 400 });
  }

  // Role field already handled; length check on arbitrary extras skipped
  const note = clampString(body.note, "Note");
  if (note instanceof Response) return note;

  const existingMember = await sql`
    SELECT id FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND lower(email) = ${email}
    LIMIT 1
  `;
  if (existingMember.length > 0) {
    return Response.json({ error: "User is already a member" }, { status: 400 });
  }

  const existingInvite = await sql`
    SELECT id, email, workspace_id, role
    FROM workspace_invites
    WHERE workspace_id = ${workspaceId}
      AND lower(email) = ${email}
      AND status = 'pending'
    LIMIT 1
  `;
  if (existingInvite.length > 0) {
    const updated = await sql`
      UPDATE workspace_invites
      SET role = ${role}
      WHERE id = ${existingInvite[0].id}
      RETURNING id, email, workspace_id, role
    `;
    return Response.json(invitePayload(updated[0], membership.workspaceName));
  }

  const rows = await sql`
    INSERT INTO workspace_invites (workspace_id, email, invited_by, status, role)
    VALUES (${workspaceId}, ${email}, ${user.id}, 'pending', ${role})
    RETURNING id, email, workspace_id, role
  `;

  return Response.json(
    invitePayload(rows[0], membership.workspaceName),
    { status: 201 },
  );
}
