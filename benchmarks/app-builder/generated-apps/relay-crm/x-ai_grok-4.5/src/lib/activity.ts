import { sql } from "@/db";
import type { AuthUser } from "@/lib/auth/session";
import type { ActivityType } from "@/lib/types";

export async function recordContactActivity(params: {
  workspaceId: string;
  contactId: string;
  type: ActivityType;
  body: string;
  actor: AuthUser;
}) {
  const { workspaceId, contactId, type, body, actor } = params;
  const rows = await sql`
    INSERT INTO contact_activities (
      workspace_id,
      contact_id,
      type,
      body,
      actor_user_id,
      actor_email,
      actor_name
    )
    VALUES (
      ${workspaceId},
      ${contactId},
      ${type},
      ${body},
      ${actor.id},
      ${actor.email},
      ${actor.name}
    )
    RETURNING
      id,
      type,
      body,
      actor_user_id,
      actor_email,
      actor_name,
      created_at
  `;
  return rows[0];
}

export async function listContactActivities(
  workspaceId: string,
  contactId: string,
) {
  return sql`
    SELECT
      id,
      type,
      body,
      actor_user_id,
      actor_email,
      actor_name,
      created_at
    FROM contact_activities
    WHERE workspace_id = ${workspaceId} AND contact_id = ${contactId}
    ORDER BY created_at DESC, id DESC
  `;
}
