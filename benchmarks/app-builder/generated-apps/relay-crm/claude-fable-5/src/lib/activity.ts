import { sql } from '@/db';
import { SessionUser } from '@/lib/api-auth';

export async function recordActivity(
  workspaceId: string,
  contactId: string,
  type: string,
  body: string,
  actor: SessionUser,
) {
  await sql`
    INSERT INTO activities (workspace_id, contact_id, type, body, actor_user_id, actor_email)
    VALUES (${workspaceId}, ${contactId}, ${type}, ${body}, ${actor.id}, ${actor.email})
  `;
}
