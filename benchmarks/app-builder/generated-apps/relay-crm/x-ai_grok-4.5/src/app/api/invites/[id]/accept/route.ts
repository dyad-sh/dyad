import { sql } from "@/db";
import { requireSessionUser } from "@/lib/auth/session";
import { ensureUserWorkspace, setActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  await ensureUserWorkspace(user);
  const { id } = await context.params;
  const email = user.email.trim().toLowerCase();

  const invites = await sql`
    SELECT i.id, i.email, i.workspace_id, i.status, i.role, w.name AS workspace_name
    FROM workspace_invites i
    INNER JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.id = ${id}
    LIMIT 1
  `;

  if (invites.length === 0) {
    return Response.json({ error: "Invite not found" }, { status: 404 });
  }

  const invite = invites[0];
  if (String(invite.status) !== "pending") {
    return Response.json({ error: "Invite is no longer pending" }, { status: 400 });
  }

  if (String(invite.email).trim().toLowerCase() !== email) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const workspaceId = String(invite.workspace_id);
  const inviteRole =
    String(invite.role) === "viewer" ? "viewer" : "member";

  const existing = await sql`
    SELECT id, role FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${user.id}
    LIMIT 1
  `;

  let membershipId: string;
  let role = inviteRole;
  if (existing.length > 0) {
    membershipId = String(existing[0].id);
    role = String(existing[0].role) === "owner" ? "owner" : inviteRole;
    if (String(existing[0].role) !== "owner") {
      await sql`
        UPDATE workspace_members
        SET role = ${inviteRole}, email = ${user.email}
        WHERE id = ${membershipId}
      `;
    }
  } else {
    const inserted = await sql`
      INSERT INTO workspace_members (workspace_id, user_id, email, role)
      VALUES (${workspaceId}, ${user.id}, ${user.email}, ${inviteRole})
      RETURNING id
    `;
    membershipId = String(inserted[0].id);
  }

  await sql`
    UPDATE workspace_invites
    SET status = 'accepted'
    WHERE id = ${id}
  `;

  await setActiveWorkspace(user.id, workspaceId);

  return Response.json({
    id: String(invite.id),
    email: String(invite.email),
    workspaceId,
    name: String(invite.workspace_name),
    workspaceName: String(invite.workspace_name),
    membershipId,
    role,
  });
}
