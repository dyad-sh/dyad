import { sql } from "@/db";
import { requireSessionUser } from "@/lib/auth/session";
import { canManageMembers, forbiddenResponse } from "@/lib/permissions";
import { requireWorkspaceMembership } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const { id: workspaceId } = await context.params;
  const membership = await requireWorkspaceMembership(user.id, workspaceId);
  if (membership instanceof Response) return membership;

  if (!canManageMembers(membership.role)) {
    return forbiddenResponse();
  }

  const rows = await sql`
    SELECT id, user_id, email, role
    FROM workspace_members
    WHERE workspace_id = ${workspaceId}
    ORDER BY
      CASE WHEN role = 'owner' THEN 0 WHEN role = 'member' THEN 1 ELSE 2 END,
      created_at ASC
  `;

  return Response.json(
    rows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      email: String(row.email ?? ""),
      role: String(row.role),
    })),
  );
}
