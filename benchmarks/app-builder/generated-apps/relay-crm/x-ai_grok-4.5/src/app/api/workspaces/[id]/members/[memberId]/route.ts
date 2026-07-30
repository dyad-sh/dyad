import { sql } from "@/db";
import { requireSessionUser } from "@/lib/auth/session";
import { canManageMembers, forbiddenResponse } from "@/lib/permissions";
import { validationError } from "@/lib/validation";
import { countOwners, requireWorkspaceMembership } from "@/lib/workspace";
import type { MembershipRole } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; memberId: string }> };

function parseRole(value: unknown): MembershipRole | Response {
  const role = String(value ?? "").trim();
  if (role === "owner" || role === "member" || role === "viewer") {
    return role;
  }
  return validationError("Invalid role");
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const { id: workspaceId, memberId } = await context.params;
  const membership = await requireWorkspaceMembership(user.id, workspaceId);
  if (membership instanceof Response) return membership;

  if (!canManageMembers(membership.role)) {
    return forbiddenResponse();
  }

  let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  
    // Only `role` is accepted; ignore id/workspace/user fields clients may supply.
    const nextRole = parseRole(body.role);
    if (nextRole instanceof Response) return nextRole;

  const targets = await sql`
    SELECT id, user_id, email, role
    FROM workspace_members
    WHERE id = ${memberId} AND workspace_id = ${workspaceId}
    LIMIT 1
  `;

  if (targets.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const target = targets[0];
  if (String(target.user_id) === user.id) {
    return forbiddenResponse("You cannot change your own role");
  }

  const currentRole = String(target.role) as MembershipRole;
  if (currentRole === "owner" && nextRole !== "owner") {
    const owners = await countOwners(workspaceId);
    if (owners <= 1) {
      return Response.json(
        { error: "A workspace must keep at least one owner" },
        { status: 400 },
      );
    }
  }

  const rows = await sql`
    UPDATE workspace_members
    SET role = ${nextRole}
    WHERE id = ${memberId} AND workspace_id = ${workspaceId}
    RETURNING id, user_id, email, role
  `;

  const updated = rows[0];
  return Response.json({
    id: String(updated.id),
    userId: String(updated.user_id),
    email: String(updated.email ?? ""),
    role: String(updated.role),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const { id: workspaceId, memberId } = await context.params;
  const membership = await requireWorkspaceMembership(user.id, workspaceId);
  if (membership instanceof Response) return membership;

  if (!canManageMembers(membership.role)) {
    return forbiddenResponse();
  }

  const targets = await sql`
    SELECT id, user_id, role
    FROM workspace_members
    WHERE id = ${memberId} AND workspace_id = ${workspaceId}
    LIMIT 1
  `;

  if (targets.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const target = targets[0];
  if (String(target.user_id) === user.id) {
    return forbiddenResponse("You cannot remove yourself");
  }

  if (String(target.role) === "owner") {
    const owners = await countOwners(workspaceId);
    if (owners <= 1) {
      return Response.json(
        { error: "A workspace must keep at least one owner" },
        { status: 400 },
      );
    }
  }

  await sql`
    DELETE FROM workspace_members
    WHERE id = ${memberId} AND workspace_id = ${workspaceId}
  `;

  return Response.json({ ok: true });
}
