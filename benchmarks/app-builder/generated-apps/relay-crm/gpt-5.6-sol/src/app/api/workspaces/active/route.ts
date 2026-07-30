import { sql } from "@/db";
import { getWorkspaceMembership } from "@/lib/workspace";
import { errorResponse, readJsonObject } from "@/lib/validation";

export async function PATCH(request: Request) {
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (typeof body.workspaceId !== "string" || !body.workspaceId) return errorResponse("Workspace is required");
  const access = await getWorkspaceMembership(body.workspaceId);
  if (access.status !== 200) return errorResponse(access.status === 401 ? "Unauthorized" : "Forbidden", access.status);
  await sql`
    INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
    VALUES (${access.context.user.id}, ${body.workspaceId})
    ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id, updated_at = now()`;
  return Response.json({ id: body.workspaceId });
}
